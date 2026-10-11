// SPA re-reads on the fixture sites (plan M5-E2, §3 #5 "segment ids stable across SPA
// re-extraction: 100% on fixture SPAs"). Each fixture (fixtures/spa/) runs its own router in
// jsdom; the page is read the way the content script reads it (extractPage, then keepIds against
// the last read), after each change an SPA makes.
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/types';
import { keepIds, readSignature } from '@/segment/stable';
import { extractPage } from './index.ts';

const SPA = path.resolve(import.meta.dirname, '../../fixtures/spa');
const router = fs.readFileSync(path.join(SPA, 'spa.js'), 'utf8');

interface Spa {
  go(id: string): void;
  rerender(): void;
  banner(): void;
  append(text: string): void;
  edit(text: string): void;
}

function open(name: string) {
  const html = fs.readFileSync(path.join(SPA, `${name}.html`), 'utf8').replace('<script src="spa.js"></script>', () => `<script>${router}</script>`);
  const dom = new JSDOM(html, { url: `https://quillmark.example/${name}.html`, runScripts: 'dangerously', pretendToBeVisual: true });
  const win = dom.window as unknown as Window & { __spa: Spa };
  let last: Segment[] = [];
  /** One read, as the content script does it. */
  const read = () => {
    const result = extractPage(win.document);
    if (!result.ok) throw new Error(`${name}: ${result.reason}`);
    keepIds(last, result.segments);
    last = result.segments;
    return result;
  };
  return { win, spa: win.__spa, read };
}

/** The share of `before`'s blocks that are in `after` with the same content and the same id. */
function kept(before: readonly Segment[], after: readonly Segment[]) {
  const ids = new Map(after.map((s) => [`${s.kind}\n${s.text}`, s.id]));
  const same = before.filter((s) => ids.get(`${s.kind}\n${s.text}`) === s.id).length;
  return same / before.length;
}

const flush = (win: Window, ms = 0) => new Promise((r) => win.setTimeout(r, ms));

describe.each(['docusaurus', 'mkdocs', 'gitbook'])('SPA fixture %s (plan M5-E2)', (name) => {
  it('keeps every unchanged block id across re-renders, route round trips, inserted banners and late content (§3 #5)', async () => {
    const { win, spa, read } = open(name);
    const first = read();
    expect(first.segments.length).toBeGreaterThan(8);

    // The same route rendered again from scratch.
    spa.rerender();
    const again = read();
    expect(kept(first.segments, again.segments)).toBe(1);
    expect(readSignature(again.url, again.segments)).toBe(readSignature(first.url, first.segments));

    // Away and back.
    spa.go('install');
    await flush(win, 400);
    const install = read();
    expect(install.url).toMatch(/\?p=install$/);
    spa.go('intro');
    await flush(win, 400);
    expect(kept(first.segments, read().segments)).toBe(1);

    // A banner above the layout: every domPath shifts, no id may.
    spa.banner();
    const shifted = read();
    expect(shifted.segments[0]?.domPath).not.toBe(first.segments[0]?.domPath);
    expect(kept(first.segments, shifted.segments)).toBe(1);

    // Late content: the old blocks keep their ids, the new one is new.
    const late = 'A section that loaded late, after the reader had already started on the page.';
    spa.append(late);
    const more = read();
    expect(kept(first.segments, more.segments)).toBe(1);
    expect(more.segments.length).toBe(first.segments.length + 1);
    expect(first.segments.map((s) => s.id)).not.toContain(more.segments.find((s) => s.text === late)?.id);

    // One block edited: only it gets a new id.
    spa.edit('This paragraph was rewritten in place by the page.');
    const edited = read();
    expect(edited.segments.filter((s) => !more.segments.some((m) => m.id === s.id))).toHaveLength(1);
  });

  it('a route change shows the new page; the repeated note and list keep the ids they had', async () => {
    const { win, spa, read } = open(name);
    const intro = read();
    spa.go('config');
    await flush(win, 400);
    const config = read();
    expect(config.title).toMatch(/^Configuration/);
    const repeated = config.segments.filter((s) => intro.segments.some((i) => i.text === s.text));
    // The note, the "Next steps" heading and its three items (and GitBook's footer line).
    expect(repeated.length).toBeGreaterThanOrEqual(5);
    for (const s of repeated) expect(intro.segments.find((i) => i.text === s.text)?.id).toBe(s.id);
  });
});
