// Simulated model output with injected format faults (plan M1-E12): the fuzz tests and the
// fixture-based segment-loss check build what a misbehaving model would return for a wire chunk.
// The faults are the S2 list: missing, merged, reordered, unclosed, quoting/case drift, preambles
// and fences, empty, duplicate, unknown and bad ids, text between segments, a dropped nonce, and a
// max_tokens cut. Plain engine code, seeded, no I/O.

import type { StopReason } from '../../llm/types.ts';
import type { WireChunk } from './wire.ts';

export const FAULTS = [
  'drop',
  'merge',
  'reorder',
  'unclose-last',
  'unclose-middle',
  'quote-drift',
  'case-drift',
  'preamble',
  'fence',
  'empty',
  'dup',
  'unknown',
  'between-text',
  'bad-id',
  'nonce-drop',
  'cut',
] as const;
export type Fault = (typeof FAULTS)[number];

export interface SimulatedOutput {
  output: string;
  stopReason: StopReason;
  faults: Fault[];
  /**
   * Ids whose accepted text may legitimately be wrong: a merge the length-ratio rule can miss (S2),
   * or stray text after an unclosed segment.
   */
  tainted: Set<number>;
}

/** Park–Miller LCG in (0, 1). */
export function lcg(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Random delta sizes 1…max, for feeding a stream in pieces. */
export const deltaSizes = (rng: () => number, max: number) => (): number => 1 + Math.floor(rng() * max);

interface Piece {
  open: string;
  text: string;
  close: string;
  /** Raw text after the piece, before the newline. */
  after: string;
}

/**
 * What a model returns for `chunk` when it translates each segment with `translate`, then breaks the
 * format with `faults` (picked at random when a count is given). `copyNonce: false` = the model
 * did not echo the nonce of a v2 chunk.
 */
export function simulateOutput(
  chunk: WireChunk,
  translate: (source: string) => string,
  rng: () => number,
  options: { faults?: number | readonly Fault[]; copyNonce?: boolean } = {},
): SimulatedOutput {
  const nonce = options.copyNonce === false ? undefined : chunk.nonce;
  const attr = (n: number | string, q = '"'): string => `id=${q}${n}${q}${nonce === undefined ? '' : ` n=${q}${nonce}${q}`}`;
  const pieces: Piece[] = chunk.segments.map((e) => ({ open: `<seg ${attr(e.n)}>`, text: translate(e.segment.inlineMarkup), close: '</seg>', after: '' }));
  const ids = chunk.segments.map((e) => e.n);
  const pickIndex = (len: number): number => Math.floor(rng() * len);
  const faults: Fault[] =
    typeof options.faults === 'object'
      ? [...options.faults]
      : Array.from({ length: options.faults ?? 0 }, () => FAULTS[pickIndex(FAULTS.length)] as Fault);
  const tainted = new Set<number>();
  let stopReason: StopReason = 'end';
  let prefix = '';
  let suffix = '';
  let cut = false;
  for (const fault of faults) {
    const i = pickIndex(pieces.length);
    const p = pieces[i];
    switch (fault) {
      case 'drop':
        if (pieces.length > 1) pieces.splice(i, 1);
        break;
      case 'merge': {
        const q = pieces[i + 1];
        if (p !== undefined && q !== undefined) {
          p.text = `${p.text} ${q.text}`;
          pieces.splice(i + 1, 1);
          // Both ids: after a dup, the merged-away id may live on under a wrong copy.
          for (const t of [p.open, q.open]) {
            const n = /id=["']?(\d+)/.exec(t)?.[1];
            if (n !== undefined) tainted.add(Number(n));
          }
        }
        break;
      }
      case 'reorder':
        if (p !== undefined && pieces[i + 1] !== undefined) [pieces[i], pieces[i + 1]] = [pieces[i + 1] as Piece, p];
        break;
      case 'unclose-last': {
        const last = pieces.at(-1);
        if (last !== undefined) last.close = '';
        break;
      }
      case 'unclose-middle':
        if (p !== undefined && i < pieces.length - 1) p.close = '';
        break;
      case 'quote-drift':
        if (p !== undefined) p.open = p.open.replace(/"/g, "'");
        break;
      case 'case-drift':
        if (p !== undefined) {
          p.open = p.open.replace('<seg', '<SEG');
          if (p.close !== '') p.close = '</SEG>';
        }
        break;
      case 'preamble':
        prefix = 'Here is the translation:\n';
        break;
      case 'fence':
        prefix = `${prefix}\`\`\`xml\n`;
        suffix = '\n```';
        break;
      case 'empty':
        if (p !== undefined) p.text = '';
        break;
      case 'dup':
        if (p !== undefined) {
          pieces.splice(i + 1, 0, { ...p, text: 'garbage' });
          // If a later fault removes the original, the wrong copy is all that is left under the id.
          const n = /id=["']?(\d+)/.exec(p.open)?.[1];
          if (n !== undefined) tainted.add(Number(n));
        }
        break;
      case 'unknown':
        pieces.push({ open: `<seg ${attr(Math.max(...ids) + 7)}>`, text: 'extra', close: '</seg>', after: '' });
        break;
      case 'between-text':
        if (p !== undefined) p.after = ' (note) ';
        break;
      case 'bad-id':
        pieces.splice(i, 0, { open: `<seg ${attr('x')}>`, text: 'junk', close: '</seg>', after: '' });
        break;
      case 'nonce-drop':
        if (p !== undefined && i > 0) p.open = p.open.replace(/ n=["'][^"']*["']/, '');
        break;
      case 'cut':
        cut = true;
        break;
    }
  }
  // Text after an unclosed segment (a note, or a fence after the last one) reads as its text: no
  // grammar can tell them apart. A known limit; the check stage's marker checks (M2) catch a fence.
  pieces.forEach((p, i) => {
    if (p.close === '' && (p.after !== '' || (i === pieces.length - 1 && suffix !== ''))) {
      const n = /id=["']?(\d+)/.exec(p.open)?.[1];
      if (n !== undefined) tainted.add(Number(n));
    }
  });
  let output = prefix + pieces.map((p) => `${p.open}${p.text}${p.close}${p.after}`).join('\n') + suffix;
  if (cut) {
    output = output.slice(0, pickIndex(output.length + 1));
    stopReason = 'max_tokens';
  }
  return { output, stopReason, faults, tainted };
}
