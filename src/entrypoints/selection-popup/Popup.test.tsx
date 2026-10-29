// @vitest-environment jsdom
// The selection popup: the selection button's translation, next to the text. It is the panel's
// selection mode in a small page, so these check what is its own: the record it waits for, that it
// takes no other selection, and Open in side panel.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translatorClient } from '@/engine/testing';
import type { LLMClient } from '@/llm/types';
import { SELECTION_POPUP_PANEL_MESSAGE } from '@/shared/protocol';
import { GEMINI_PROFILE } from '@/shared/settings';
import type { PopupRecord, SnippetRecord } from '@/shared/snippet';
import type { ClientResult } from '../sidepanel/jobs.ts';
import { PRIVACY_NOTICE_VERSION } from '../sidepanel/privacy.ts';
import { createTranslator } from '../sidepanel/translator.ts';
import { Popup } from './Popup.tsx';
import { waitForPopupRecord } from './record.ts';

type Api = Parameters<typeof createTranslator>[0];

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function fakeApi(opts: { acknowledged?: boolean; panelOpens?: boolean } = {}) {
  const onSession = new Set<(c: Record<string, { newValue?: unknown }>) => void>();
  const session = new Map<string, unknown>();
  const none = { addListener: () => {}, removeListener: () => {} };
  const calls: string[] = [];
  const api = {
    storage: {
      sync: { get: (k: string) => Promise.resolve(k === 'prefs' ? { prefs: { targetLang: 'vi', sourceLang: 'auto' } } : {}), onChanged: none },
      local: { get: () => Promise.resolve(opts.acknowledged === false ? {} : { privacyNotice: { version: PRIVACY_NOTICE_VERSION, at: 0 } }), set: () => Promise.resolve(), onChanged: none },
      session: {
        get: (k: string) => Promise.resolve(session.has(k) ? { [k]: session.get(k) } : {}),
        remove: (k: string) => (session.delete(k), Promise.resolve()),
        onChanged: { addListener: (fn: never) => onSession.add(fn), removeListener: (fn: never) => onSession.delete(fn) },
      },
    },
    permissions: { onAdded: none, request: () => Promise.resolve(true) },
    runtime: {
      openOptionsPage: () => Promise.resolve(),
      sendMessage: (m: { type: string; id: string }) => (calls.push(`message:${m.type}:${m.id}`), Promise.resolve()),
    },
    sidePanel: { open: (o: { tabId: number }) => (calls.push(`open:${o.tabId}`), opts.panelOpens === false ? Promise.reject(new Error('no gesture')) : Promise.resolve()) },
    i18n: { getUILanguage: () => 'en' },
  } as unknown as Api;
  return {
    api,
    calls,
    session,
    /** What the worker does: write the record, and storage.session.onChanged tells whoever listens. */
    leave(key: string, record: SnippetRecord | PopupRecord) {
      session.set(key, record);
      for (const fn of onSession) fn({ [key]: { newValue: record } });
    },
  };
}

const settle = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await act(() => settle(2));
  }
}

let sent: string[] = [];
const okClient = (): (() => Promise<ClientResult>) => () => {
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

const popupRecord = (text: string): PopupRecord => ({ at: 1, url: 'https://example.com/a', text, tabId: 4 });

function mount(f: ReturnType<typeof fakeApi>, t: ReturnType<typeof createTranslator>, onClose = vi.fn()) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  act(() => render(<Popup api={f.api} translator={t} id={ID} onClose={onClose} />, root));
  return { root, onClose };
}

afterEach(() => {
  sent = [];
  document.body.replaceChildren();
});

describe('waitForPopupRecord', () => {
  it('takes the record already kept, or the one that lands after the popup loads', async () => {
    const f = fakeApi();
    f.session.set(`selectionPopup:${ID}`, popupRecord('Hello'));
    await expect(waitForPopupRecord(f.api, ID, 50)).resolves.toMatchObject({ text: 'Hello' });
    const later = fakeApi();
    const waiting = waitForPopupRecord(later.api, ID, 500);
    later.leave(`selectionPopup:${ID}`, popupRecord('Later'));
    await expect(waiting).resolves.toMatchObject({ text: 'Later' });
  });

  it('gives up when none comes', async () => {
    await expect(waitForPopupRecord(fakeApi().api, ID, 20)).resolves.toBeUndefined();
  });
});

