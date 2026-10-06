// Chunker (DESIGN.md §5.7 Step 2, plan M1-E2). Groups the segments to translate into chunks of
// about 800–1,500 estimated source tokens, in document order:
// - only `translate: true` segments are sent (code blocks and symbol-only cells stay as they are);
// - a segment is never split (a segment is one paragraph, list item, cell…);
// - a run of consecutive segments with the same `groupId` (one table row) stays in one chunk;
// - a heading starts a new chunk once the current one has reached the minimum size, and a chunk
//   never ends with a heading when the next unit could carry it;
// - a single unit larger than the maximum becomes a chunk of its own.
//
// Sizes come from the job's `chunkTokens` (the profile's, plan M1 §5): it is the maximum, and the
// minimum keeps DESIGN's 800 : 1,500 proportion. Tokens are estimated on `inlineMarkup`, the text
// the model receives.

import { estimateTokens } from './tokens.ts';
import type { Segment } from './types.ts';

export interface Chunk {
  /** Position in the document, from 0. */
  index: number;
  /** The segments to translate, in document order. */
  segments: Segment[];
  /** Estimated source tokens of the segments' `inlineMarkup`. */
  tokens: number;
}

export interface ChunkLimits {
  minTokens: number;
  maxTokens: number;
}

/** DESIGN §5.7 Step 2: 800–1,500. */
export const DEFAULT_CHUNK_TOKENS = 1500;

export function chunkLimits(chunkTokens: number): ChunkLimits {
  const maxTokens = Math.max(1, Math.floor(chunkTokens));
  return { minTokens: Math.round((maxTokens * 800) / 1500), maxTokens };
}

interface Unit {
  segments: Segment[];
  tokens: number;
  heading: boolean;
}

/** Consecutive segments sharing a `groupId` form one unit; every other segment is a unit alone. */
function units(segments: readonly Segment[]): Unit[] {
  const out: Unit[] = [];
  let group: Unit | undefined;
  let groupId: string | undefined;
  for (const segment of segments) {
    if (!segment.translate) continue;
    const tokens = estimateTokens(segment.inlineMarkup);
    if (segment.groupId !== undefined && segment.groupId === groupId && group !== undefined) {
      group.segments.push(segment);
      group.tokens += tokens;
      continue;
    }
    group = { segments: [segment], tokens, heading: segment.kind === 'heading' };
    groupId = segment.groupId;
    out.push(group);
  }
  return out;
}

export function chunkSegments(segments: readonly Segment[], limits: ChunkLimits = chunkLimits(DEFAULT_CHUNK_TOKENS)): Chunk[] {
  const groups: Unit[][] = [];
  let current: Unit[] = [];
  let size = 0;
  const cut = (carry: Unit[]): void => {
    if (current.length > 0) groups.push(current);
    current = carry;
    size = carry.reduce((n, u) => n + u.tokens, 0);
  };
  for (const unit of units(segments)) {
    if (current.length > 0) {
      if (unit.heading && size >= limits.minTokens) cut([]);
      else if (size + unit.tokens > limits.maxTokens) {
        // Headings at the end of the chunk move to the next one, with the content they introduce.
        let k = current.length;
        while (k > 0 && current[k - 1]?.heading === true) k--;
        // Only when the carried headings and this unit fit together; otherwise cut before the unit.
        const carry = k > 0 ? current.slice(k) : [];
        const carried = carry.reduce((n, u) => n + u.tokens, 0);
        if (carry.length > 0 && carried + unit.tokens <= limits.maxTokens) {
          current = current.slice(0, k);
          cut(carry);
        } else cut([]);
      }
    }
    current.push(unit);
    size += unit.tokens;
  }
  cut([]);
  return groups.map((group, index) => ({
    index,
    segments: group.flatMap((u) => u.segments),
    tokens: group.reduce((n, u) => n + u.tokens, 0),
  }));
}
