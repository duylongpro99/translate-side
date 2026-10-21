// Runs the product's real extractor (src/extract extractPage) over three site fixtures in jsdom, the
// way tests/fixtures/load.ts loads them, and returns the translatable blocks for the Nano harness.
// Bundled and run by ../build.mjs at build time (node), never shipped.
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { extractPage } from '../../../src/extract/index.ts';
import { attachDeclarativeShadowRoots } from '../../../tests/fixtures/load.ts';

/** A reference page, a long-form essay and a news article: three different registers. */
export const SLUGS = ['mdn-promise-then', 'goblog-pipelines', 'globalvoices-bangladesh-protests'] as const;

export interface FixtureBlock {
  id: string;
  kind: string;
  inlineMarkup: string;
}

export function extractFixtures(sitesDir: string): Record<string, FixtureBlock[]> {
  const manifest = JSON.parse(fs.readFileSync(path.join(sitesDir, 'manifest.json'), 'utf8')) as Record<string, { finalUrl: string }>;
  const out: Record<string, FixtureBlock[]> = {};
  for (const slug of SLUGS) {
    const meta = manifest[slug];
    if (!meta) throw new Error(`fixture ${slug} is not in fixtures/sites/manifest.json`);
    const doc = new JSDOM(fs.readFileSync(path.join(sitesDir, `${slug}.html`), 'utf8'), { url: meta.finalUrl }).window.document;
    attachDeclarativeShadowRoots(doc);
    const r = extractPage(doc);
    if (!r.ok) throw new Error(`${slug}: extraction failed (${r.reason})`);
    out[slug] = r.segments.filter((s) => s.translate && s.kind !== 'code').map((s) => ({ id: s.id, kind: s.kind, inlineMarkup: s.inlineMarkup }));
  }
  return out;
}
