// @vitest-environment jsdom
// The turn-on click (the on-device route, src/llm/on-device.ts): created in the click's own task,
// its download shown, Cancel stops it, and the page translates once it is ready.
import { describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/index';
import { chromeTranslator } from '@/llm/chrome-translator';
import { pickEngine, translatorRouteClient } from '@/llm/on-device';
import { fakeBuiltinAI } from '@/llm/testing';
import { ON_DEVICE_CONNECTION, TRANSLATOR_PROFILE } from '@/shared/settings';
import type { ClientResult, ClientTarget } from './jobs.ts';
import { PRIVACY_NOTICE_VERSION } from './privacy.ts';
import { uiError } from './status.ts';
import { createTranslator } from './translator.ts';
import type { SessionHooks } from './controller.ts';

type Api = Parameters<typeof createTranslator>[0];
const listeners = () => ({ addListener: () => {}, removeListener: () => {} });
const api = {
  storage: {
    sync: { get: (k: unknown) => Promise.resolve(k === 'prefs' ? { prefs: { targetLang: 'vi', sourceLang: 'en' } } : {}), onChanged: listeners() },
    local: { get: () => Promise.resolve({ privacyNotice: { version: PRIVACY_NOTICE_VERSION, at: 0 } }), set: () => Promise.resolve(), onChanged: listeners() },
    session: { onChanged: listeners(), get: () => Promise.resolve({}), remove: () => Promise.resolve() },
  },
  permissions: { onAdded: listeners() },
  i18n: { getUILanguage: () => 'en' },
} as unknown as Api;

const segments: Segment[] = [0, 1].map((i) => ({ id: `s${i}`, kind: 'p', text: `Para ${i}.`, inlineMarkup: `Para ${i}.`, domPath: `/p[${i + 1}]`, translate: true }));
const page = { ok: true, via: 'walk', url: 'https://x/', title: 'Page', lang: 'en', segments } as Parameters<Required<SessionHooks>['ready']>[2];
const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));

/** The route over the fake's state (as route.ts decides it): the Translator, or the click it needs. */
const connection = { id: ON_DEVICE_CONNECTION.id, label: ON_DEVICE_CONNECTION.label, presetId: ON_DEVICE_CONNECTION.presetId };
const routeOver = (scope: object) => async (t: ClientTarget): Promise<ClientResult> => {
  const choice = await pickEngine(scope, { setting: 'translator', from: t.sourceLang ?? '', to: t.targetLang ?? '', translator: true });
  if ('engine' in choice) return { ok: true, client: translatorRouteClient(), profile: TRANSLATOR_PROFILE, connection, onDevice: 'translator' };
  if ('needsSetup' in choice) return { ok: false, error: uiError('bad_request', 'turn on', 'onDeviceSetup', [choice.needsSetup, choice.from, choice.to]), connection };
  return { ok: false, error: uiError('bad_request', 'no', 'onDeviceUnavailable', ['pair', t.sourceLang ?? '', t.targetLang ?? '']), connection };
};

function panel(hold = false) {
  const ai = fakeBuiltinAI({ pairs: { 'en>vi': 'downloadable' }, hold });
  const t = createTranslator(api, { translateClient: routeOver(ai.scope), mt: chromeTranslator(ai.scope), cache: undefined, memory: undefined }, { scope: ai.scope, detector: undefined });
  const hooks = t.hooks as Required<SessionHooks>;
  hooks.active(1);
  /** The page read in tab 1, translated as the panel does (settings, detection, then the job). */
  const open = async () => {
    hooks.ready(1, 'd', page);
    await settle(20);
  };
  return { t, ai, open };
}

/** A click: the activation exists for the handler's own task only. */
const click = (ai: ReturnType<typeof fakeBuiltinAI>, handler: () => void) => {
  ai.activation.transient = true;
  try {
    handler();
  } finally {
    ai.activation.transient = false;
  }
};

