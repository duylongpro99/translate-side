// @vitest-environment jsdom
// Header controls (plan M3-E6): language pair with a target-language switch, the Translation popover
// (style mode, quality, model), settings in the More menu, Stop / Retranslate page, scroll-follow toggle.
import { PRIVACY_NOTICE_VERSION } from './privacy.ts';
import { IDBFactory } from 'fake-indexeddb';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '@/engine/index';
import { renderLines, translatorClient } from '@/engine/testing';
import { openTranslationCache, type TranslationCache } from '@/shared/cache';
import { DEFAULT_PROFILE, GEMINI_PROFILE } from '@/shared/settings';
import { App } from './App.tsx';
import type { PanelController, PanelView, SessionHooks } from './controller.ts';
import { createTranslator } from './translator.ts';
import { ViewportStore } from './viewport.ts';

// Whether Best is released and whether the feature check allows it, per test.
const flags = vi.hoisted(() => ({ released: true, available: true }));
vi.mock('@/shared/features', () => ({ featureAvailable: () => Promise.resolve(flags.available) }));
vi.mock('@/shared/quality', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/shared/quality')>();
  return Object.defineProperty({ ...real }, 'BEST_MODE_RELEASED', { get: () => flags.released, enumerable: true });
});

type Api = Parameters<typeof createTranslator>[0];
type Ready = Extract<PanelView, { kind: 'ready' }>['result'];

function fakeApi(prefs: Record<string, unknown> = { targetLang: 'vi', sourceLang: 'auto', style: 'natural' }, failWrites = false, stored: Record<string, unknown> = {}) {
  const sync = new Map<string, unknown>([['prefs', prefs], ...Object.entries(stored)]);
  const onSync = new Set<(c: Record<string, unknown>) => void>();
  const none = { addListener: () => {}, removeListener: () => {} };
  const api = {
    storage: {
      sync: {
        get: (k: string | null) => Promise.resolve(k === null ? Object.fromEntries(sync) : sync.has(k) ? { [k]: sync.get(k) } : {}),
        set: (items: Record<string, unknown>) => {
          if (failWrites) return Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
          for (const [k, v] of Object.entries(items)) sync.set(k, v);
          const changes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }]));
          for (const fn of onSync) fn(changes);
          return Promise.resolve();
        },
        onChanged: { addListener: (fn: never) => onSync.add(fn), removeListener: (fn: never) => onSync.delete(fn) },
      },
      local: { get: () => Promise.resolve({ privacyNotice: { version: PRIVACY_NOTICE_VERSION, at: 0 } }), set: () => Promise.resolve(), onChanged: none },
      session: { get: () => Promise.resolve({}), remove: () => Promise.resolve(), onChanged: none },
    },
    permissions: { onAdded: none },
    runtime: { openOptionsPage: () => Promise.resolve() },
    i18n: { getUILanguage: () => 'en' },
  } as unknown as Api;
  return { api, sync };
}

const settle = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await settle(2);
  }
}
const text = (i: number) => `Paragraph ${i} explains how futures are polled by the executor.`;
const segments: Segment[] = [0, 1, 2].map((i) => ({ id: `s${i}`, kind: 'p', text: text(i), inlineMarkup: text(i), domPath: `/p[${i + 1}]`, translate: true }));
const result: Ready = { ok: true, via: 'walk', url: 'https://example.com/a', title: 'Page', lang: 'en', segments };

/** Answers each segment as `<target>:<n>:<text>`: which language and which call made it. */
function client() {
  let n = 0;
  return translatorClient(
    (lines, _call, req) => {
      n++;
      const target = /into ([A-Za-z ()]+?)[.,:\n]/.exec(req.system)?.[1] ?? '?';
      return renderLines(lines, (s) => `${target}#${n}:${s}`);
    },
    { model: GEMINI_PROFILE.model },
  );
}

