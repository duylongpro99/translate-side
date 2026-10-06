// Simulated model output with injected format faults (plan M1-E12): the fuzz tests and the
// fixture-based segment-loss check build what a misbehaving model would return for a wire chunk.
// The faults are the S2 list: missing, merged, reordered, unclosed, quoting/case drift, preambles
// and fences, empty, duplicate, unknown and bad ids, text between segments, a dropped nonce, and a
// cut (max_tokens, refusal or other). `swallow-dup` builds the shape of decision M1-D8 (b): an
// unclosed segment swallows its neighbour's OPEN, and a wrong copy of the neighbour follows.
// Plain engine code, seeded, no I/O.

import type { StopReason } from '../../llm/types.ts';
import { MERGE_FACTOR } from './repair.ts';
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
  'swallow-dup',
] as const;
export type Fault = (typeof FAULTS)[number];

export interface SimulatedOutput {
  output: string;
  stopReason: StopReason;
  faults: Fault[];
  /**
   * Ids whose accepted text may legitimately be wrong: a merge the length-ratio rule can miss (S2),
   * an id whose first copy in the output is a wrong one (a dup whose original was dropped, merged
   * away or reordered after it), or an unclosed segment followed by stray text.
   */
  tainted: Set<number>;
  /** Per fault, the segment ids it hit (the segment it dropped, merged away, duplicated, emptied…). */
  hit: Partial<Record<Fault, Set<number>>>;
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
  /** A duplicate's text, not the translation of the id. */
  wrong?: boolean;
  /** The id of the next piece this one absorbed (merge fault). */
  absorbed?: number;
}

const idOf = (open: string): number | undefined => {
  const n = /id=["']?(\d+)/i.exec(open)?.[1];
  return n === undefined ? undefined : Number(n);
};

/** Margin over the plan's merge threshold: a merge this close to it counts as undetectable. */
const MERGE_MARGIN = 1.25;

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
  const hit: Partial<Record<Fault, Set<number>>> = {};
  const mark = (fault: Fault, ...pieceList: (Piece | undefined)[]): void => {
    for (const piece of pieceList) {
      const id = piece === undefined ? undefined : idOf(piece.open);
      if (id !== undefined) (hit[fault] ??= new Set()).add(id);
    }
  };
  let stopReason: StopReason = 'end';
  let prefix = '';
  let suffix = '';
  let cut = false;
  for (const fault of faults) {
    const i = pickIndex(pieces.length);
    const p = pieces[i];
    switch (fault) {
      case 'drop':
        if (pieces.length > 1) {
          mark('drop', p);
          pieces.splice(i, 1);
        }
        break;
      case 'merge': {
        const q = pieces[i + 1];
        if (p !== undefined && q !== undefined) {
          mark('merge', p, q);
          p.text = `${p.text} ${q.text}`;
          // -1: a piece with no id (bad-id junk), which no rule can see as a merge.
          p.absorbed = idOf(q.open) ?? -1;
          pieces.splice(i + 1, 1);
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
        if (p !== undefined) {
          mark('empty', p);
          p.text = '';
        }
        break;
      case 'dup':
        if (p !== undefined) {
          mark('dup', p);
          pieces.splice(i + 1, 0, { ...p, text: 'garbage', wrong: true });
        }
        break;
      case 'swallow-dup': {
        const q = pieces[i + 1];
        if (p !== undefined && q !== undefined) {
          mark('swallow-dup', p, q);
          p.close = '';
          pieces.splice(i + 2, 0, { ...q, text: 'garbage', wrong: true });
        }
        break;
      }
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
    const n = idOf(p.open);
    if (n !== undefined && p.close === '' && (p.after !== '' || (i === pieces.length - 1 && suffix !== ''))) tainted.add(n);
  });
  // The parser keeps the first copy of an id: when that is a wrong one, nothing can tell.
  const seen = new Set<number>();
  for (const p of pieces) {
    const n = idOf(p.open);
    if (n === undefined || seen.has(n)) continue;
    seen.add(n);
    if (p.wrong === true) tainted.add(n);
  }
  let output = prefix;
  /** End offset of each piece's close in the output. */
  const ends = new Map<Piece, number>();
  pieces.forEach((p, i) => {
    output += `${i > 0 ? '\n' : ''}${p.open}${p.text}${p.close}`;
    ends.set(p, output.length);
    output += p.after;
  });
  output += suffix;
  if (cut) {
    output = output.slice(0, pickIndex(output.length + 1));
    stopReason = (['max_tokens', 'max_tokens', 'refusal', 'other'] as const)[pickIndex(4)] ?? 'max_tokens';
  }
  // A merge the plan (repair.ts) may miss, judged on what the plan sees: the pieces complete before
  // a cut (review T-B5). The plan needs a missing neighbour (id ± 1), so not when the absorbed id
  // still comes (a wrong copy) or was not a neighbour (after a reorder, or no id); and a length
  // ratio over its threshold (taint within MERGE_MARGIN of it).
  const visible = pieces.filter((p) => (ends.get(p) ?? Infinity) <= output.length);
  const present = visible.map((p) => idOf(p.open));
  const source = new Map(chunk.segments.map((e) => [e.n, e.segment.inlineMarkup]));
  const ratio = (p: Piece): number => p.text.length / Math.max(1, (source.get(idOf(p.open) ?? -1) ?? '').length);
  for (const p of visible) {
    const n = idOf(p.open);
    const a = p.absorbed;
    if (a === undefined || n === undefined) continue;
    if (present.includes(a) || Math.abs(a - n) !== 1) {
      tainted.add(n);
      continue;
    }
    const others = visible
      .filter((o) => o !== p && source.has(idOf(o.open) ?? -1))
      .map(ratio)
      .sort((a, b) => a - b);
    const median = others.length > 0 ? (others[Math.floor((others.length - 1) / 2)] ?? 1) : 1;
    if (ratio(p) <= MERGE_FACTOR * median * MERGE_MARGIN) tainted.add(n);
  }
  return { output, stopReason, faults, tainted, hit };
}
