// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/types';
import { translatorClient } from '@/engine/testing';
import { translatorRouteClient } from '@/llm/on-device';
import { GEMINI_PROFILE, TRANSLATOR_PROFILE } from '@/shared/settings';
import type { ClientResult } from './jobs.ts';
import type { LLMClient } from '@/llm/types';
import type { SnippetRecord } from '@/shared/snippet';
import { App } from './App.tsx';
import type { PanelController, PanelView, SessionHooks } from './controller.ts';
import { PRIVACY_KEY, PRIVACY_NOTICE_VERSION, PrivacyGate } from './privacy.ts';
import { PrivacyNotice } from './PrivacyNotice.tsx';
import { createTranslator } from './translator.ts';

// The first-run privacy notice (plan M3-E10): shown once, dismissible, persisted; nothing is sent before it.

type Api = Parameters<typeof createTranslator>[0];
type Ready = Parameters<Required<SessionHooks>['ready']>[2];

function fakeApi(local: Record<string, unknown> = {}, prefs: Record<string, unknown> = { targetLang: 'vi', sourceLang: 'auto' }) {
  const onLocal = new Set<(c: Record<string, { newValue?: unknown }>) => void>();
  const onSession = new Set<(c: Record<string, { newValue?: unknown }>) => void>();
  const none = { addListener: () => {}, removeListener: () => {} };
  const api = {
    storage: {
      sync: { get: (k: string) => Promise.resolve(k === 'prefs' ? { prefs: { ...prefs } } : {}), onChanged: none },
      local: {
        get: (k: string) => Promise.resolve(k in local ? { [k]: local[k] } : {}),
        set: (items: Record<string, unknown>) => {
          Object.assign(local, items);
          const changes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }]));
          for (const fn of onLocal) fn(changes);
          return Promise.resolve();
        },
        onChanged: { addListener: (fn: never) => onLocal.add(fn), removeListener: (fn: never) => onLocal.delete(fn) },
      },
      session: {
        get: () => Promise.resolve({}),
        remove: () => Promise.resolve(),
        onChanged: { addListener: (fn: never) => onSession.add(fn), removeListener: (fn: never) => onSession.delete(fn) },
      },
    },
    permissions: { onAdded: none },
    runtime: { openOptionsPage: () => Promise.resolve() },
    i18n: { getUILanguage: () => 'en' },
  } as unknown as Api;
  return {
    api,
    local,
    prefs,
    leave(tabId: number, record: SnippetRecord) {
      for (const fn of onSession) fn({ [`snippet:${tabId}`]: { newValue: record } });
    },
  };
}

const settle = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));
const text = 'Futures decouple a value from how it is computed.';
const segments: Segment[] = [0, 1, 2].map((i) => ({ id: `s${i}`, kind: 'p', text, inlineMarkup: text, domPath: `/p[${i + 1}]`, translate: true }));
const result = { ok: true, via: 'walk', url: 'https://example.com/a', title: 'Page', lang: 'en', segments } as Ready;

/** A panel whose route is `route()` (a cloud provider by default); `sent()` counts the requests that left. */
function setup(local: Record<string, unknown> = {}, route: (client: LLMClient) => ClientResult = (client) => ({ ok: true, client, profile: GEMINI_PROFILE })) {
  // A key for the default route, so the notice names it (with none, the route is the on-device one).
  const f = fakeApi(Object.assign(local, { 'secret:apibox': 'sk-apibox-0123456789' }));
  const client = translatorClient();
  const t = createTranslator(f.api, { translateClient: () => Promise.resolve(route(client)), mt: { model: 'Chrome Translator', availability: async () => 'available', translate: async (text: string) => ({ ok: true, text: `[vi] ${text}` }) } });
  return { f, t, client, sent: () => client.requests.length };
}
/** Chrome's Translator on this device: no text leaves it. */
const onDevice = (): ClientResult => ({ ok: true, client: translatorRouteClient(), profile: TRANSLATOR_PROFILE, onDevice: 'translator' });

function mount(t: ReturnType<typeof createTranslator>, view: PanelView, tabId = 1) {
  const controller = { view, tabId, subscribe: (fn: (v: PanelView, id: number | undefined) => void) => (fn(view, tabId), () => undefined), retry: () => undefined };
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  act(() => render(<App controller={controller as unknown as PanelController} translator={t} />, root));
  return root;
}