describe('the turn-on click (panel)', () => {
  it('a fresh pair stops the page with its turn-on; the click creates it in its own task, then the page translates', async () => {
    const { t, ai, open } = panel();
    await open();
    expect(t.jobs.get(1)).toMatchObject({ status: 'stopped', stopError: { raw: { ui: 'onDeviceSetup', args: ['translator', 'en', 'vi'] } } });
    expect(ai.creates).toEqual([]);
    // Not translating on the device yet, so the switcher and the setup offer don't say it is.
    expect((await t.switcher.read({ tabId: 1 })).onDevice).toBeUndefined();
    click(ai, () => t.actions(1).turnOnDevice?.('translator', 'en', 'vi'));
    // Created before the handler returned: Chrome's Translator consumed the click.
    expect(ai.creates).toEqual([{ api: 'translator', from: 'en', to: 'vi' }]);
    await settle(30);
    const v = t.jobs.get(1);
    expect(v?.status).toBe('done');
    expect([...(v?.segs.values() ?? [])].map((s) => s.text)).toEqual(['[vi] Para 0.', '[vi] Para 1.']);
    expect(v?.onDeviceDownload).toBeUndefined();
    expect((await t.switcher.read({ tabId: 1 })).onDevice).toBe('translator');
  });

  it('shows the download, and Cancel stops it without translating', async () => {
    const { t, ai, open } = panel(true);
    await open();
    click(ai, () => t.actions(1).turnOnDevice?.('translator', 'en', 'vi'));
    await settle();
    expect(t.jobs.get(1)?.onDeviceDownload).toEqual({ engine: 'translator', from: 'en', to: 'vi', loaded: 0 });
    t.actions(1).cancelOnDevice?.();
    await settle();
    expect(t.jobs.get(1)?.onDeviceDownload).toBeUndefined();
    expect(t.jobs.get(1)?.status).toBe('stopped');
    expect(ai.pairs.get('en>vi')).toBe('downloadable');
  });

  it('a download that finishes later re-runs the page; one that fails says why', async () => {
    const { t, ai, open } = panel(true);
    await open();
    click(ai, () => t.actions(1).turnOnDevice?.('translator', 'en', 'vi'));
    await settle();
    ai.finish();
    await settle(30);
    expect(t.jobs.get(1)?.status).toBe('done');

    const other = panel();
    await other.open();
    // No click: Chrome refuses the create, and the bar says so with Try again.
    other.t.actions(1).turnOnDevice?.('translator', 'en', 'vi');
    await settle();
    expect(other.t.jobs.get(1)?.onDeviceDownload).toMatchObject({ engine: 'translator', error: expect.stringContaining('NotAllowedError') });
  });

  it('a pair turned on while the page still runs: the page runs again once the run ends, not before', async () => {
    const ai = fakeBuiltinAI({ pairs: { 'fr>vi': 'downloadable' } });
    const route = routeOver(ai.scope);
    let calls = 0;
    let release: (() => void) | undefined;
    // The first run's route is held open, so the job is still running when the click's download ends.
    const translateClient = async (target: ClientTarget): Promise<ClientResult> => {
      calls++;
      if (calls === 1) await new Promise<void>((r) => (release = r));
      return route(target);
    };
    const t = createTranslator(api, { translateClient, mt: chromeTranslator(ai.scope), cache: undefined, memory: undefined }, { scope: ai.scope, detector: undefined });
    const hooks = t.hooks as Required<SessionHooks>;
    hooks.active(1);
    hooks.ready(1, 'd', page);
    await settle(20);
    expect(t.jobs.get(1)?.status).toBe('running');
    click(ai, () => t.actions(1).turnOnDevice?.('translator', 'fr', 'vi'));
    await settle(20);
    expect(ai.pairs.get('fr>vi')).toBe('available');
    expect(calls).toBe(1);
    release?.();
    await settle(40);
    expect(calls).toBeGreaterThan(1);
  });
});
