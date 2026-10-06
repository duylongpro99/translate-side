// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/index';
import { translatorClient } from '@/engine/testing';
import { GEMINI_PROFILE } from '@/shared/settings';
import type { SessionHooks } from './controller.ts';
import { createTranslator } from './translator.ts';

type Api = Parameters<typeof createTranslator>[0];
type Ready = Parameters<Required<SessionHooks>['ready']>[2];

/** Storage whose `sync.get` answers only when the test says so, plus change listeners. */
function fakeApi() {
  const sync = new Map<string, unknown>([['prefs', { targetLang: 'vi', sourceLang: 'auto' }]]);
  const gets: (() => void)[] = [];
  const onSync = new Set<(c: Record<string, unknown>) => void>();
  const listeners = () => ({ addListener: () => {}, removeListener: () => {} });
  const api = {
    storage: {
      sync: {
        get: (k: string) => new Promise((resolve) => gets.push(() => resolve(sync.has(k) ? { [k]: sync.get(k) } : {}))),
        onChanged: { addListener: (fn: never) => onSync.add(fn), removeListener: (fn: never) => onSync.delete(fn) },
      },
      local: { onChanged: listeners() },
    },
    permissions: { onAdded: listeners() },
    i18n: { getUILanguage: () => 'en' },
  } as unknown as Api;
  return {
    api,
    answer: () => gets.splice(0).forEach((g) => g()),
    setPrefs(prefs: unknown) {
      sync.set('prefs', prefs);
      for (const fn of onSync) fn({ prefs: { newValue: prefs } });
    },
  };
}

const text = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ');
const segments: Segment[] = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, kind: 'p', text, inlineMarkup: text, domPath: `/p[${i + 1}]`, translate: true }));
const result = { ok: true, via: 'walk', url: 'https://x/', title: 'Page', lang: 'en', segments } as Ready;
const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const client = () => () => Promise.resolve({ ok: true as const, client: translatorClient(), profile: GEMINI_PROFILE });

describe('translator wiring (plan M1-E8)', () => {
  it('starts no job for a page that went away, or a tab that closed, while the settings were read (review E-R1)', async () => {
    const f = fakeApi();
    const t = createTranslator(f.api, { translateClient: client() });
    const hooks = t.hooks as Required<SessionHooks>;
    hooks.active(1);
    hooks.ready(1, 'd', result);
    hooks.gone(1);
    hooks.ready(2, 'e', result);
    hooks.closed(2);
    f.answer();
    await settle();
    expect(t.jobs.get(1)).toBeUndefined();
    expect(t.jobs.get(2)).toBeUndefined();

    // The page read again: it does start.
    hooks.ready(1, 'd2', result);
    f.answer();
    await settle();
    expect(t.jobs.docOf(1)).toBe('d2');
  });

  it('a language change restarts the active page and keeps what the earlier run cost (review E-R3)', async () => {
    const f = fakeApi();
    const t = createTranslator(f.api, { translateClient: client() });
    const hooks = t.hooks as Required<SessionHooks>;
    const stop = t.watch(() => 1);
    hooks.active(1);
    hooks.ready(1, 'd', result);
    f.answer();
    await settle(50);
    const before = t.jobs.get(1);
    expect(before?.status).toBe('done');
    expect(before?.cost ?? 0).toBeGreaterThan(0);

    f.setPrefs({ targetLang: 'ja', sourceLang: 'auto' });
    f.answer();
    await settle(50);
    const after = t.jobs.get(1);
    expect(after?.targetLang).toBe('ja');
    expect(after?.status).toBe('done');
    expect(after?.cost ?? 0).toBeGreaterThan(before?.cost ?? 0);

    // A page that has gone is not restarted by a later change.
    hooks.gone(1);
    f.setPrefs({ targetLang: 'de', sourceLang: 'auto' });
    f.answer();
    await settle(20);
    expect(t.jobs.get(1)?.targetLang).toBe('ja');
    stop();
  });
});