describe('PrivacyGate', () => {
  it('holds work until acknowledged, then runs it once; a newer hold for the same key replaces the older', async () => {
    const { api, local } = fakeApi();
    const gate = new PrivacyGate(api);
    await settle();
    expect(gate.state).toBe('needed');
    const ran: string[] = [];
    gate.whenAcknowledged('a', () => ran.push('a1'));
    gate.whenAcknowledged('a', () => ran.push('a2'));
    gate.whenAcknowledged('b', () => ran.push('b'));
    gate.forget('b');
    expect(ran).toEqual([]);
    await gate.acknowledge();
    expect(ran).toEqual(['a2']);
    expect(local[PRIVACY_KEY]).toMatchObject({ version: PRIVACY_NOTICE_VERSION });
    gate.whenAcknowledged('c', () => ran.push('c'));
    expect(ran).toEqual(['a2', 'c']);
  });

  it('is acknowledged from the start when storage says so (shown once), and follows an acknowledgement made elsewhere', async () => {
    const seen = new PrivacyGate(fakeApi({ [PRIVACY_KEY]: { version: PRIVACY_NOTICE_VERSION, at: 5 } }).api);
    await settle();
    expect(seen.state).toBe('acknowledged');

    const other = fakeApi();
    const gate = new PrivacyGate(other.api);
    await settle();
    expect(gate.state).toBe('needed');
    await other.api.storage.local.set({ [PRIVACY_KEY]: { version: PRIVACY_NOTICE_VERSION, at: 9 } });
    expect(gate.state).toBe('acknowledged');
  });

  it('shows the notice again for an older notice version', async () => {
    const gate = new PrivacyGate(fakeApi({ [PRIVACY_KEY]: { version: 1, at: 5 } }).api);
    await settle();
    expect(gate.state).toBe('needed');
  });
});

