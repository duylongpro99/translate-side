import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, inline, listPassageIds, loadPassage, parsePassage } from './passages';

const ROOT = path.resolve(import.meta.dirname, '../..');
const FM = '---\nid: x\ncategory: docs\ntitle: T\nurl: https://example.com\nauthor: A\nlicense: MIT\n---\n';

describe('inline', () => {
  it('maps links, emphasis and code to the engine markers', () => {
    const r = inline('A **bold** and _slanted_ word, [a link](https://x.y) and `a_b *c*`.');
    expect(r.markup).toBe('A *bold* and *slanted* word, [link]a link[/link] and `a_b *c*`.');
    expect(r.text).toBe('A bold and slanted word, a link and a_b *c*.');
  });
  it('leaves snake_case and bare brackets alone', () => {
    expect(inline('use snake_case_name and [X]HTML').markup).toBe('use snake_case_name and [X]HTML');
  });
});

describe('parsePassage', () => {
  it('builds headings, paragraphs, items, quotes and code', () => {
    const p = parsePassage(`${FM}# Title\n\nOne line\nsecond line.\n\n- item\n\n> quoted\n> more\n\n\`\`\`rust\nfn a() {}\n\nfn b() {}\n\`\`\`\n`);
    expect(p.segments.map((s) => [s.kind, s.text, s.translate])).toEqual([
      ['heading', 'Title', true],
      ['p', 'One line second line.', true],
      ['li', 'item', true],
      ['quote', 'quoted more', true],
      ['code', 'fn a() {}\n\nfn b() {}', false],
    ]);
    expect(p.segments[0]?.level).toBe(1);
    expect(p.segments[4]?.codeLang).toBe('rust');
    expect(new Set(p.segments.map((s) => s.id)).size).toBe(5);
  });
  it('rejects missing front matter keys and empty passages', () => {
    expect(() => parsePassage('no front matter')).toThrow(/front matter/);
    expect(() => parsePassage(FM.replace('license: MIT\n', '') + 'text')).toThrow(/license/);
    expect(() => parsePassage(`${FM}\`\`\`\ncode\n\`\`\`\n`)).toThrow(/nothing to translate/);
  });
});

describe('the eval set', () => {
  const ids = listPassageIds(ROOT);
  it('has 20 to 30 passages, all four categories, unique ids', () => {
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(ids.length).toBeLessThanOrEqual(30);
    expect(new Set(ids).size).toBe(ids.length);
    const cats = new Set(ids.map((id) => loadPassage(ROOT, id).meta.category));
    for (const c of CATEGORIES) expect(cats.has(c)).toBe(true);
  });
  it('records a source, author and license for each passage, with some code and the Rust async terms', () => {
    const all = ids.map((id) => loadPassage(ROOT, id));
    for (const p of all) expect(p.meta.url).toMatch(/^https?:\/\//);
    expect(all.filter((p) => p.segments.some((s) => s.kind === 'code')).length).toBeGreaterThanOrEqual(5);
    const rust = all.filter((p) => p.meta.id.startsWith('rust-async')).map((p) => p.segments.map((s) => s.text).join(' ')).join(' ');
    expect(rust).toMatch(/future/i);
    expect(rust).toMatch(/executor/i);
  });
});