describe('the selection popup', () => {
  it('translates the selection the worker kept for it, as the panel would', async () => {
    const f = fakeApi();
    f.session.set(`selectionPopup:${ID}`, popupRecord('Hello there.'));
    const t = createTranslator(f.api, { translateClient: okClient() });
    const { root } = mount(f, t);
    await until(() => t.snippets.jobs.get(4)?.status === 'done');
    expect(sent.join()).toContain('Hello there.');
    await until(() => root.querySelector('[data-testid="selection"]') !== null);
    expect(root.querySelector('[data-testid="popup-open-panel"]')).not.toBeNull();
  });

  it("takes no other selection: a context-menu record for the panel is the panel's", async () => {
    const f = fakeApi();
    f.session.set(`selectionPopup:${ID}`, popupRecord('Mine.'));
    const t = createTranslator(f.api, { translateClient: okClient() });
    mount(f, t);
    await until(() => t.snippets.jobs.get(4)?.status === 'done');
    f.leave('snippet:4', { at: 2, url: 'https://example.com/a', text: 'For the panel.' });
    await act(() => settle(30));
    expect(sent.join()).not.toContain('For the panel.');
    expect(f.session.has('snippet:4')).toBe(true);
  });

  it('Open in side panel opens the panel first, in the click, then, once it is open, has the worker hand the selection over and closes', async () => {
    const f = fakeApi();
    f.session.set(`selectionPopup:${ID}`, popupRecord('Hello.'));
    const t = createTranslator(f.api, { translateClient: okClient() });
    const { root, onClose } = mount(f, t);
    await until(() => root.querySelector('[data-testid="popup-open-panel"]') !== null);
    act(() => (root.querySelector('[data-testid="popup-open-panel"]') as HTMLButtonElement).click());
    // Nothing before sidePanel.open: it needs the click's gesture.
    expect(f.calls).toEqual(['open:4']);
    await until(() => onClose.mock.calls.length > 0);
    expect(f.calls).toEqual(['open:4', `message:${SELECTION_POPUP_PANEL_MESSAGE}:${ID}`]);
  });

  it("a panel that did not open gets no selection, and the popup stays and says so", async () => {
    const f = fakeApi({ panelOpens: false });
    f.session.set(`selectionPopup:${ID}`, popupRecord('Hello.'));
    const t = createTranslator(f.api, { translateClient: okClient() });
    const { root, onClose } = mount(f, t);
    await until(() => root.querySelector('[data-testid="popup-open-panel"]') !== null);
    act(() => (root.querySelector('[data-testid="popup-open-panel"]') as HTMLButtonElement).click());
    await until(() => root.querySelector('[data-testid="popup-panel-failed"]') !== null);
    expect(f.calls).toEqual(['open:4']);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves the privacy notice to the panel: it says so, offers no OK, and sends nothing', async () => {
    const f = fakeApi({ acknowledged: false });
    f.session.set(`selectionPopup:${ID}`, popupRecord('Hello.'));
    const t = createTranslator(f.api, { translateClient: okClient() });
    const { root } = mount(f, t);
    await until(() => root.querySelector('[data-testid="popup-privacy"]') !== null);
    expect(root.querySelector('[data-testid="privacy-ok"]')).toBeNull();
    expect(root.querySelector('[data-testid="popup-open-panel"]')).not.toBeNull();
    expect(sent).toEqual([]);
  });

  it("leaves the spend limit's Continue anyway to the panel", async () => {
    const f = fakeApi();
    f.session.set(`selectionPopup:${ID}`, popupRecord('Hello.'));
    const t = createTranslator(f.api, { translateClient: okClient(), spendLimit: () => Promise.resolve({ limitUsd: 5, monthUsd: 6 }) });
    const { root } = mount(f, t);
    await until(() => root.querySelector('[data-testid="job-limit"]') !== null);
    expect(root.querySelector('[data-testid="limit-continue"]')).toBeNull();
    expect(sent).toEqual([]);
  });

  it('a blocked selection says so, sends nothing and offers no panel', async () => {
    const f = fakeApi();
    f.session.set(`selectionPopup:${ID}`, { at: 1, url: 'https://mail.google.com/', blocked: 'denylisted', tabId: 4 } satisfies PopupRecord);
    const t = createTranslator(f.api, { translateClient: okClient() });
    const { root } = mount(f, t);
    await until(() => root.querySelector('[data-state="blocked"]') !== null);
    expect(root.querySelector('[data-testid="popup-open-panel"]')).toBeNull();
    expect(sent).toEqual([]);
  });
});