let root: HTMLElement;
beforeEach(() => {
  flags.released = true;
  flags.available = true;
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

function setup(cache?: TranslationCache, stored?: Record<string, unknown>) {
  const f = fakeApi(undefined, false, stored);
  const c = client();
  const t = createTranslator(f.api, { translateClient: () => Promise.resolve({ ok: true as const, client: c, profile: GEMINI_PROFILE }), strategy: 'single-pass', cache }, { detector: undefined });
  const hooks = t.hooks as Required<SessionHooks>;
  t.watch(() => 1);
  hooks.active(1);
  hooks.ready(1, 'd1', result);
  const controller = { view: { kind: 'ready', result, docId: 'd1' } as PanelView, tabId: 1, subscribe: (fn: (v: PanelView, id: number | undefined) => void) => (fn(controller.view, 1), () => undefined), retry: () => undefined };
  act(() => render(<App controller={controller as unknown as PanelController} translator={{ ...t, viewports: new ViewportStore() }} />, root));
  return { f, t, c };
}
const q = <T extends Element = HTMLElement>(id: string) => root.querySelector(`[data-testid=${id}]`) as T | null;
const segText = (t: ReturnType<typeof createTranslator>, id: string) => t.jobs.get(1)?.segs.get(id)?.text;
const choose = (id: string, value: string) =>
  act(() => {
    const select = q<HTMLSelectElement>(id) as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

describe('panel header (M3-E6)', () => {
  it('shows the language pair, the model read-only in the switcher slot, the style, settings, the page action and scroll follow', async () => {
    const { t } = setup();
    await until(() => t.jobs.get(1)?.status === 'done');
    await act(() => settle(30));
    expect(q('source-lang')?.textContent).toBe('EN');
    expect(q<HTMLSelectElement>('target-lang')?.value).toBe('vi');
    expect(q<HTMLSelectElement>('target-lang')?.disabled).toBe(false);
    const model = q('header-model');
    expect(model?.textContent).toBe(GEMINI_PROFILE.model);
    expect(model?.getAttribute('data-slot')).toBe('quick-switcher');
    expect(model?.tagName).toBe('SPAN');
    expect(q<HTMLSelectElement>('style-mode')?.value).toBe('natural');
    expect([...(q<HTMLSelectElement>('style-mode')?.options ?? [])].map((o) => o.textContent)).toEqual(['Natural', 'Faithful', 'Simplified']);
    // Settings is an item of the header's More menu.
    expect(root.querySelector('header [data-testid=menu-settings]')?.textContent).toBe('Settings');
    expect(root.querySelector('header [data-testid=scroll-follow]')).not.toBeNull();
    expect(q('page-retranslate')).not.toBeNull();
    expect(q('page-cancel')).toBeNull();
  });

  it('names the routed model before a job has resolved its client', async () => {
    // Basic translation out of the fallback list and no Gemini Nano here: the keyless default stays the route (not the on-device one).
    const f = fakeApi(undefined, false, { schemaVersion: 1, routing: { translate: DEFAULT_PROFILE.id, basicMigrated: true } });
    const t = createTranslator(f.api, { translateClient: () => new Promise(() => {}) });
    const controller = { view: { kind: 'ready', result, docId: 'd1' } as PanelView, tabId: 1, subscribe: (fn: (v: PanelView, id: number | undefined) => void) => (fn(controller.view, 1), () => undefined), retry: () => undefined };
    act(() => render(<App controller={controller as unknown as PanelController} translator={t} />, root));
    // The route is read from storage (src/shared/providers.ts): a fresh install routes to the default.
    await act(() => settle());
    expect(q('header-model')?.textContent).toBe(DEFAULT_PROFILE.model);
  });

  it('switching the target language saves it and translates the page into it; switching back comes from the cache with no request', async () => {
    const { f, t, c } = setup(openTranslationCache({ factory: new IDBFactory() }));
    await until(() => t.jobs.get(1)?.status === 'done');
    await t.jobs.cacheIdle();
    const first = c.requests.length;
    expect(segText(t, 's0')).toMatch(/^Vietnamese#/);

    choose('target-lang', 'fr');
    await until(() => t.jobs.get(1)?.targetLang === 'fr' && t.jobs.get(1)?.status === 'done');
    expect((f.sync.get('prefs') as { targetLang: string }).targetLang).toBe('fr');
    expect(segText(t, 's0')).toMatch(/^French#/);
    expect(c.requests.length).toBeGreaterThan(first);
    await t.jobs.cacheIdle();
    await act(() => settle(30));
    expect(q<HTMLSelectElement>('target-lang')?.value).toBe('fr');

    const before = c.requests.length;
    choose('target-lang', 'vi');
    await until(() => t.jobs.get(1)?.targetLang === 'vi' && t.jobs.get(1)?.status === 'done');
    expect(c.requests.length).toBe(before);
    expect(t.jobs.get(1)?.cached).toBe(3);
    expect(segText(t, 's0')).toMatch(/^Vietnamese#/);
  });

  it('switching the style saves it and translates the page again in that style', async () => {
    const { f, t, c } = setup();
    await until(() => t.jobs.get(1)?.status === 'done');
    const first = c.requests.length;
    choose('style-mode', 'simplified');
    await until(() => c.requests.length > first && t.jobs.get(1)?.status === 'done');
    expect((f.sync.get('prefs') as { style: string }).style).toBe('simplified');
    expect(c.requests.at(-1)?.system).toMatch(/simpl/i);
  });

  it('a page the user cancelled is translated again when the language is switched (an explicit ask)', async () => {
    const f = fakeApi();
    let hang = true;
    const c = translatorClient((lines) => renderLines(lines, (s) => `x:${s}`), { model: GEMINI_PROFILE.model });
    const slow = { ...c, async *stream(req: Parameters<typeof c.stream>[0]) {
      if (hang) await new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(req.signal.reason), { once: true }));
      yield* c.stream(req);
    } };
    const t = createTranslator(f.api, { translateClient: () => Promise.resolve({ ok: true as const, client: slow, profile: GEMINI_PROFILE }), strategy: 'single-pass' }, { detector: undefined });
    t.watch(() => 1);
    (t.hooks as Required<SessionHooks>).active(1);
    (t.hooks as Required<SessionHooks>).ready(1, 'd1', result);
    const controller = { view: { kind: 'ready', result, docId: 'd1' } as PanelView, tabId: 1, subscribe: (fn: (v: PanelView, id: number | undefined) => void) => (fn(controller.view, 1), () => undefined), retry: () => undefined };
    act(() => render(<App controller={controller as unknown as PanelController} translator={t} />, root));
    await until(() => t.jobs.get(1)?.status === 'running');
    await act(() => settle(30));
    act(() => q<HTMLButtonElement>('page-cancel')?.click());
    expect(t.jobs.get(1)?.status).toBe('cancelled');
    hang = false;
    await act(() => settle(30));
    choose('target-lang', 'de');
    await until(() => t.jobs.get(1)?.targetLang === 'de' && t.jobs.get(1)?.status === 'done');
  });

  it('Retranslate page runs the whole page again past the cache, and its results replace the stored ones', async () => {
    const cache = openTranslationCache({ factory: new IDBFactory() }) as TranslationCache;
    const { t, c } = setup(cache);
    await until(() => t.jobs.get(1)?.status === 'done');
    await t.jobs.cacheIdle();
    const old = segText(t, 's1');
    const first = c.requests.length;
    await act(() => settle(30));
    act(() => q<HTMLButtonElement>('page-retranslate')?.click());
    await until(() => c.requests.length > first && t.jobs.get(1)?.status === 'done');
    expect(t.jobs.get(1)?.cached).toBe(0);
    const fresh = segText(t, 's1');
    expect(fresh).not.toBe(old);
    await t.jobs.cacheIdle();

    // A revisit shows the retranslated text, from the cache.
    const f2 = fakeApi();
    const c2 = client();
    const t2 = createTranslator(f2.api, { translateClient: () => Promise.resolve({ ok: true as const, client: c2, profile: GEMINI_PROFILE }), strategy: 'single-pass', cache }, { detector: undefined });
    (t2.hooks as Required<SessionHooks>).active(1);
    (t2.hooks as Required<SessionHooks>).ready(1, 'd2', result);
    await until(() => t2.jobs.get(1)?.status === 'done');
    expect(c2.requests).toHaveLength(0);
    expect(t2.jobs.get(1)?.segs.get('s1')?.text).toBe(fresh);
  });

  it('Retranslate page on a running job replaces the run: the old one stops, the new one skips the cache and finishes', async () => {
    const f = fakeApi();
    let hang = true;
    const c = translatorClient((lines) => renderLines(lines, (x) => `x:${x}`), { model: GEMINI_PROFILE.model });
    const slow = {
      ...c,
      async *stream(req: Parameters<typeof c.stream>[0]) {
        if (hang) await new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(req.signal.reason), { once: true }));
        yield* c.stream(req);
      },
    };
    const cache = openTranslationCache({ factory: new IDBFactory() });
    const t = createTranslator(f.api, { translateClient: () => Promise.resolve({ ok: true as const, client: slow, profile: GEMINI_PROFILE }), strategy: 'single-pass', cache }, { detector: undefined });
    (t.hooks as Required<SessionHooks>).active(1);
    (t.hooks as Required<SessionHooks>).ready(1, 'd1', result);
    await until(() => t.jobs.get(1)?.status === 'running');
    const firstStart = t.jobs.get(1)?.startedAt ?? 0;
    hang = false;
    t.actions(1).retranslatePage();
    await until(() => t.jobs.get(1)?.status === 'done');
    expect(t.jobs.get(1)?.startedAt).toBeGreaterThanOrEqual(firstStart);
    expect(t.jobs.get(1)?.cached).toBe(0);
    expect(t.jobs.get(1)?.counts).toEqual({ total: 3, final: 3, failed: 0 });
  });

  it('a switch whose save fails is put back, and the header says so', async () => {
    const f = fakeApi(undefined, true);
    const t = createTranslator(f.api, { translateClient: () => new Promise(() => {}) });
    const controller = { view: { kind: 'ready', result, docId: 'd1' } as PanelView, tabId: 1, subscribe: (fn: (v: PanelView, id: number | undefined) => void) => (fn(controller.view, 1), () => undefined), retry: () => undefined };
    act(() => render(<App controller={controller as unknown as PanelController} translator={t} />, root));
    await act(() => settle(30));
    choose('target-lang', 'fr');
    await act(() => settle(30));
    expect(q<HTMLSelectElement>('target-lang')?.value).toBe('vi');
    expect(q('prefs-error')?.textContent).toContain("Couldn't save that setting");
  });

  describe('quality mode', () => {
    const modes = () => [...(q<HTMLSelectElement>('quality-mode')?.options ?? [])];

    it('offers Fast, Balanced and Best, Balanced selected, and saves a switch to its own sync item', async () => {
      const { f, t } = setup();
      await until(() => t.jobs.get(1)?.status === 'done');
      await act(() => settle(30));
      expect(modes().map((o) => [o.textContent, o.disabled])).toEqual([
        ['Fast', false],
        ['Balanced', false],
        ['Best', false],
      ]);
      expect(q<HTMLSelectElement>('quality-mode')?.value).toBe('balanced');
      expect(q('quality-lock-note')).toBeNull();
      choose('quality-mode', 'best');
      await until(() => f.sync.has('quality'));
      expect(f.sync.get('quality')).toEqual({ mode: 'best', keepDraftsOnScreen: false });
      expect(f.sync.get('prefs')).toEqual({ targetLang: 'vi', sourceLang: 'auto', style: 'natural' });
    });

    it('with an override set it shows the mode, names the override in its title, and choosing a mode clears it', async () => {
      const { f, t } = setup(undefined, { quality: { mode: 'balanced', strategy: 'single-pass', keepDraftsOnScreen: true } });
      await until(() => t.jobs.get(1)?.status === 'done');
      await act(() => settle(30));
      expect(q<HTMLSelectElement>('quality-mode')?.value).toBe('balanced');
      expect(q('quality-mode')?.getAttribute('title')).toBe('Set to Single pass in settings');
      choose('quality-mode', 'fast');
      await until(() => (f.sync.get('quality') as { mode: string }).mode === 'fast');
      expect(f.sync.get('quality')).toEqual({ mode: 'fast', keepDraftsOnScreen: true });
    });

    it('a locked Best is disabled with a (Pro) suffix and the note sits beside the select only', async () => {
      flags.available = false;
      const { t } = setup();
      await until(() => t.jobs.get(1)?.status === 'done');
      await act(() => settle(30));
      const best = modes().find((o) => o.value === 'best');
      expect(best?.disabled).toBe(true);
      expect(best?.textContent).toBe('Best (Pro)');
      expect(modes().filter((o) => o.disabled)).toHaveLength(1);
      const note = q('quality-lock-note');
      expect(note?.textContent).toBe('Best is part of Pro.');
      expect(q('quality-control')?.contains(note)).toBe(true);
      expect(q('quality-mode')?.getAttribute('aria-describedby')).toBe(note?.id);
      expect(root.querySelectorAll('[data-testid=quality-lock-note]')).toHaveLength(1);
    });

    it('with Best not released it is listed nowhere, not even locked', async () => {
      flags.released = false;
      flags.available = false;
      const { t } = setup();
      await until(() => t.jobs.get(1)?.status === 'done');
      await act(() => settle(30));
      expect(modes().map((o) => o.value)).toEqual(['fast', 'balanced']);
      expect(q('quality-lock-note')).toBeNull();
    });
  });
});
