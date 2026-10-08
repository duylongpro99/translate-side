// @vitest-environment jsdom
// Per-block actions (plan M3-E5): show original inline, retranslate (skips the cache), copy.
import { IDBFactory } from 'fake-indexeddb';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '@/engine/index';
import { renderLines, translatorClient } from '@/engine/testing';
import type { LLMClient } from '@/llm/types';
import { keyScope, openTranslationCache, scopeHash, segmentKey, type TranslationCache } from '@/shared/cache';
import { GEMINI_PROFILE } from '@/shared/settings';
import { Jobs, type ClientResult, type JobDoc, type JobView, type SegState } from './jobs.ts';
import { copyText, SegmentList, type SegmentActions } from './SegmentList.tsx';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
function doc(n: number): JobDoc {
  const segments: Segment[] = Array.from({ length: n }, (_, i) => {
    const text = `P${i} ${words(20)}`;
    return { id: `s${i}`, kind: 'p', text, inlineMarkup: text, domPath: `/p[${i + 1}]`, translate: true };
  });
  return { url: 'https://example.com/', title: 'T', sourceLang: 'en', targetLang: 'vi', segments };
}
const ok = (client: LLMClient): (() => Promise<ClientResult>) => () => Promise.resolve({ ok: true, client, profile: GEMINI_PROFILE });
const newCache = () => openTranslationCache({ factory: new IDBFactory() }) as TranslationCache;
/** A translator that tags its output, so a run's text tells which client made it. */
const tagged = (tag: string) => translatorClient((lines) => renderLines(lines, (s) => `${tag}:${s}`), { model: GEMINI_PROFILE.model });
const keyOf = (seg: Segment) => segmentKey(scopeHash(keyScope({ targetLang: 'vi', model: GEMINI_PROFILE.model, strategy: 'single-pass' })), seg);
const textOf = (j: Jobs, id: string) => j.get(1)?.segs.get(id)?.text;

async function session(client: LLMClient, cache: TranslationCache) {
  const jobs = new Jobs({ translateClient: ok(client), cache, strategy: 'single-pass' });
  jobs.setActive(1);
  return jobs;
}

describe('Retranslate one block (M3-E5, decision M3-D2)', () => {
  it('skips the cache for that block only, and its new text replaces the stored entry', async () => {
    const cache = newCache();
    const d = doc(4);
    const j1 = await session(tagged('one'), cache);
    await j1.start(1, 'd1', d);
    await j1.cacheIdle();

    // A revisit: everything from the cache, no request.
    const second = tagged('two');
    const j2 = await session(second, cache);
    await j2.start(1, 'd2', d);
    expect(second.requests).toHaveLength(0);
    expect(textOf(j2, 's2')).toBe(`one:${d.segments[2]?.text}`);

    // Retranslate s2: one request with that block only, though the cache has it.
    await j2.retranslateSegment(1, 's2');
    await j2.cacheIdle();
    expect(second.requests).toHaveLength(1);
    expect(second.requests[0]?.messages.at(-1)?.content).toContain('P2 word0');
    expect(second.requests[0]?.messages.at(-1)?.content).not.toContain('P1 word0');
    expect(textOf(j2, 's2')).toBe(`two:${d.segments[2]?.text}`);
    expect(textOf(j2, 's1')).toBe(`one:${d.segments[1]?.text}`);
    expect(j2.get(1)?.status).toBe('done');
    expect(j2.get(1)?.counts).toEqual({ total: 4, final: 4, failed: 0 });

    // The stored entry is the new one: the next visit shows it, still with no request.
    const third = tagged('three');
    const j3 = await session(third, cache);
    await j3.start(1, 'd3', d);
    expect(third.requests).toHaveLength(0);
    expect(textOf(j3, 's2')).toBe(`two:${d.segments[2]?.text}`);
  });

  it('replaces a stored entry of a higher revision too (a retranslate always wins)', async () => {
    const cache = newCache();
    const d = doc(2);
    const seg = d.segments[0] as Segment;
    await cache.putMany(new Map([[keyOf(seg), { text: 'revised earlier', revision: 2, attempt: 1 }]]));
    const client = tagged('new');
    const j = await session(client, cache);
    await j.start(1, 'd1', d);
    expect(textOf(j, 's0')).toBe('revised earlier');
    await j.retranslateSegment(1, 's0');
    await j.cacheIdle();
    expect(textOf(j, 's0')).toBe(`new:${seg.text}`);
    expect((await cache.getMany([keyOf(seg)])).get(keyOf(seg))?.text).toBe(`new:${seg.text}`);
  });

  it('keeps the earlier text on screen while it runs, and after a failure, which it reports', async () => {
    const cache = newCache();
    const d = doc(2);
    const j = await session(tagged('one'), cache);
    await j.start(1, 'd1', d);
    await j.cacheIdle();
    const before = textOf(j, 's0');

    let calls = 0;
    const failing = new Jobs({ translateClient: () => (calls++ ? Promise.resolve({ ok: false, error: { kind: 'auth', message: 'bad key' } }) : ok(tagged('x'))()), cache, strategy: 'single-pass' });
    failing.setActive(1);
    await failing.start(1, 'd2', d);
    const views: (SegState | undefined)[] = [];
    failing.subscribe(() => views.push(failing.get(1)?.segs.get('s0')));
    await failing.retranslateSegment(1, 's0');
    // While it ran: pending, with the earlier text still shown.
    expect(views[0]).toEqual({ status: 'pending', text: before });
    const after = failing.get(1)?.segs.get('s0');
    expect(after?.status).toBe('final');
    expect(after?.text).toBe(before);
    expect(after?.redoError?.kind).toBe('auth');
    await failing.cacheIdle();
    expect((await cache.getMany([keyOf(d.segments[0] as Segment)])).get(keyOf(d.segments[0] as Segment))?.text).toBe(before);
  });

  it('does nothing for a block that is not translated yet, or already being redone', async () => {
    const client = tagged('one');
    const j = new Jobs({ translateClient: ok(client), strategy: 'single-pass' });
    j.setActive(1);
    await j.start(1, 'd1', doc(2));
    const sent = client.requests.length;
    const a = j.retranslateSegment(1, 's0');
    const b = j.retranslateSegment(1, 's0');
    await Promise.all([a, b]);
    await j.retranslateSegment(1, 'nope');
    expect(client.requests.length).toBe(sent + 1);
  });
});

