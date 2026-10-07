// The `<seg>` wire format of a chunk (DESIGN.md §5.7 Step 3, decision S2): local ids 1…n in chunk
// order, each segment's `inlineMarkup` sent unescaped. Before sending, the source is checked for
// literal tag-shaped text (option C): a chunk with a hit gets the v2 grammar and a per-chunk nonce
// attribute, `<seg id="N" n="NONCE">`; every other chunk is plain `<seg id="N">` and v1.
//
// The nonce is 4 base-36 characters derived from the chunk's text, so the same chunk always gets
// the same request (the translation cache and tests stay deterministic), and never a string that
// occurs in the chunk's source.

import type { Segment } from '../types.ts';
import { literalTagCount, type Grammar } from './seg-parser.ts';

export interface WireSegment {
  /** The local id the model sees. */
  n: number;
  segment: Segment;
}

export interface WireChunk {
  segments: WireSegment[];
  grammar: Grammar;
  /** Only for v2 chunks. */
  nonce?: string;
}

/** FNV-1a, 32 bit. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function nonceFor(sources: readonly string[]): string {
  const all = sources.join('\n');
  for (let salt = 0; ; salt++) {
    const nonce = (hash(`${salt}\n${all}`) % 36 ** 4).toString(36).padStart(4, '0');
    if (!all.includes(nonce)) return nonce;
  }
}

/** A chunk's segments as sent: ids 1…n, or the given ids (a repair keeps the original ones). */
export function toWire(segments: readonly Segment[] | readonly WireSegment[]): WireChunk {
  const entries: WireSegment[] = segments.map((s, i) => ('n' in s ? s : { n: i + 1, segment: s }));
  const sources = entries.map((e) => e.segment.inlineMarkup);
  if (!sources.some((s) => literalTagCount(s) > 0)) return { segments: entries, grammar: 'v1' };
  return { segments: entries, grammar: 'v2', nonce: nonceFor(sources) };
}

/** The user-message body: one `<seg>` line per segment. */
export function formatWire(chunk: WireChunk): string {
  const attr = chunk.nonce === undefined ? '' : ` n="${chunk.nonce}"`;
  return chunk.segments.map((e) => `<seg id="${e.n}"${attr}>${e.segment.inlineMarkup}</seg>`).join('\n');
}

/** An answer to `chunk` in the wire format, from each segment's text (a re-request shows the model its earlier answer). */
export function formatAnswer(chunk: WireChunk, text: (e: WireSegment) => string): string {
  const attr = chunk.nonce === undefined ? '' : ` n="${chunk.nonce}"`;
  return chunk.segments.map((e) => `<seg id="${e.n}"${attr}>${text(e)}</seg>`).join('\n');
}
