// @vitest-environment jsdom
// Selection mode in the panel (plan M3-E4): a record the worker left becomes a translation job on
// its own, shown whatever the page is, including one whose extraction failed.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { translatorClient } from '@/engine/testing';
import type { LLMClient } from '@/llm/types';
import { MAX_SELECTION_CHARS, selectionParagraphs, type SnippetRecord } from '@/shared/snippet';
import { GEMINI_PROFILE } from '@/shared/settings';
import { App } from './App.tsx';
import type { PanelController, PanelView } from './controller.ts';
import type { ClientResult, JobView } from './jobs.ts';
import { snippetView } from './snippet.ts';
import { createTranslator } from './translator.ts';

type Api = Parameters<typeof createTranslator>[0];

function fakeApi() {
  const onSession = new Set<(c: Record<string, { newValue?: unknown }>) => void>();
  const session = new Map<string, unknown>();
  const none = { addListener: () => {}, removeListener: () => {} };
  const api = {
    storage: {
      sync: { get: (k: string) => Promise.resolve(k === 'prefs' ? { prefs: { targetLang: 'vi', sourceLang: 'auto' } } : {}), onChanged: none },
      local: { onChanged: none },
      session: {
        get: (k: string) => Promise.resolve(session.has(k) ? { [k]: session.get(k) } : {}),
        remove: (k: string) => (session.delete(k), Promise.resolve()),
        onChanged: { addListener: (fn: never) => onSession.add(fn), removeListener: (fn: never) => onSession.delete(fn) },
      },
    },
    permissions: { onAdded: none, request: () => Promise.resolve(true) },
    runtime: { openOptionsPage: () => Promise.resolve() },
    i18n: { getUILanguage: () => 'en' },
  } as unknown as Api;
  return {
    api,
    /** What the worker does: write the record, and storage.session.onChanged tells the panel. */
    leave(tabId: number, record: SnippetRecord) {
      session.set(`snippet:${tabId}`, record);
      for (const fn of onSession) fn({ [`snippet:${tabId}`]: { newValue: record } });
    },
    session,
  };
}

const settle = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await settle(2);
  }
}
const record = (text: string, at = 1, url = 'https://example.com/a'): SnippetRecord => ({ at, url, text });

function mount(t: ReturnType<typeof createTranslator>, view: PanelView, tabId = 3) {
  let listener: ((v: PanelView, id: number | undefined) => void) | undefined;
  const controller = { view, tabId, subscribe: (fn: typeof listener) => ((listener = fn), fn?.(view, tabId), () => undefined), retry: () => undefined };
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  act(() => render(<App controller={controller as unknown as PanelController} translator={t} />, root));
  return { root, push: (v: PanelView) => act(() => listener?.(v, tabId)) };
}

let clientCalls: number;
let sent: string[];
const okClient = (): (() => Promise<ClientResult>) => () => {
  clientCalls++;
  const inner = translatorClient();
  const client: LLMClient = {
    model: inner.model,
    reasoningReserveTokens: () => 0,
    stream: (req) => {
      sent.push(req.messages.map((m) => m.content).join('\n'));
      return inner.stream(req);
    },
  };
  return Promise.resolve({ ok: true, client, profile: GEMINI_PROFILE, connection: { id: 'apibox', label: 'APIBOX' } });
};
beforeEach(() => {
  clientCalls = 0;
  sent = [];
});

describe('selectionParagraphs', () => {
  it('splits on blank lines, normalizes whitespace, drops empties', () => {
    expect(selectionParagraphs('One   two\nthree\n\n\n  Four  \n\n   ').paragraphs).toEqual(['One two three', 'Four']);
  });
  it('caps a long selection and says so', () => {
    const r = selectionParagraphs(`${'a'.repeat(MAX_SELECTION_CHARS - 5)}\n\n${'b'.repeat(50)}`);
    expect(r.truncated).toBe(true);
    expect(r.paragraphs).toHaveLength(1);
    expect(selectionParagraphs('x'.repeat(MAX_SELECTION_CHARS * 2)).paragraphs[0]).toHaveLength(MAX_SELECTION_CHARS);
  });
  it('a blocked record has no segments', () => {
    expect(snippetView({ at: 1, url: 'https://mail.google.com/', blocked: 'denylisted' })).toMatchObject({ blocked: 'denylisted', segments: [] });
  });
});

