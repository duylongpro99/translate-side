// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/types';
import { translatorClient } from '@/engine/testing';
import { GEMINI_PROFILE } from '@/shared/settings';
import type { SnippetRecord } from '@/shared/snippet';
import { App } from './App.tsx';
import type { PanelController, PanelView, SessionHooks } from './controller.ts';
import { PRIVACY_KEY, PrivacyGate } from './privacy.ts';
import { createTranslator } from './translator.ts';

// The first-run privacy notice (plan M3-E10): shown once, dismissible, persisted; nothing is sent before it.

type Api = Parameters<typeof createTranslator>[0];
type Ready = Parameters<Required<SessionHooks>['ready']>[2];

function fakeApi(local: Record<string, unknown> = {}) {
  const onLocal = new Set<(c: Record<string, { newValue?: unknown }>) => void>();
  const onSession = new Set<(c: Record<string, { newValue?: unknown }>) => void>();
  const none = { addListener: () => {}, removeListener: () => {} };
  const api = {
    storage: {
      sync: { get: (k: string) => Promise.resolve(k === 'prefs' ? { prefs: { targetLang: 'vi', sourceLang: 'auto' } } : {}), onChanged: none },
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
    leave(tabId: number, record: SnippetRecord) {
      for (const fn of onSession) fn({ [`snippet:${tabId}`]: { newValue: record } });
    },
  };
}

const settle = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));
const text = 'Futures decouple a value from how it is computed.';
const segments: Segment[] = [0, 1, 2].map((i) => ({ id: `s${i}`, kind: 'p', text, inlineMarkup: text, domPath: `/p[${i + 1}]`, translate: true }));
const result = { ok: true, via: 'walk', url: 'https://example.com/a', title: 'Page', lang: 'en', segments } as Ready;

function setup(local: Record<string, unknown> = {}) {
  const f = fakeApi(local);
  let calls = 0;
  const t = createTranslator(f.api, {
    translateClient: () => {
      calls++;
      return Promise.resolve({ ok: true as const, client: translatorClient(), profile: GEMINI_PROFILE });
    },
  });
  return { f, t, calls: () => calls };
}

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
    expect(local[PRIVACY_KEY]).toMatchObject({ version: 1 });
    gate.whenAcknowledged('c', () => ran.push('c'));
    expect(ran).toEqual(['a2', 'c']);
  });

  it('is acknowledged from the start when storage says so (shown once), and follows an acknowledgement made elsewhere', async () => {
    const seen = new PrivacyGate(fakeApi({ [PRIVACY_KEY]: { version: 1, at: 5 } }).api);
    await settle();
    expect(seen.state).toBe('acknowledged');

    const other = fakeApi();
    const gate = new PrivacyGate(other.api);
    await settle();
    expect(gate.state).toBe('needed');
    await other.api.storage.local.set({ [PRIVACY_KEY]: { version: 1, at: 9 } });
    expect(gate.state).toBe('acknowledged');
  });

  it('shows the notice again for an older notice version', async () => {
    const gate = new PrivacyGate(fakeApi({ [PRIVACY_KEY]: { version: 0, at: 5 } }).api);
    await settle();
    expect(gate.state).toBe('needed');
  });
});

describe('first-run privacy notice in the panel', () => {
  it('sends nothing before the notice is acknowledged; the button starts the waiting page and hides the notice for good', async () => {
    const { f, t, calls } = setup();
    const hooks = t.hooks as Required<SessionHooks>;
    hooks.active(1);
    hooks.ready(1, 'd1', result);
    await settle();
    expect(calls()).toBe(0);
    expect(t.jobs.get(1)).toBeUndefined();

    const root = mount(t, { kind: 'ready', result: result as Extract<PanelView, { kind: 'ready' }>['result'], docId: 'd1' });
    const notice = root.querySelector('[data-testid=privacy-notice]');
    expect(notice?.textContent).toContain('sends the text of the pages you translate');
    expect(notice?.textContent).toContain('APIBOX');
    // The page itself is shown, as the original.
    expect(root.querySelectorAll('.seg')).toHaveLength(3);

    act(() => (root.querySelector('[data-testid=privacy-ok]') as HTMLButtonElement).click());
    await settle(60);
    expect(root.querySelector('[data-testid=privacy-notice]')).toBeNull();
    expect(calls()).toBe(1);
    expect(t.jobs.get(1)?.status).toBe('done');
    expect(f.local[PRIVACY_KEY]).toMatchObject({ version: 1 });

    // Shown once: a panel opened later on this device starts at once, with no notice.
    const again = setup(f.local);
    (again.t.hooks as Required<SessionHooks>).active(1);
    (again.t.hooks as Required<SessionHooks>).ready(1, 'd2', result);
    await settle(60);
    expect(again.calls()).toBe(1);
    const root2 = mount(again.t, { kind: 'ready', result: result as Extract<PanelView, { kind: 'ready' }>['result'], docId: 'd2' });
    expect(root2.querySelector('[data-testid=privacy-notice]')).toBeNull();
  });

  it('a page that went away while the notice waited is never sent', async () => {
    const { t, calls } = setup();
    const hooks = t.hooks as Required<SessionHooks>;
    hooks.active(1);
    hooks.ready(1, 'd1', result);
    await settle();
    hooks.gone(1);
    await t.privacy.acknowledge();
    await settle();
    expect(calls()).toBe(0);
  });

  it('holds a selection too, until the notice is acknowledged', async () => {
    const { f, t, calls } = setup();
    t.hooks.active?.(1);
    t.watch(() => 1);
    f.leave(1, { at: 1, url: 'https://example.com/a', text: 'Hello there.' });
    await settle();
    expect(calls()).toBe(0);
    await t.privacy.acknowledge();
    await settle(60);
    expect(calls()).toBe(1);
    expect(t.snippets.jobs.get(1)?.status).toBe('done');
  });
});
