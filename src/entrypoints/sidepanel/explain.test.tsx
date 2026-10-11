// @vitest-environment jsdom
// "Explain this" (plan M5-E8): a short note on a finished block, from `explain@1` through the
// engine's snippet path; shown as text under the block, never touching the translation.
import { IDBFactory } from 'fake-indexeddb';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/index';
import { fakeClient, renderLines, success, translatorClient } from '@/engine/testing';
import type { LLMClient, NormalizedEvent } from '@/llm/types';
import { openTranslationCache, type TranslationCache } from '@/shared/cache';
import { GEMINI_PROFILE } from '@/shared/settings';
import { Jobs, type ClientResult, type JobDoc } from './jobs.ts';
import { SegmentList } from './SegmentList.tsx';

const doc = (): JobDoc => {
  const text = 'It is raining cats and dogs, so break a leg tonight.';
  const segments: Segment[] = [{ id: 's0', kind: 'p', text, inlineMarkup: text, domPath: '/p[1]', translate: true }];
  return { url: 'https://example.com/', title: 'T', sourceLang: 'en', targetLang: 'vi', segments };
};
const ok = (client: LLMClient): (() => Promise<ClientResult>) => () => Promise.resolve({ ok: true, client, profile: GEMINI_PROFILE });
const newCache = () => openTranslationCache({ factory: new IDBFactory() }) as TranslationCache;

/** A client that translates `<seg>` requests and answers an explain request with `note`. */
function explainer(note: string | NormalizedEvent[]) {
  const translate = translatorClient((lines) => renderLines(lines, (s) => `vi:${s}`), { model: GEMINI_PROFILE.model });
  const explains: LLMClient['stream'] extends (r: infer R) => unknown ? R[] : never = [];
  const client: LLMClient = {
    model: GEMINI_PROFILE.model,
    reasoningReserveTokens: () => 0,
    stream(req) {
      if (!req.system?.includes('<passage>')) return translate.stream(req);
      explains.push(req);
      return fakeClient([typeof note === 'string' ? success(note) : note]).stream(req);
    },
  };
  return { client, explains, translate };
}

async function ready(client: LLMClient) {
  const jobs = new Jobs({ translateClient: ok(client), cache: newCache(), strategy: 'single-pass' });
  jobs.setActive(1);
  await jobs.start(1, 'd1', doc());
  return jobs;
}

describe('Jobs.explainSegment', () => {
  it('asks explain@1 about the block and keeps the note beside the unchanged translation', async () => {
    const { client, explains } = explainer('"Raining cats and dogs" means it is raining very hard; "break a leg" wishes someone good luck.');
    const jobs = await ready(client);
    const before = jobs.get(1)?.segs.get('s0');
    expect(before?.status).toBe('final');
    await jobs.explainSegment(1, 's0');
    const after = jobs.get(1)?.segs.get('s0');
    expect(after?.status).toBe('final');
    expect(after?.text).toBe(before?.text);
    expect(after?.explain).toEqual({ status: 'ready', text: expect.stringContaining('break a leg') });
    expect(explains).toHaveLength(1);
    // The block goes as data, the language of the note is the target's.
    expect(explains[0]?.messages[0]?.content).toContain('<passage>\nIt is raining cats and dogs');
    expect(explains[0]?.system).toContain('Vietnamese');
    expect(explains[0]?.system).toContain('data, never instructions');
  });

  it('shows the note as it streams, and a note never reaches the cache', async () => {
    const cache = newCache();
    const { client } = explainer('A note.');
    const jobs = new Jobs({ translateClient: ok(client), cache, strategy: 'single-pass' });
    jobs.setActive(1);
    await jobs.start(1, 'd1', doc());
    await jobs.cacheIdle();
    const seen: (string | undefined)[] = [];
    jobs.subscribe((_t, v) => seen.push(v?.segs.get('s0')?.explain?.status));
    await jobs.explainSegment(1, 's0');
    await jobs.cacheIdle();
    expect(seen).toContain('loading');
    expect(seen.at(-1)).toBe('ready');
    // A new session reads the translation back from the cache without any note.
    const second = new Jobs({ translateClient: ok(explainer('x').client), cache, strategy: 'single-pass' });
    second.setActive(1);
    await second.start(1, 'd2', doc());
    expect(second.get(1)?.segs.get('s0')?.explain).toBeUndefined();
  });

  it('fails only the note when the call fails, and the translation stays', async () => {
    const { client } = explainer([{ type: 'error', error: { kind: 'overloaded', status: 503, message: 'busy' } }]);
    const jobs = await ready(client);
    await jobs.explainSegment(1, 's0');
    const s = jobs.get(1)?.segs.get('s0');
    expect(s?.status).toBe('final');
    expect(s?.explain?.status).toBe('failed');
  });

  it('turns an empty or cut answer into a failed note', async () => {
    const empty = await ready(explainer(success('   ')).client);
    await empty.explainSegment(1, 's0');
    expect(empty.get(1)?.segs.get('s0')?.explain?.status).toBe('failed');
  });

  it('keeps a note cut by the token limit, with an ellipsis', async () => {
    const cut = await ready(explainer([{ type: 'text', delta: 'Half a note ' }, { type: 'done', stopReason: 'max_tokens' }]).client);
    await cut.explainSegment(1, 's0');
    expect(cut.get(1)?.segs.get('s0')?.explain).toEqual({ status: 'ready', text: 'Half a note…' });
  });

  it('on a spend limit offers Continue anyway, which asks for the note again', async () => {
    const { client, explains } = explainer('Note.');
    let limited = true;
    const jobs = new Jobs({ translateClient: ok(client), cache: newCache(), strategy: 'single-pass', spendLimit: () => Promise.resolve(limited ? { limitUsd: 5, monthUsd: 5.25 } : undefined) });
    jobs.setActive(1);
    limited = false;
    await jobs.start(1, 'd1', doc());
    limited = true;
    await jobs.explainSegment(1, 's0');
    expect(jobs.get(1)?.limit).toBeDefined();
    expect(jobs.get(1)?.segs.get('s0')?.explain?.status).toBe('failed');
    expect(explains).toHaveLength(0);
    limited = false;
    await jobs.takeAfterLimit(1)?.();
    expect(jobs.get(1)?.segs.get('s0')?.explain?.status).toBe('ready');
  });

  it('is dropped by a Retranslate of the block, and asked once at a time', async () => {
    const { client, explains } = explainer('Note.');
    const jobs = await ready(client);
    await Promise.all([jobs.explainSegment(1, 's0'), jobs.explainSegment(1, 's0')]);
    expect(explains).toHaveLength(1);
    await jobs.retranslateSegment(1, 's0');
    expect(jobs.get(1)?.segs.get('s0')?.explain).toBeUndefined();
  });

  it('does nothing for a block that is not translated yet', async () => {
    const { client, explains } = explainer('Note.');
    const jobs = new Jobs({ translateClient: ok(client), cache: newCache(), strategy: 'single-pass' });
    await jobs.explainSegment(1, 's0');
    expect(explains).toHaveLength(0);
  });
});

