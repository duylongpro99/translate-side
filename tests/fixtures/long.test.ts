// The long fixtures (plan M5-E4/E5, fixtures/long, made by scripts/make-long-fixtures.mjs): a 100-screen article and
// a large table. They pin what lazy mode and the table rules work on: the number of segments, rows kept in one chunk.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkSegments, chunkLimits } from '@/engine/chunker';
import { extractPage } from '@/extract';
import { LAZY_SEGMENTS } from '@/entrypoints/sidepanel/jobs';
import { FIXTURES, loadHtml } from './load.ts';

const read = (name: string) => {
  const doc = loadHtml(fs.readFileSync(path.join(FIXTURES, 'long', name), 'utf8'), `https://long.example/${name}`);
  const r = extractPage(doc);
  if (!r.ok) throw new Error(`${name}: ${r.reason}`);
  return r.segments;
};

describe('fixtures/long', () => {
  it('long-100-screens: far above the lazy threshold, with figures whose alt text is read', () => {
    const segs = read('long-100-screens.html');
    const translatable = segs.filter((s) => s.translate);
    expect(translatable.length).toBeGreaterThan(LAZY_SEGMENTS * 1.5);
    expect(segs.filter((s) => s.alt)).toHaveLength(45);
    expect(segs.filter((s) => s.kind === 'code')).toHaveLength(45);
    expect(segs.filter((s) => s.kind === 'heading')).toHaveLength(46);
  });

  it('large-table: 121 rows (header included), each in one chunk, the caption read as a caption', () => {
    const segs = read('large-table.html');
    const cells = segs.filter((s) => s.kind === 'table-cell');
    const rows = new Set(cells.map((s) => s.groupId));
    expect(rows.size).toBe(121);
    expect(segs.some((s) => s.kind === 'caption' && s.text.startsWith('Table 1.'))).toBe(true);
    const chunks = chunkSegments(segs, chunkLimits(1500));
    for (const row of rows) {
      const holding = chunks.filter((c) => c.segments.some((s) => s.groupId === row));
      expect(holding, `row ${row}`).toHaveLength(1);
    }
    expect(chunks.length).toBeGreaterThan(3);
  });
});
