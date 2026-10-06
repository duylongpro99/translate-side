// Plan M0 §3 success criteria #1–#3, measured on the ten fixtures (M0-E8):
//   #1 no UI noise in segments, judged against the hand-checked list fixtures/noise.json
//   #2 every code block intact and marked do-not-translate
//   #3 segment ids identical across two extractions of the same page
import fs from 'node:fs';
import path from 'node:path';
import type { Segment } from '@/engine/types';
import { extractPage } from '@/extract';
import { LANDMARK_NOISE } from '@/extract/clean';
import { composeDocument } from '@/extract/compose';
import { codeText } from '@/segment/segmenter';
import { FIXTURES, loadFixture, manifest } from './load.ts';

export interface NoiseItem {
  text: string;
  kind: 'ui' | 'meta' | 'promo' | 'hidden' | 'glyph';
  note?: string;
}

export const noiseList = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'noise.json'), 'utf8')) as Record<string, NoiseItem[] | string>;

/** noise.json texts join text nodes with spaces ("[ edit ]"), so compare without whitespace. */
const squash = (s: string) => s.replace(/\s+/g, '');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const VISIBLE = new Set(['ui', 'meta', 'promo']);

export interface FixtureReport {
  slug: string;
  via: string;
  segments: number;
  /** #1: segments whose whole text is a visible noise item (ui/meta/promo). */
  noise: string[];
  /** #1 upper bound: visible noise items found as whole words inside any segment text. */
  noiseSubstr: string[];
  /** Items labelled `hidden` (hidden by site CSS; jsdom can't see CSS, Chrome's checkVisibility drops them). */
  hiddenNoise: string[];
  /** #2 */
  codeTruth: number;
  codeIntact: number;
  codeUnmarked: number;
  /** #3 */
  idsStable: boolean;
}

export function measure(slug: string): FixtureReport {
  const r1 = extractPage(loadFixture(slug));
  const r2 = extractPage(loadFixture(slug));
  if (!r1.ok || !r2.ok) throw new Error(`${slug}: extraction failed`);
  const segs = r1.segments;
  const items = (noiseList[slug] as NoiseItem[] | undefined) ?? [];

  const bySquashed = new Map(segs.map((s) => [squash(s.text), s] as const));
  const noise: string[] = [];
  const hiddenNoise: string[] = [];
  for (const it of items) {
    if (it.kind === 'glyph') continue;
    const n = segs.filter((s) => squash(s.text) === squash(it.text)).length;
    if (!n || !bySquashed.has(squash(it.text))) continue;
    (VISIBLE.has(it.kind) ? noise : hiddenNoise).push(n > 1 ? `${it.text} ×${n}` : it.text);
  }
  const all = segs.map((s) => norm(s.text)).join('\n');
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const noiseSubstr = items
    .filter((it) => VISIBLE.has(it.kind))
    .filter((it) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(norm(it.text))}(?![\\p{L}\\p{N}])`, 'u').test(all))
    .map((it) => it.text);

  const { codeTruth, codeIntact } = codeBlocks(slug, segs);
  return {
    slug,
    via: r1.via,
    segments: segs.length,
    noise,
    noiseSubstr,
    hiddenNoise,
    codeTruth,
    codeIntact,
    codeUnmarked: segs.filter((s) => s.kind === 'code' && s.translate).length,
    idsStable: JSON.stringify(segs.map((s) => s.id)) === JSON.stringify(r2.segments.map((s) => s.id)),
  };
}

/**
 * Truth: every `pre` in the fixture's hand-picked content root (manifest `contentSelector`), on
 * the shadow-composed page, minus landmark/hidden chrome. A block is intact when a code segment
 * has its exact text, and the same characters as the block's textContent apart from whitespace
 * (`<br>` line breaks have no text, so textContent alone can't check newlines).
 */
function codeBlocks(slug: string, segs: Segment[]) {
  const meta = manifest[slug];
  if (!meta) throw new Error(slug);
  const composed = composeDocument(loadFixture(slug));
  const truthRoot = composed.root.querySelector(meta.contentSelector);
  if (!truthRoot) throw new Error(`${slug}: contentSelector not found`);
  truthRoot.querySelectorAll(LANDMARK_NOISE).forEach((e) => e.remove());
  const pool = segs.filter((s) => s.kind === 'code');
  let intact = 0;
  const pres = [...truthRoot.querySelectorAll('pre')].filter((p) => !p.parentElement?.closest('pre'));
  for (const pre of pres) {
    const exact = codeText(pre);
    const loose = squash(pre.textContent ?? '');
    const i = pool.findIndex((s) => s.text === exact && squash(s.text) === loose);
    if (i >= 0) {
      pool.splice(i, 1);
      intact++;
    }
  }
  return { codeTruth: pres.length, codeIntact: intact };
}
