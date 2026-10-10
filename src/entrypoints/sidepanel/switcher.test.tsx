// @vitest-environment jsdom
// The quick switcher (plan M4-E11, DESIGN §4.3.3 B): a tab-only choice (storage.session), the
// routing unchanged until "Make default", the choice gone with the tab, and a site rule that wins.
import { browser } from 'wxt/browser';
import { IDBFactory } from 'fake-indexeddb';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/index';
import { renderLines, translatorClient } from '@/engine/testing';
import { openTranslationCache } from '@/shared/cache';
import { listenForTabLifecycle } from '@/shared/panel';
import { translateClient } from './route.ts';
import { readTabOverride, resolveRoute, tabRouteKey } from '@/shared/providers';
import { APIBOX_FLASH_PROFILE, DEFAULT_PROFILE, GEMINI_PROFILE } from '@/shared/settings';
import { App } from './App.tsx';
import type { PanelController, PanelView, SessionHooks } from './controller.ts';
import { readSwitcher } from './switcher.ts';
import { createTranslator } from './translator.ts';
import { ViewportStore } from './viewport.ts';

type Api = Parameters<typeof createTranslator>[0];
type Ready = Extract<PanelView, { kind: 'ready' }>['result'];

/** Stateful storage areas that tell their listeners, as chrome.storage does. */
function area(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  const listeners = new Set<(c: Record<string, { oldValue?: unknown; newValue?: unknown }>) => void>();
  const tell = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => {
    for (const fn of listeners) fn(changes);
  };
  return {
    data,
    get: (keys: string | string[] | null) => {
      const list = keys === null ? [...data.keys()] : typeof keys === 'string' ? [keys] : keys;
      return Promise.resolve(structuredClone(Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, data.get(k)]))));
    },
    set: (items: Record<string, unknown>) => {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [k, v] of Object.entries(structuredClone(items))) {
        changes[k] = { oldValue: data.get(k), newValue: v };
        data.set(k, v);
      }
      tell(changes);
      return Promise.resolve();
    },
    remove: (keys: string | string[]) => {
      const changes: Record<string, { oldValue?: unknown }> = {};
      for (const k of typeof keys === 'string' ? [keys] : keys) {
        if (data.has(k)) changes[k] = { oldValue: data.get(k) };
        data.delete(k);
      }
      tell(changes);
      return Promise.resolve();
    },
    getBytesInUse: () => Promise.resolve(0),
    onChanged: { addListener: (fn: never) => listeners.add(fn), removeListener: (fn: never) => listeners.delete(fn) },
  };
}

