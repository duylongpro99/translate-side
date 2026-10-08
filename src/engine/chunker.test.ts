import { describe, expect, it } from 'vitest';
import { chunkLimits, chunkSegments, type Chunk } from './chunker.ts';
import { estimateTokens } from './tokens.ts';
import type { Segment, SegmentKind } from './types.ts';

let next = 0;
/** A segment of about `tokens` estimated tokens. */
function seg(tokens: number, over: Partial<Segment> & { kind?: SegmentKind } = {}): Segment {
  const text = 'x'.repeat(Math.max(1, Math.round(tokens * 3.5)));
  return { id: `s${next++}`, kind: 'p', text, inlineMarkup: text, domPath: `p[${next}]`, translate: true, ...over };
}
const h = (tokens = 5, level = 2): Segment => seg(tokens, { kind: 'heading', level });
const ids = (chunks: Chunk[]): string[][] => chunks.map((c) => c.segments.map((s) => s.id));
const limits = chunkLimits(1500);

/** Every chunker invariant that holds for any input. */
function checkInvariants(input: Segment[], chunks: Chunk[], lim = limits): void {
  const sent = input.filter((s) => s.translate);
  // Every translatable segment exactly once, in document order.
  expect(chunks.flatMap((c) => c.segments)).toEqual(sent);
  chunks.forEach((c, i) => {
    expect(c.index).toBe(i);
    expect(c.segments.length).toBeGreaterThan(0);
    expect(c.tokens).toBe(c.segments.reduce((n, s) => n + estimateTokens(s.inlineMarkup), 0));
  });
  // A groupId run is never split across chunks.
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1]?.segments.at(-1);
    const first = chunks[i]?.segments[0];
    if (prev?.groupId !== undefined) expect(first?.groupId).not.toBe(prev.groupId);
  }
  // A chunk ends with headings only when they and the next unit together would exceed the maximum.
  const unitTokens = (segs: Segment[]): number => {
    const g = segs[0]?.groupId;
    let n = 0;
    for (const s of segs) {
      if (s !== segs[0] && (g === undefined || s.groupId !== g)) break;
      n += estimateTokens(s.inlineMarkup);
    }
    return n;
  };
  for (let i = 0; i + 1 < chunks.length; i++) {
    const segs = chunks[i]?.segments ?? [];
    let k = segs.length;
    while (k > 0 && segs[k - 1]?.kind === 'heading') k--;
    if (k === segs.length || k === 0) continue;
    const trailing = segs.slice(k).reduce((n, s) => n + estimateTokens(s.inlineMarkup), 0);
    expect(trailing + unitTokens(chunks[i + 1]?.segments ?? []), `chunk ${i} ends with a heading`).toBeGreaterThan(lim.maxTokens);
  }
  // Over the maximum only when the chunk is one unit (a single segment or a single group).
  for (const c of chunks) {
    if (c.tokens > lim.maxTokens) {
      const groups = new Set(c.segments.map((s) => s.groupId ?? s.id));
      expect(groups.size).toBe(1);
    }
  }
}

describe('chunkLimits', () => {
  it('keeps DESIGN 800–1,500 proportion', () => {
    expect(chunkLimits(1500)).toEqual({ minTokens: 800, maxTokens: 1500 });
    expect(chunkLimits(750)).toEqual({ minTokens: 400, maxTokens: 750 });
  });
});