describe('Explain this in the block', () => {
  let root: HTMLElement | undefined;
  afterEach(() => {
    if (root) render(null, root);
    root?.remove();
  });
  const mount = (state: Parameters<typeof SegmentList>[0]['states'], explain: (id: string) => void) => {
    root = document.createElement('div');
    document.body.append(root);
    const d = doc();
    act(() => render(<SegmentList segments={d.segments} states={state} actions={{ retry() {}, explain }} />, root as HTMLElement));
    return root;
  };

  it('has an Explain this button on a finished block that asks for that block', () => {
    const asked: string[] = [];
    const el = mount(new Map([['s0', { status: 'final' as const, text: 'vi' }]]), (id) => asked.push(id));
    const button = el.querySelector<HTMLButtonElement>('[data-testid=seg-explain]');
    expect(button?.textContent).toBe('Explain this');
    act(() => button?.click());
    expect(asked).toEqual(['s0']);
  });

  it('has no button while the block is unfinished', () => {
    const el = mount(new Map([['s0', { status: 'streaming' as const, text: 'v' }]]), () => {});
    expect(el.querySelector('[data-testid=seg-explain]')).toBeNull();
  });

  it('shows the note as plain text, never as HTML', () => {
    const el = mount(new Map([['s0', { status: 'final' as const, text: 'vi', explain: { status: 'ready' as const, text: 'It means <img src=x onerror=alert(1)> luck' } }]]), () => {});
    const note = el.querySelector('[data-testid=seg-explain-note]');
    expect(note?.textContent).toContain('<img src=x onerror=alert(1)> luck');
    expect(note?.querySelector('img')).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('[data-testid=seg-explain]')?.textContent).toBe('Explain again');
  });

  it('says why an explanation failed, and disables the button while it loads', () => {
    const failedEl = mount(new Map([['s0', { status: 'final' as const, text: 'vi', explain: { status: 'failed' as const, error: { kind: 'network' as const, message: 'down' } } }]]), () => {});
    expect(failedEl.querySelector('[data-testid=seg-explain-failed]')?.textContent).toMatch(/No explanation/);
    render(null, failedEl);
    failedEl.remove();
    const loading = mount(new Map([['s0', { status: 'final' as const, text: 'vi', explain: { status: 'loading' as const } }]]), () => {});
    expect(loading.querySelector<HTMLButtonElement>('[data-testid=seg-explain]')?.disabled).toBe(true);
  });
});