describe('first-run privacy notice in the panel', () => {
  it('sends nothing before the notice is acknowledged; the button starts the waiting page and hides the notice for good', async () => {
    const { f, t, sent } = setup();
    const hooks = t.hooks as Required<SessionHooks>;
    hooks.active(1);
    hooks.ready(1, 'd1', result);
    await settle();
    // The route is resolved (it decides whether text leaves the device), and the run waits on it.
    expect(sent()).toBe(0);
    expect(t.privacy.pending).toBe(true);

    const root = mount(t, { kind: 'ready', result: result as Extract<PanelView, { kind: 'ready' }>['result'], docId: 'd1' });
    // The route is read from storage (src/shared/providers.ts).
    await act(() => settle());
    const notice = root.querySelector('[data-testid=privacy-notice]');
    expect(notice?.textContent).toContain('sends the text of the pages you translate');
    expect(notice?.textContent).toContain('APIBOX');
    // The page itself is shown, as the original.
    expect(root.querySelectorAll('.seg')).toHaveLength(3);

    act(() => (root.querySelector('[data-testid=privacy-ok]') as HTMLButtonElement).click());
    await settle(60);
    expect(root.querySelector('[data-testid=privacy-notice]')).toBeNull();
    expect(sent()).toBeGreaterThan(0);
    expect(t.jobs.get(1)?.status).toBe('done');
    expect(f.local[PRIVACY_KEY]).toMatchObject({ version: PRIVACY_NOTICE_VERSION });

    // Shown once: a panel opened later on this device starts at once, with no notice.
    const again = setup(f.local);
    (again.t.hooks as Required<SessionHooks>).active(1);
    (again.t.hooks as Required<SessionHooks>).ready(1, 'd2', result);
    await settle(60);
    expect(again.sent()).toBeGreaterThan(0);
    const root2 = mount(again.t, { kind: 'ready', result: result as Extract<PanelView, { kind: 'ready' }>['result'], docId: 'd2' });
    expect(root2.querySelector('[data-testid=privacy-notice]')).toBeNull();
  });

  it('a page that went away while the notice waited is never sent', async () => {
    const { t, sent } = setup();
    const hooks = t.hooks as Required<SessionHooks>;
    hooks.active(1);
    hooks.ready(1, 'd1', result);
    await settle();
    hooks.gone(1);
    expect(t.privacy.pending).toBe(false);
    await t.privacy.acknowledge();
    await settle();
    expect(sent()).toBe(0);
  });

  it('holds a selection too, until the notice is acknowledged', async () => {
    const { f, t, sent } = setup();
    t.hooks.active?.(1);
    t.watch(() => 1);
    f.leave(1, { at: 1, url: 'https://example.com/a', text: 'Hello there.' });
    await settle();
    expect(sent()).toBe(0);
    await t.privacy.acknowledge();
    await settle(60);
    expect(sent()).toBeGreaterThan(0);
    expect(t.snippets.jobs.get(1)?.status).toBe('done');
  });

  it('an on-device route translates at once: no text leaves the device, so no notice', async () => {
    const { t, sent } = setup({}, onDevice);
    const hooks = t.hooks as Required<SessionHooks>;
    hooks.active(1);
    hooks.ready(1, 'd1', result);
    await settle(60);
    expect(t.jobs.get(1)?.status).toBe('done');
    expect(t.privacy.pending).toBe(false);
    expect(t.privacy.state).toBe('needed');
    expect(sent()).toBe(0);
    const root = mount(t, { kind: 'ready', result: result as Extract<PanelView, { kind: 'ready' }>['result'], docId: 'd1' });
    await act(() => settle());
    expect(root.querySelector('[data-testid=privacy-notice]')).toBeNull();
  });

  it('a key added after an on-device run: the next run goes to the cloud only after the notice', async () => {
    let cloud = false;
    const { t, sent } = setup({}, (client) => (cloud ? { ok: true, client, profile: GEMINI_PROFILE } : onDevice()));
    const hooks = t.hooks as Required<SessionHooks>;
    hooks.active(1);
    hooks.ready(1, 'd1', result);
    await settle(60);
    expect(t.jobs.get(1)?.status).toBe('done');
    // The key arrives (the route now resolves to a provider) and the page is translated again.
    cloud = true;
    t.actions(1).retranslatePage();
    await settle(60);
    expect(sent()).toBe(0);
    expect(t.privacy.pending).toBe(true);
    await t.privacy.acknowledge();
    await settle(60);
    expect(sent()).toBeGreaterThan(0);
  });

  it('a route changed while the notice waited applies: the page never goes out over the route resolved before', async () => {
    let cloud = true;
    const { t, sent } = setup({}, (client) => (cloud ? { ok: true, client, profile: GEMINI_PROFILE } : onDevice()));
    const hooks = t.hooks as Required<SessionHooks>;
    hooks.active(1);
    hooks.ready(1, 'd1', result);
    await settle();
    expect(t.privacy.pending).toBe(true);
    // Meanwhile the reader routes this page elsewhere (here: on the device), then acknowledges.
    cloud = false;
    await t.privacy.acknowledge();
    await settle(60);
    expect(t.jobs.get(1)?.status).toBe('done');
    expect(sent()).toBe(0);
  });

  it('names the provider the translate route uses, and puts the keyboard focus on its button', async () => {
    const { t } = setup();
    const hooks = t.hooks as Required<SessionHooks>;
    hooks.active(1);
    hooks.ready(1, 'd1', result);
    await settle();
    const root = mount(t, { kind: 'loading' });
    await act(() => settle());
    expect(root.querySelector('[data-testid=privacy-provider]')?.textContent).toBe('APIBOX');
    expect(root.querySelector('[data-testid=privacy-notice]')?.textContent).toContain('api.ai-box.vn');
    expect(root.querySelector('[data-testid=privacy-notice]')?.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(root.querySelector('[data-testid=privacy-ok]'));
  });
});

describe('the header while the notice waits', () => {
  it('leaves the Translation, Aa and More triggers inert, so no popover opens over the notice, and frees them on acknowledge', async () => {
    const { t } = setup();
    const hooks = t.hooks as Required<SessionHooks>;
    hooks.active(1);
    hooks.ready(1, 'd1', result);
    await settle();
    const root = mount(t, { kind: 'ready', docId: 'd1', result });
    await act(() => settle());
    const triggers = ['translation-button', 'reading-button', 'more-button'].map((id) => root.querySelector(`[data-testid=${id}]`) as HTMLElement);
    expect(triggers.every((b) => b !== null)).toBe(true);
    expect(triggers.map((b) => b.hasAttribute('inert'))).toEqual([true, true, true]);
    await act(() => (root.querySelector('[data-testid=privacy-ok]') as HTMLButtonElement).click());
    await act(() => settle());
    expect(triggers.map((b) => b.hasAttribute('inert'))).toEqual([false, false, false]);
  });
});

describe('the notice names the fallback providers too (plan M4-E9)', () => {
  it('lists where text may go if the chosen provider is busy or down', () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    act(() => render(<PrivacyNotice to={{ label: 'Home Ollama', host: 'localhost', fallback: [{ label: 'My Anthropic', host: 'api.anthropic.com' }] }} onAcknowledge={() => {}} />, root));
    expect(root.querySelector('[data-testid=privacy-fallback]')?.textContent).toBe(', and if it is busy or down, My Anthropic (api.anthropic.com)');
  });

  it('points to the local models this version supports, not to a later version (M4-D tester O2)', () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    act(() => render(<PrivacyNotice onAcknowledge={() => {}} />, root));
    const text = root.textContent ?? '';
    expect(text).toContain('A local model on this computer (Ollama or LM Studio, set up in Providers) keeps the text on this device.');
    expect(text).not.toContain('later version');
  });

  it('says allowlisted sites are translated automatically while the panel is open', () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    act(() => render(<PrivacyNotice onAcknowledge={() => {}} />, root));
    expect(root.querySelector('[data-testid=privacy-auto]')?.textContent).toBe('Sites you allow in Settings › Site rules are translated automatically each time you open one of their pages while the panel is open, so their text goes to your provider without a click.');
  });

  it('says the diagnostics log stays on this device unless exported', () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    act(() => render(<PrivacyNotice onAcknowledge={() => {}} />, root));
    expect(root.querySelector('[data-testid=privacy-diagnostics]')?.textContent).toBe('A diagnostics log of recent translations (counts, timings, error kinds; no page text) is kept on this device. It leaves only if you export it in Settings.');
  });

  it('says corrections can be sent as examples, and under which rules', () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    act(() => render(<PrivacyNotice onAcknowledge={() => {}} />, root));
    const text = root.querySelector('[data-testid=privacy-corrections]')?.textContent ?? '';
    expect(text).toContain('sent as examples');
    expect(text).toContain('local-only site never goes to a cloud model');
    expect(text).toContain('Use corrections from other sites');
  });
});