describe('chunkSegments', () => {
  it('returns no chunk for no translatable segment', () => {
    expect(chunkSegments([])).toEqual([]);
    expect(chunkSegments([seg(10, { kind: 'code', translate: false })])).toEqual([]);
  });

  it('skips segments that are not translated, without breaking the chunk', () => {
    const input = [seg(100), seg(100, { kind: 'code', translate: false }), seg(100)];
    const chunks = chunkSegments(input);
    expect(ids(chunks)).toEqual([[input[0]?.id, input[2]?.id]]);
    checkInvariants(input, chunks);
  });

  it('fills up to the maximum and never splits a segment', () => {
    const input = [seg(600), seg(600), seg(600), seg(600)];
    const chunks = chunkSegments(input);
    expect(chunks.map((c) => c.segments.length)).toEqual([2, 2]);
    checkInvariants(input, chunks);
  });

  it('puts a segment larger than the maximum in a chunk of its own', () => {
    const input = [seg(300), seg(2000), seg(300)];
    const chunks = chunkSegments(input);
    expect(chunks.map((c) => c.segments.length)).toEqual([1, 1, 1]);
    checkInvariants(input, chunks);
  });

  it('cuts at a heading once the chunk has the minimum size', () => {
    const input = [h(), seg(500), seg(400), h(), seg(100), h(), seg(100)];
    const chunks = chunkSegments(input);
    // 905 tokens ≥ 800 at the second heading → cut; 110 < 800 at the third → no cut.
    expect(ids(chunks)).toEqual([input.slice(0, 3).map((s) => s.id), input.slice(3).map((s) => s.id)]);
    checkInvariants(input, chunks);
  });

  it('does not cut at a heading below the minimum size', () => {
    const input = [seg(300), h(), seg(300), h(), seg(300)];
    expect(chunkSegments(input)).toHaveLength(1);
  });

  it('never ends a chunk with a heading that the next unit could carry', () => {
    const input = [seg(760), h(), seg(760)];
    const chunks = chunkSegments(input);
    expect(ids(chunks)).toEqual([[input[0]?.id], [input[1]?.id, input[2]?.id]]);
    expect(chunks.every((c) => c.segments.at(-1)?.kind !== 'heading')).toBe(true);
    checkInvariants(input, chunks);
  });

  it('carries a run of trailing headings together', () => {
    const input = [seg(760), h(5, 2), h(5, 3), seg(760)];
    const chunks = chunkSegments(input);
    expect(ids(chunks)).toEqual([[input[0]?.id], input.slice(1).map((s) => s.id)]);
  });

  // Review T-B1: two headings around the minimum used to leave the first one at the chunk's end.
  it('does not leave a heading at the end when a second heading cuts (two headings around the minimum)', () => {
    const input = [seg(786), h(20), h(20), seg(200)];
    const chunks = chunkSegments(input);
    // 786 tokens of content before the headings < 800: no cut at all.
    expect(ids(chunks)).toEqual([input.map((s) => s.id)]);
    checkInvariants(input, chunks);
  });

  it('cuts before a run of headings once the content before them has the minimum size', () => {
    const input = [seg(810), h(20), h(20), seg(200)];
    const chunks = chunkSegments(input);
    expect(ids(chunks)).toEqual([[input[0]?.id], input.slice(1).map((s) => s.id)]);
    checkInvariants(input, chunks);
  });

  // Review R2-1: a heading below the minimum must still respect the maximum.
  it('cuts a run of headings at the maximum (a page that is mostly headings)', () => {
    const input = [seg(700), ...Array.from({ length: 60 }, () => h(30)), seg(100)];
    const chunks = chunkSegments(input);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.tokens <= limits.maxTokens)).toBe(true);
    checkInvariants(input, chunks);
  });

  it('cuts a page of only short headings at the maximum (tester repro R2-1)', () => {
    const input = Array.from({ length: 400 }, (_, i): Segment => {
      const text = `Section ${String(i).padStart(3, '0')}: overview`;
      return { ...h(), text, inlineMarkup: text };
    });
    const chunks = chunkSegments(input);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.tokens <= limits.maxTokens)).toBe(true);
    checkInvariants(input, chunks);
  });

  it('keeps a table row (groupId) together even across the maximum', () => {
    const row = (g: string, n: number, t: number): Segment[] => Array.from({ length: n }, () => seg(t, { kind: 'table-cell', groupId: g }));
    const input = [seg(1000), ...row('r1', 4, 200), ...row('r2', 3, 100)];
    const chunks = chunkSegments(input);
    expect(chunks.map((c) => c.segments.map((s) => s.groupId ?? '-').join(','))).toEqual(['-', 'r1,r1,r1,r1,r2,r2,r2']);
    checkInvariants(input, chunks);
  });

  it('a group interrupted by a non-translated cell stays one unit', () => {
    const input = [seg(1400), seg(100, { groupId: 'r' }), seg(1, { groupId: 'r', translate: false }), seg(100, { groupId: 'r' })];
    const chunks = chunkSegments(input);
    expect(chunks.map((c) => c.segments.length)).toEqual([1, 2]);
  });

  it('honors a smaller chunkTokens', () => {
    const input = Array.from({ length: 10 }, () => seg(100));
    const lim = chunkLimits(300);
    const chunks = chunkSegments(input, lim);
    expect(chunks.every((c) => c.tokens <= 300)).toBe(true);
    checkInvariants(input, chunks, lim);
  });

  it('holds its invariants on 500 random documents', () => {
    let s = 11;
    const rng = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)] as T;
    for (let k = 0; k < 500; k++) {
      const input: Segment[] = [];
      const n = 1 + Math.floor(rng() * 80);
      // One document in four is mostly headings (an index or a changelog).
      const headings = rng() < 0.25 ? 0.7 : 0.1;
      for (let i = 0; i < n; i++) {
        const r = rng();
        if (r < headings) input.push(h(1 + Math.floor(rng() * 40)));
        else if (r < headings + 0.05) input.push(seg(10 + Math.floor(rng() * 200), { kind: 'code', translate: false }));
        else if (r < headings + 0.15) {
          const g = `g${k}-${i}`;
          for (let c = 0, m = 1 + Math.floor(rng() * 6); c < m; c++) input.push(seg(1 + Math.floor(rng() * 150), { kind: 'table-cell', groupId: g, translate: rng() > 0.1 }));
        } else input.push(seg(pick([5, 30, 80, 150, 400, 900, 1700]) * (0.5 + rng())));
      }
      const lim = chunkLimits(pick([400, 1000, 1500]));
      checkInvariants(input, chunkSegments(input, lim), lim);
    }
  });
});

describe('breakBefore: a chunk starts where the screen does (plan M3-E1)', () => {
  it('cuts before the unit holding the segment, with the headings just before it', () => {
    const input = [seg(300), seg(300), h(), seg(300), seg(300)];
    const chunks = chunkSegments(input, limits, input[3]?.id);
    checkInvariants(input, chunks);
    expect(ids(chunks)).toEqual([[input[0], input[1]].map((s) => s?.id), [input[2], input[3], input[4]].map((s) => s?.id)]);
  });

  it('keeps a table row whole: the cut goes before the row', () => {
    const input = [seg(300), seg(50, { groupId: 'r' }), seg(50, { groupId: 'r' }), seg(300)];
    const chunks = chunkSegments(input, limits, input[2]?.id);
    checkInvariants(input, chunks);
    expect(ids(chunks)).toEqual([[input[0]?.id], [input[1], input[2], input[3]].map((s) => s?.id)]);
  });

  it('changes nothing at the first segment, and the size limits still apply after the cut', () => {
    const input = Array.from({ length: 6 }, () => seg(600));
    expect(ids(chunkSegments(input, limits, input[0]?.id))).toEqual(ids(chunkSegments(input, limits)));
    const chunks = chunkSegments(input, limits, input[3]?.id);
    checkInvariants(input, chunks);
    expect(ids(chunks)).toEqual([[input[0], input[1]], [input[2]], [input[3], input[4]], [input[5]]].map((c) => c.map((s) => s?.id)));
  });
});
