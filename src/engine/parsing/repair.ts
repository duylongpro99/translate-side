// Repair plan (decision S2, "Repair policy"; ported from plan() in spikes/s2/parser.mjs). Decides
// which segments one follow-up call re-requests:
// - missing ones, the cut one and every one after it (those are missing too);
// - empty ones (whitespace only, where the source isn't);
// - suspect-merged ones: a neighbour is missing and either an OPEN was swallowed as text (v2) or
//   the length ratio is over `mergeFactor` × the median ratio of the chunk's other segments;
// - truncated ones: closed implicitly by an unknown id (v1), i.e. cut at a literal `<seg`; or
//   left unclosed at the end with a partial tag held back after them, which may have been their
//   own text (`… Vec<se`; decision M1-D8 (a), found by fuzzing: S2 rule 5 sends it to stray);
// - literal-tag mismatch: the count of tag-shaped strings differs between source and output.
// Any dup, orphan close, unknown id or bad id makes the structure ambiguous: the whole chunk is
// re-requested; so does, in nonce mode, a swallowed nonce OPEN whose id also came as a segment
// (decision M1-D8 (b)), and, in any v2 chunk, a swallowed OPEN whose id also came as a segment,
// inside a segment with more tag-shaped strings than its source (decision M1-D10). Everything
// else is kept.

import { literalTagCount, type ParseResult } from './seg-parser.ts';

export interface RepairPlan {
  /** Ids to re-request, ascending. Empty when the chunk is complete. */
  rerequest: number[];
  ambiguous: boolean;
  merged: number[];
  empty: number[];
  truncated: number[];
  tagMismatch: number[];
  cut: number | null;
}

/** S2's threshold, provisional until the M1 harness replays it on a second model. */
export const MERGE_FACTOR = 1.6;

const AMBIGUOUS = new Set(['dup', 'orphan-close', 'unknown', 'bad-id']);

/** `source`: every id of the request, with the text sent for it. */
export function planRepair(res: ParseResult, source: ReadonlyMap<number, string>, options: { mergeFactor?: number } = {}): RepairPlan {
  const mergeFactor = options.mergeFactor ?? MERGE_FACTOR;
  const ids = [...source.keys()].sort((a, b) => a - b);
  const present = [...res.segs.keys()].filter((id) => source.has(id));
  const out = (id: number): string => res.segs.get(id) ?? '';
  const src = (id: number): string => source.get(id) ?? '';
  const ratio = (id: number): number => out(id).length / Math.max(1, src(id).length);
  const medianOfOthers = (id: number): number => {
    const r = present
      .filter((x) => x !== id)
      .map(ratio)
      .sort((a, b) => a - b);
    return r.length > 0 ? (r[Math.floor((r.length - 1) / 2)] ?? 1) : 1;
  };
  const missing = new Set(res.missing);
  const swallowed = new Set(res.fixes.filter((f) => f.kind === 'open-in-text').map((f) => f.id));
  const merged = present.filter(
    (id) => (missing.has(id - 1) || missing.has(id + 1)) && (swallowed.has(id) || ratio(id) > mergeFactor * medianOfOthers(id)),
  );
  const empty = present.filter((id) => out(id).trim() === '' && src(id).trim() !== '');
  // The second condition is decision M1-D8 (a).
  const truncated = res.fixes.flatMap((f, i) =>
    typeof f.id === 'number' &&
    ((f.kind === 'implicit-close' && res.fixes[i + 1]?.kind === 'unknown') || (f.kind === 'unclosed-end' && f.detail === 'partial-tag'))
      ? [f.id]
      : [],
  );
  const tagMismatch = present.filter((id) => literalTagCount(src(id)) !== literalTagCount(out(id)));
  // Decision M1-D8 (b): in nonce mode, an OPEN with the nonce swallowed as text whose id also came
  // as a segment is a duplicate in disguise (found by fuzzing).
  const swallowedDup = res.fixes.some((f) => f.kind === 'open-in-text' && f.detail?.startsWith('nonce:') === true && res.segs.has(Number(f.detail.slice(6))));
  // Decision M1-D10: the same without the nonce (not copied), when the swallowing segment has more
  // tag-shaped strings than its source, so the OPEN was the model's (found by fuzzing). A source
  // that holds the tag as text has equal counts and is kept.
  const swallowedDupPlain = res.fixes.some(
    (f) =>
      f.kind === 'open-in-text' &&
      typeof f.id === 'number' &&
      f.detail?.startsWith('open:') === true &&
      res.segs.has(Number(f.detail.slice(5))) &&
      literalTagCount(out(f.id)) > literalTagCount(src(f.id)),
  );
  const ambiguous = swallowedDup || swallowedDupPlain || res.fixes.some((f) => AMBIGUOUS.has(f.kind));
  const cut = res.cut?.id ?? null;
  const rerequest = ambiguous
    ? ids
    : [...new Set([...res.missing, ...(cut === null ? [] : [cut]), ...merged, ...empty, ...truncated, ...tagMismatch])]
        .filter((id) => source.has(id))
        .sort((a, b) => a - b);
  return { rerequest, ambiguous, merged, empty, truncated, tagMismatch, cut };
}
