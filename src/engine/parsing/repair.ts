// Repair plan (decision S2, "Repair policy"; ported from plan() in spikes/s2/parser.mjs). Decides
// which segments one follow-up call re-requests:
// - missing ones, the cut one and every one after it (those are missing too);
// - empty ones (whitespace only, where the source isn't);
// - suspect-merged ones: a neighbour is missing and either an OPEN was swallowed as text (v2) or
//   the length ratio is over `mergeFactor` × the median ratio of the chunk's other segments;
// - truncated ones (v1): closed implicitly by an unknown id, i.e. cut at a literal `<seg`;
// - literal-tag mismatch: the count of tag-shaped strings differs between source and output.
// Any dup, orphan close, unknown id or bad id makes the structure ambiguous: the whole chunk is
// re-requested. Everything else is kept.

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
  const truncated = res.fixes.flatMap((f, i) =>
    f.kind === 'implicit-close' && res.fixes[i + 1]?.kind === 'unknown' && typeof f.id === 'number' ? [f.id] : [],
  );
  const tagMismatch = present.filter((id) => literalTagCount(src(id)) !== literalTagCount(out(id)));
  const ambiguous = res.fixes.some((f) => AMBIGUOUS.has(f.kind));
  const cut = res.cut?.id ?? null;
  const rerequest = ambiguous
    ? ids
    : [...new Set([...res.missing, ...(cut === null ? [] : [cut]), ...merged, ...empty, ...truncated, ...tagMismatch])]
        .filter((id) => source.has(id))
        .sort((a, b) => a - b);
  return { rerequest, ambiguous, merged, empty, truncated, tagMismatch, cut };
}