describe('selection mode in the panel (plan M3-E4, §3 #5)', () => {
  it('translates a selection on a page where extraction failed, and shows it instead of the hint', async () => {
    const f = fakeApi();
    const t = createTranslator(f.api, { translateClient: okClient() });
    const stop = t.watch(() => 3);
    (t.hooks as Required<typeof t.hooks>).active(3);
    const { root } = mount(t, { kind: 'empty', url: 'https://example.com/a' });
    // Before: the hint, exactly.
    expect(root.querySelector('[data-state="empty"] .state__title')?.textContent).toBe("Couldn't read this page. Select text to translate it.");

    f.leave(3, record('Hello world.\n\nSecond paragraph here.'));
    await until(() => t.snippets.jobs.get(3)?.status === 'done');
    await act(async () => settle(50));
    const job = t.snippets.jobs.get(3) as JobView;
    expect(job.counts).toEqual({ total: 2, final: 2, failed: 0 });
    expect(root.querySelector('[data-testid="selection"]')).not.toBeNull();
    expect(root.querySelector('[data-state="empty"]')).toBeNull();
    expect(root.textContent).toContain('vi:Hello world.');
    expect(root.textContent).toContain('vi:Second paragraph here.');
    // The page's own job was never involved.
    expect(t.jobs.get(3)).toBeUndefined();
    expect(sent.join('\n')).toContain('Hello world.');

    // Close: back to the hint.
    act(() => root.querySelector<HTMLButtonElement>('[data-testid="selection-close"]')?.click());
    expect(root.querySelector('[data-state="empty"]')).not.toBeNull();
    expect(t.snippets.store.get(3)).toBeUndefined();
    stop();
  });

  it('on a readable page the selection shows first, and "Back to the page" returns to it', async () => {
    const f = fakeApi();
    const t = createTranslator(f.api, { translateClient: okClient() });
    t.watch(() => 3);
    (t.hooks as Required<typeof t.hooks>).active(3);
    const page = { kind: 'ready', docId: 'd', result: { ok: true, via: 'walk', url: 'https://example.com/a', title: 'Page', lang: 'en', segments: [{ id: 'p0', kind: 'p', text: 'Page text', inlineMarkup: 'Page text', domPath: '/p[1]', translate: true }] } } as unknown as PanelView;
    const { root } = mount(t, page);
    f.leave(3, record('Only this.'));
    await until(() => t.snippets.jobs.get(3)?.status === 'done');
    await act(async () => settle(30));
    expect(root.querySelector('[data-testid="selection"]')?.textContent).toContain('vi:Only this.');
    const back = root.querySelector<HTMLButtonElement>('[data-testid="selection-close"]');
    expect(back?.textContent).toBe('Back to the page');
    act(() => back?.click());
    expect(root.querySelector('[data-testid="selection"]')).toBeNull();
    expect(root.textContent).toContain('Page text');
  });

  it('the same click twice translates once; a new click translates again', async () => {
    const f = fakeApi();
    const t = createTranslator(f.api, { translateClient: okClient() });
    t.watch(() => 3);
    (t.hooks as Required<typeof t.hooks>).active(3);
    f.leave(3, record('Once.', 10));
    f.leave(3, record('Once.', 10));
    await until(() => t.snippets.jobs.get(3)?.status === 'done');
    expect(clientCalls).toBe(1);
    f.leave(3, record('Once.', 11));
    await until(() => t.snippets.jobs.docOf(3) === 'snippet:11' && t.snippets.jobs.get(3)?.status === 'done');
    expect(clientCalls).toBe(2);
  });

  it('a selection left before the panel opened is picked up when its tab becomes active', async () => {
    const f = fakeApi();
    f.session.set('snippet:3', record('Waiting.'));
    const t = createTranslator(f.api, { translateClient: okClient() });
    (t.hooks as Required<typeof t.hooks>).active(3);
    await until(() => t.snippets.jobs.get(3)?.status === 'done');
    expect(t.snippets.jobs.get(3)?.counts.final).toBe(1);
  });
});

describe('selection mode and the denylist (M3-D13, §3 #6)', () => {
  it('a blocked record shows the denylist message and sends nothing', async () => {
    const f = fakeApi();
    const t = createTranslator(f.api, { translateClient: okClient() });
    t.watch(() => 3);
    (t.hooks as Required<typeof t.hooks>).active(3);
    const { root } = mount(t, { kind: 'empty', url: 'https://example.com/' });
    f.leave(3, { at: 1, url: 'https://example.com/', blocked: 'denylisted' });
    await act(async () => settle(40));
    expect(root.querySelector('[data-testid="selection"] [data-state="blocked"]')?.textContent).toContain('never reads this site');
    expect(clientCalls).toBe(0);
    expect(sent).toEqual([]);
    expect(t.snippets.jobs.get(3)).toBeUndefined();
  });

  it('a record that names a denylisted url is not sent even if it carries text', async () => {
    const f = fakeApi();
    const t = createTranslator(f.api, { translateClient: okClient() });
    t.watch(() => 3);
    (t.hooks as Required<typeof t.hooks>).active(3);
    f.leave(3, record('my private mail', 1, 'https://mail.google.com/mail/u/0/'));
    await act(async () => settle(40));
    expect(t.snippets.store.get(3)?.blocked).toBe('denylisted');
    expect(clientCalls).toBe(0);
    expect(sent).toEqual([]);
  });

  it('on a denylisted page the page message wins over any selection', async () => {
    const f = fakeApi();
    const t = createTranslator(f.api, { translateClient: okClient() });
    t.watch(() => 3);
    (t.hooks as Required<typeof t.hooks>).active(3);
    f.leave(3, record('x'));
    await until(() => t.snippets.jobs.get(3)?.status === 'done');
    const { root } = mount(t, { kind: 'blocked', reason: 'denylisted' });
    expect(root.querySelector('[data-testid="selection"]')).toBeNull();
    expect(root.querySelector('[data-state="blocked"]')?.textContent).toContain('never reads this site');
  });
});

describe('selection mode errors share the page error UX (M3-E8)', () => {
  it('a bad key: Fix key inline, one request resolved, no other route', async () => {
    const f = fakeApi();
    let resolved = 0;
    const t = createTranslator(f.api, {
      translateClient: () => (resolved++, Promise.resolve({ ok: false, error: { kind: 'auth', message: 'Add your APIBOX API key in settings' }, connection: { id: 'apibox', label: 'APIBOX' } } as ClientResult)),
    });
    t.watch(() => 3);
    (t.hooks as Required<typeof t.hooks>).active(3);
    const { root } = mount(t, { kind: 'empty', url: 'https://example.com/' });
    f.leave(3, record('Hello.'));
    await until(() => t.snippets.jobs.get(3)?.status === 'stopped');
    await act(async () => settle(30));
    expect(root.querySelector('[data-testid="selection"] [data-testid="fix-key"]')?.textContent).toBe('Fix key');
    expect(resolved).toBe(1);
  });
});
