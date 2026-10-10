// M3 dogfood B3: pages laid out with tables read as flowing text, and each made-up paragraph has
// its own place on the page for the viewport. The two fixtures are structural replicas (markup of
// the real page, text replaced by filler; see fixtures/sites/ATTRIBUTION.md).
import { describe, expect, it } from 'vitest';
import { extractPage } from '@/extract';
import { loadFixture } from './load.ts';

function read(slug: string) {
  const doc = loadFixture(slug);
  const targets = new Map<string, Element | Range>();
  const r = extractPage(doc, targets);
  if (!r.ok) throw new Error(`${slug}: ${r.reason}`);
  return { doc, r, targets };
}

describe('layout tables read as text (M3 dogfood B3)', () => {
  it('paulgraham.com-style essay: paragraphs, not one row of 290 cells; each has its own text Range', () => {
    const { doc, r, targets } = read('layout-table-essay');
    const kinds = new Set(r.segments.map((s) => s.kind));
    expect(kinds.has('table-cell')).toBe(false);
    expect(r.segments.filter((s) => s.kind === 'p').length).toBeGreaterThan(200);
    expect(r.segments.every((s) => s.groupId === undefined)).toBe(true);
    // Every segment has a target, and no two share one (the viewport can tell them apart).
    expect(targets.size).toBe(r.segments.length);
    expect(new Set(targets.values()).size).toBe(targets.size);
    const RangeType = doc.defaultView?.Range as typeof Range;
    const paras = r.segments.filter((s) => s.domPath.includes('/~p['));
    expect(paras.length).toBeGreaterThan(200);
    for (const s of paras) {
      const t = targets.get(s.id);
      expect(t instanceof RangeType, s.domPath).toBe(true);
      expect((t as Range).toString().replace(/\s+/g, ' ').trim()).toBe(s.text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim());
    }
  });

  it('news.ycombinator.com-style thread: comment paragraphs in order, no table cells, code kept', () => {
    const { r, targets } = read('layout-table-thread');
    expect(r.segments.some((s) => s.kind === 'table-cell')).toBe(false);
    expect(r.segments.filter((s) => s.kind === 'code')).toHaveLength(2);
    expect(r.segments.filter((s) => s.kind === 'p').length).toBeGreaterThan(200);
    const shared = new Map<Element | Range, string[]>();
    for (const s of r.segments) {
      const t = targets.get(s.id);
      if (t) shared.set(t, [...(shared.get(t) ?? []), `${s.kind} ${s.domPath} ${s.text.slice(0, 40)}`]);
    }
    expect([...shared.values()].filter((v) => v.length > 1)).toEqual([]);
  });
});