describe('block actions in the panel (M3-E5)', () => {
  let root: HTMLElement;
  const writeText = vi.fn((text: string) => (void text, Promise.resolve()));
  beforeEach(() => {
    root = document.createElement('div');
    document.body.replaceChildren(root);
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  const p1: Segment = { id: 'p1', kind: 'p', text: 'Read the docs.', inlineMarkup: 'Read the [link]docs[/link].', domPath: '/p[1]', translate: true };
  const p2: Segment = { id: 'p2', kind: 'p', text: 'Second one.', inlineMarkup: 'Second one.', domPath: '/p[2]', translate: true };
  const p3: Segment = { id: 'p3', kind: 'p', text: 'Third.', inlineMarkup: 'Third.', domPath: '/p[3]', translate: true };
  const code: Segment = { id: 'c', kind: 'code', text: 'let x = 1;', inlineMarkup: 'let x = 1;', domPath: '/pre[1]', translate: false };
  const states = new Map<string, SegState>([
    ['p1', { status: 'final', text: 'Đọc [link]tài liệu[/link].', revision: 1 }],
    ['p2', { status: 'final', text: 'Cái thứ hai.', revision: 1 }],
    ['p3', { status: 'pending' }],
  ]);
  const block = (id: string) => root.querySelector(`[data-id="${id}"]`) as HTMLElement;
  const button = (id: string, name: string) => block(id).querySelector(`[data-testid=seg-${name}]`) as HTMLButtonElement | null;

  function mount(actions: SegmentActions) {
    act(() => render(<SegmentList segments={[p1, p2, p3, code]} states={states as JobView['segs']} actions={actions} />, root));
  }

  it('Original shows the source under that block only, as text, and hides it again', () => {
    mount({ retry: () => {}, retranslate: () => {} });
    expect(root.querySelector('[data-testid=seg-original-text]')).toBeNull();
    act(() => button('p1', 'original')?.click());
    const shown = block('p1').querySelector('[data-testid=seg-original-text]');
    expect(shown?.textContent).toBe('Read the docs.');
    expect(shown?.querySelector('.seg__link')?.textContent).toBe('docs');
    expect(button('p1', 'original')?.getAttribute('aria-pressed')).toBe('true');
    expect(block('p2').querySelector('[data-testid=seg-original-text]')).toBeNull();
    act(() => button('p1', 'original')?.click());
    expect(root.querySelector('[data-testid=seg-original-text]')).toBeNull();
  });

  it('Retranslate asks for that block; a block not translated yet has no actions', () => {
    const asked: string[] = [];
    mount({ retry: () => {}, retranslate: (id) => asked.push(id) });
    act(() => button('p2', 'retranslate')?.click());
    expect(asked).toEqual(['p2']);
    expect(block('p3').querySelector('.seg__actions')).toBeNull();
  });

  it('Copy puts the translated text on the clipboard as plain text (no markers); a code block copies its code', async () => {
    mount({ retry: () => {} });
    await act(async () => button('p1', 'copy')?.click());
    await act(async () => {});
    expect(writeText).toHaveBeenLastCalledWith('Đọc tài liệu.');
    expect(button('p1', 'copy')?.textContent).toBe('Copied');
    await act(async () => button('c', 'copy')?.click());
    expect(writeText).toHaveBeenLastCalledWith('let x = 1;');
    // Without a Retranslate action (e.g. no job), the button is not offered.
    expect(button('p1', 'retranslate')).toBeNull();
  });

  it('copyText: the shown text without markers; the original when nothing is translated', () => {
    expect(copyText(p1, states.get('p1'))).toBe('Đọc tài liệu.');
    expect(copyText(p1, undefined)).toBe('Read the docs.');
    expect(copyText(code, undefined)).toBe('let x = 1;');
  });

  it('a failed Retranslate says so and keeps the earlier text', () => {
    const failed = new Map(states);
    failed.set('p2', { status: 'final', text: 'Cái thứ hai.', revision: 1, redoError: { kind: 'rate_limit', message: '429' } });
    act(() => render(<SegmentList segments={[p2]} states={failed as JobView['segs']} actions={{ retry: () => {} }} />, root));
    expect(block('p2').querySelector('[data-testid=seg-redo-failed]')?.textContent).toContain('Retranslate failed');
    expect(block('p2').textContent).toContain('Cái thứ hai.');
  });
});
