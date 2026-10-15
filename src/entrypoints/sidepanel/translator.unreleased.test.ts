// @vitest-environment jsdom
// With Best not released, a refine request runs contextual, from every source.
import { PRIVACY_NOTICE_VERSION } from './privacy.ts';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '@/engine/index';
import { translatorClient } from '@/engine/testing';
import type { NormalizedRequest } from '@/llm/types';
import { openTranslationCache, type TranslationCache } from '@/shared/cache';
import type { JobRecord } from '@/shared/diagnostics';
import { GEMINI_PROFILE } from '@/shared/settings';
import type { SessionHooks } from './controller.ts';
import { createTranslator } from './translator.ts';

vi.mock('@/shared/quality', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/shared/quality')>()), BEST_MODE_RELEASED: false }));

type Api = Parameters<typeof createTranslator>[0];
type Ready = Parameters<Required<SessionHooks>['ready']>[2];

const text = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ');
const segments: Segment[] = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, kind: 'p', text, inlineMarkup: text, domPath: `/p[${i + 1}]`, translate: true }));
const page = { ok: true, via: 'walk', url: 'https://x/', title: 'Page', lang: 'en', segments } as Ready;
const isReview = (r: NormalizedRequest) => (r.messages[0]?.content ?? '').startsWith('<review>');

const sources: [string, Record<string, unknown>][] = [
  ['the header mode', { mode: 'best', keepDraftsOnScreen: false }],
  ['the advanced override', { mode: 'balanced', strategy: 'refine', keepDraftsOnScreen: false }],
  ['an imported setting', { mode: 'fast', strategy: 'refine', keepDraftsOnScreen: true }],
];

describe('BEST_MODE_RELEASED off', () => {
  for (const [name, quality] of sources) {
    it(`${name} runs contextual, with the feature available, and makes no review call`, async () => {
      const sync = new Map<string, unknown>([
        ['prefs', { targetLang: 'vi', sourceLang: 'auto' }],
        ['quality', quality],
      ]);
      const none = { addListener: () => {}, removeListener: () => {} };
      const api = {
        storage: {
          sync: { get: (k: string | string[]) => Promise.resolve(typeof k === 'string' && sync.has(k) ? { [k]: sync.get(k) } : {}), onChanged: none },
          local: { get: () => Promise.resolve({ privacyNotice: { version: PRIVACY_NOTICE_VERSION, at: 0 } }), set: () => Promise.resolve(), onChanged: none },
          session: { onChanged: none, get: () => Promise.resolve({}), remove: () => Promise.resolve() },
        },
        permissions: { onAdded: none },
        i18n: { getUILanguage: () => 'en' },
      } as unknown as Api;
      const c = translatorClient((lines, _n, req) => (req.system.startsWith('You prepare a translator') ? '{}' : lines.map((l) => `<seg id="${l.n}">vi:${l.source}</seg>`).join('\n')));
      const records: JobRecord[] = [];
      const t = createTranslator(api, {
        translateClient: () => Promise.resolve({ ok: true, client: c, profile: GEMINI_PROFILE, review: () => Promise.resolve({ ok: true, client: c, profile: GEMINI_PROFILE }) }),
        featureAvailable: () => Promise.resolve(true),
        onJobRecord: (r) => records.push(r),
        cache: openTranslationCache({ factory: new IDBFactory() }) as TranslationCache,
      });
      const hooks = t.hooks as Required<SessionHooks>;
      hooks.active(1);
      hooks.ready(1, 'd', page);
      const end = Date.now() + 3000;
      while (t.jobs.get(1)?.status !== 'done' && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
      expect(records.filter((r) => r.outcome === 'done').map((r) => r.strategy)).toEqual(['contextual']);
      expect(c.requests.filter(isReview)).toEqual([]);
    });
  }
});