function fakeApi(opts: { siteRules?: unknown[]; keys?: string[]; denied?: string[] } = {}) {
  const sync = area({ prefs: { targetLang: 'vi', sourceLang: 'auto', style: 'natural' }, ...(opts.siteRules ? { siteRules: opts.siteRules } : {}) });
  const local = area({ privacyNotice: { version: 1, at: 0 }, ...Object.fromEntries((opts.keys ?? ['apibox', 'gemini']).map((id) => [`secret:${id}`, `key-${id}`])) });
  const session = area();
  const none = { addListener: () => {}, removeListener: () => {} };
  const removed = new Set<(tabId: number) => void>();
  const api = {
    storage: { sync, local, session },
    permissions: { onAdded: none, contains: ({ origins }: { origins: string[] }) => Promise.resolve(origins.every((o) => !(opts.denied ?? []).some((d) => o.includes(d)))) },
    runtime: { openOptionsPage: () => Promise.resolve() },
    i18n: { getUILanguage: () => 'en' },
    tabs: { onRemoved: { addListener: (fn: (id: number) => void) => removed.add(fn) }, onUpdated: none, onActivated: none },
  } as unknown as Api;
  return { api, sync, local, session, closeTab: (id: number) => removed.forEach((fn) => fn(id)) };
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
const segments: Segment[] = [0, 1].map((i) => ({ id: `s${i}`, kind: 'p', text: text(i), inlineMarkup: text(i), domPath: `/p[${i + 1}]`, translate: true }));
const result: Ready = { ok: true, via: 'walk', url: 'https://example.com/a', title: 'Page', lang: 'en', segments };

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

function setup(opts: Parameters<typeof fakeApi>[0] = {}) {
  const f = fakeApi(opts);
  const calls: string[] = [];
  // Each model answers as `<model>:<text>`, and the route decides which one runs (as route.ts does).
  const t = createTranslator(
    f.api,
    {
      translateClient: async (target) => {
        const route = await resolveRoute(f.api, 'translate', target);
        if (!route.ok) return { ok: false as const, error: { kind: 'bad_request' as const, message: route.message } };
        const model = route.profile.model;
        // Gemini goes through the real route (host permission check, no request when it is missing).
        if (opts.denied && route.profile.id === GEMINI_PROFILE.id) return translateClient(f.api, target);
        const c = translatorClient((lines) => {
          calls.push(model);
          return renderLines(lines, (s) => `${model}:${s}`);
        }, { model });
        return { ok: true as const, client: c, profile: route.profile };
      },
      strategy: 'single-pass',
      cache: openTranslationCache({ factory: new IDBFactory() }),
    },
    { detector: undefined },
  );
  const hooks = t.hooks as Required<SessionHooks>;
  t.watch(() => 1);
  hooks.active(1);
  hooks.ready(1, 'd1', result);
  const controller = { view: { kind: 'ready', result, docId: 'd1' } as PanelView, tabId: 1, subscribe: (fn: (v: PanelView, id: number | undefined) => void) => (fn(controller.view, 1), () => undefined), retry: () => undefined };
  act(() => render(<App controller={controller as unknown as PanelController} translator={{ ...t, viewports: new ViewportStore() }} />, root));
  return { f, t, calls };
}
const q = <T extends Element = HTMLElement>(id: string) => root.querySelector(`[data-testid=${id}]`) as T | null;
const pick = (value: string) =>
  act(() => {
    const select = q<HTMLSelectElement>('model-switcher') as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
const segText = (t: ReturnType<typeof createTranslator>) => t.jobs.get(1)?.segs.get('s0')?.text;
const routing = (f: ReturnType<typeof fakeApi>) => f.sync.data.get('routing') as { translate: string } | undefined;

describe('quick switcher (M4-E11)', () => {
  it('lists the models that can send, the default first, and marks the one a keyless connection owns', async () => {
    const f = fakeApi({ keys: ['apibox'] });
    const state = await readSwitcher(f.api, { tabId: 1, url: 'https://example.com/a' });
    expect(state.defaultId).toBe(DEFAULT_PROFILE.id);
    expect(state.currentId).toBe(DEFAULT_PROFILE.id);
    expect(state.options.map((o) => o.model)).toContain(APIBOX_FLASH_PROFILE.model);
    // Gemini has no key here and no route uses it: not offered.
    expect(state.options.some((o) => o.id === GEMINI_PROFILE.id)).toBe(false);
  });

  it('a choice applies to this tab only: the tab key is written, routing is not, and the page is translated again under the model', async () => {
    const { f, t, calls } = setup();
    await until(() => t.jobs.get(1)?.status === 'done');
    expect(segText(t)).toBe(`${DEFAULT_PROFILE.model}:${text(0)}`);
    const before = f.sync.data.get('routing');

    pick(GEMINI_PROFILE.id);
    await until(() => t.jobs.get(1)?.status === 'done' && segText(t)?.startsWith(GEMINI_PROFILE.model) === true);
    expect(f.session.data.get(tabRouteKey(1))).toBe(GEMINI_PROFILE.id);
    expect(f.sync.data.get('routing')).toEqual(before);
    expect(calls).toContain(GEMINI_PROFILE.model);
    await act(() => settle(30));
    expect(q('switcher-tab-only')).not.toBeNull();
    expect(q<HTMLSelectElement>('model-switcher')?.value).toBe(GEMINI_PROFILE.id);
    // Another tab still resolves to the default.
    expect((await readSwitcher(f.api, { tabId: 2, url: 'https://example.com/a' })).currentId).toBe(DEFAULT_PROFILE.id);
  });

  it('switching back to the default model comes from the cache with no request', async () => {
    const { t, calls } = setup();
    await until(() => t.jobs.get(1)?.status === 'done');
    await t.jobs.cacheIdle();
    pick(GEMINI_PROFILE.id);
    await until(() => segText(t)?.startsWith(GEMINI_PROFILE.model) === true && t.jobs.get(1)?.status === 'done');
    await t.jobs.cacheIdle();
    const n = calls.length;
    pick('');
    await until(() => segText(t)?.startsWith(DEFAULT_PROFILE.model) === true && t.jobs.get(1)?.status === 'done');
    expect(calls.length).toBe(n);
  });

  it('Make default writes routing.translate (the rest of routing stays), clears the tab choice and does not translate again', async () => {
    const { f, t, calls } = setup();
    await until(() => t.jobs.get(1)?.status === 'done');
    pick(GEMINI_PROFILE.id);
    await until(() => segText(t)?.startsWith(GEMINI_PROFILE.model) === true && t.jobs.get(1)?.status === 'done');
    await act(() => settle(30));
    const n = calls.length;
    await act(async () => {
      q('make-default')?.click();
      await settle(40);
    });
    await act(() => settle(40));
    expect(routing(f)?.translate).toBe(GEMINI_PROFILE.id);
    expect(await readTabOverride(f.api, 1)).toBeUndefined();
    expect(calls.length).toBe(n);
    expect(q('make-default')).toBeNull();
    expect(q('switcher-tab-only')).toBeNull();
    expect(q<HTMLSelectElement>('model-switcher')?.value).toBe('');
    expect(q<HTMLSelectElement>('model-switcher')?.options[0]?.textContent).toContain(GEMINI_PROFILE.model);
  });

  it('a tab choice is cleared when the tab closes', async () => {
    const { f } = setup();
    listenForTabLifecycle(f.api);
    await f.session.set({ [tabRouteKey(1)]: GEMINI_PROFILE.id });
    f.closeTab(1);
    await until(() => !f.session.data.has(tabRouteKey(1)));
  });

  it('a site rule wins: the switcher names the rule instead of offering a choice, and the page keeps the rule’s model', async () => {
    const rules = [{ pattern: 'example.com', translate: GEMINI_PROFILE.id, localOnly: false }];
    const { f, t } = setup({ siteRules: rules });
    await f.session.set({ [tabRouteKey(1)]: APIBOX_FLASH_PROFILE.id });
    await until(() => t.jobs.get(1)?.status === 'done');
    await act(() => settle(30));
    expect(q('model-switcher')).toBeNull();
    expect(q('switcher-site-rule')?.textContent).toContain('example.com');
    expect(q('switcher-site-rule')?.textContent).toContain('overrides tab choice');
    expect(q('header-model')?.textContent).toContain(GEMINI_PROFILE.model);
    expect(segText(t)).toBe(`${GEMINI_PROFILE.model}:${text(0)}`);
    expect(q('make-default')).toBeNull();
    const state = await readSwitcher(f.api, { tabId: 1, url: 'https://example.com/a' });
    expect(state.rule?.pattern).toBe('example.com');
  });

  it('the select carries the full model label in its title, for names the box clips', async () => {
    const { t } = setup();
    await until(() => t.jobs.get(1)?.status === 'done');
    pick(GEMINI_PROFILE.id);
    await until(() => q('switcher-tab-only') !== null);
    expect(q('model-switcher')?.getAttribute('title')).toContain(`${GEMINI_PROFILE.model} · `);
  });

  it('says a local-only rule is local only', async () => {
    const { t } = setup({ siteRules: [{ pattern: '*.example.com', translate: GEMINI_PROFILE.id, localOnly: true }] });
    await until(() => t.jobs.get(1)?.status !== undefined);
    await act(() => settle(30));
    expect(q('switcher-site-rule')?.textContent).toContain('local only');
  });

  it('a tab choice for a model that no longer exists is ignored', async () => {
    const f = fakeApi();
    await f.session.set({ [tabRouteKey(1)]: 'gone' });
    const state = await readSwitcher(f.api, { tabId: 1, url: 'https://example.com/a' });
    expect(state.currentId).toBe(DEFAULT_PROFILE.id);
    expect(state.tabId).toBeUndefined();
  });

  it('a switch to a model whose provider has no host permission stops with Grant access, not silently', async () => {
    const { t } = setup({ denied: ['generativelanguage.googleapis.com'] });
    await until(() => t.jobs.get(1)?.status === 'done');
    pick(GEMINI_PROFILE.id);
    await until(() => t.jobs.get(1)?.status === 'stopped');
    await act(() => settle(30));
    expect(t.jobs.get(1)?.stopError).toMatchObject({ kind: 'cors', cause: 'permission' });
    expect(root.textContent).toContain('Grant access');
    expect(root.textContent).toContain('generativelanguage.googleapis.com');
  });

  it('a switch waits for the privacy notice: nothing is sent until it is acknowledged', async () => {
    const { f, t, calls } = setup();
    await until(() => t.jobs.get(1)?.status === 'done');
    await f.local.remove('privacyNotice');
    await act(() => settle(20));
    const n = calls.length;
    pick(GEMINI_PROFILE.id);
    await act(() => settle(80));
    expect(calls.length).toBe(n);
    expect(q('privacy-notice')).not.toBeNull();
    await act(() => t.privacy.acknowledge());
    await until(() => calls.includes(GEMINI_PROFILE.model));
  });

  it('ties "This tab only" and Make default to the select, and announces a switch politely', async () => {
    const { t } = setup();
    await until(() => t.jobs.get(1)?.status === 'done');
    expect(q('switcher-live')?.getAttribute('aria-live')).toBe('polite');
    // Nothing is announced for the model the panel opens with.
    expect(q('switcher-live')?.textContent).toBe('');
    pick(GEMINI_PROFILE.id);
    await until(() => q('switcher-tab-only') !== null);
    const note = q('switcher-tab-only')?.id;
    expect(note).toBeTruthy();
    expect(q('model-switcher')?.getAttribute('aria-describedby')).toBe(note);
    expect(q('make-default')?.getAttribute('aria-describedby')).toBe(note);
    // The live region updates in its own render after the note: wait for it, not a fixed tick.
    await until(() => q('switcher-live')?.textContent?.includes(`${GEMINI_PROFILE.model}, this tab only`) === true);
  });

  it('offers the setup guide while no route can run and the guide was never finished; not after it was', async () => {
    const { t } = setup({ keys: [] });
    await until(() => t.jobs.get(1) !== undefined);
    await until(() => q('setup-offer') !== null);
    expect(q('setup-open')?.textContent).toBe('Set up Translate Side');
  });

  it('does not offer the guide once it was skipped or done, or when a key is there', async () => {
    await browser.storage.local.set({ onboarding: { status: 'skipped', at: 1 } });
    const a = setup({ keys: [] });
    await until(() => a.t.jobs.get(1) !== undefined);
    await act(() => settle(60));
    expect(q('setup-offer')).toBeNull();
    await browser.storage.local.remove('onboarding');
    const b = setup();
    await until(() => b.t.jobs.get(1)?.status === 'done');
    await act(() => settle(60));
    expect(q('setup-offer')).toBeNull();
  });
});
