// Chrome's built-in AI, faked for the e2e harness: Chrome for Testing has a real `Translator` whose
// `create()` never settles, and no Gemini Nano. `context.addInitScript` puts the fake on every
// extension page before its bundle runs (decision S8, question 7). It follows Chrome's rules where
// the flows depend on them: `availability()` per pair, and a `create()` of a pair or model that is
// not `available` needs the page's own user activation (a real click), then reports its download
// through `monitor` and makes it `available`. Nothing of this reaches the release build
// (scripts/check-bundle.mjs looks for FAKE_AI_MARK).

import type { BrowserContext } from '@playwright/test';

export const FAKE_AI_MARK = '__translateSideFakeAI';

type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export interface FakeAI {
  /** Translator pairs `from>to` by state; others are `unavailable`. */
  pairs?: Record<string, Availability>;
  /** Gemini Nano by output language; absent: no `LanguageModel` at all. */
  nano?: Record<string, Availability>;
  /** No `Translator` either (a browser without on-device AI). */
  none?: boolean;
  /** What the language detector says the page is in (default `en`). */
  detect?: string;
  /** Milliseconds between download progress events (default 150). */
  stepMs?: number;
}

/** Installs the fake on the extension pages opened from now on in `context`. */
export async function fakeBuiltinAI(context: BrowserContext, config: FakeAI): Promise<void> {
  await context.addInitScript(
    ([cfg, mark]) => {
      if (location.protocol !== 'chrome-extension:') return;
      const scope = globalThis as unknown as Record<string, unknown>;
      // Chrome for Testing's own, replaced (or removed for a browser without on-device AI).
      delete scope.Translator;
      delete scope.LanguageModel;
      delete scope.LanguageDetector;
      scope[mark] = true;
      if (cfg.none) return;
      const pairs = new Map(Object.entries(cfg.pairs ?? {}));
      const activated = () => (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive === true;
      const download = async (monitor: ((m: EventTarget) => void) | undefined) => {
        const target = new EventTarget();
        monitor?.(target);
        for (const loaded of [0, 0.5, 1]) {
          target.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded, total: 1 }));
          if (loaded < 1) await new Promise((r) => setTimeout(r, cfg.stepMs ?? 150));
        }
      };
      const refused = () => Promise.reject(new DOMException('Requires a user gesture when availability is "downloading" or "downloadable".', 'NotAllowedError'));
      scope.Translator = {
        availability: async (o: { sourceLanguage: string; targetLanguage: string }) => pairs.get(`${o.sourceLanguage}>${o.targetLanguage}`) ?? 'unavailable',
        create: (o: { sourceLanguage: string; targetLanguage: string; monitor?: (m: EventTarget) => void }) => {
          const key = `${o.sourceLanguage}>${o.targetLanguage}`;
          const state = pairs.get(key) ?? 'unavailable';
          if (state === 'unavailable') return Promise.reject(new DOMException('Unable to create translator for the given source and target language.', 'NotSupportedError'));
          if (state !== 'available' && !activated()) return refused();
          return (async () => {
            if (state !== 'available') await download(o.monitor);
            pairs.set(key, 'available');
            return { translate: async (text: string) => `[${o.targetLanguage}] ${text}`, destroy() {} };
          })();
        },
      };
      if (cfg.nano) {
        const nano = new Map(Object.entries(cfg.nano));
        const out = (o?: { expectedOutputs?: { languages: string[] }[] }) => o?.expectedOutputs?.[0]?.languages[0] ?? 'en';
        scope.LanguageModel = {
          availability: async (o?: { expectedOutputs?: { languages: string[] }[] }) => nano.get(out(o)) ?? 'unavailable',
          params: async () => ({ defaultTopK: 3 }),
          create: (o: { expectedOutputs?: { languages: string[] }[]; monitor?: (m: EventTarget) => void }) => {
            const state = nano.get(out(o)) ?? 'unavailable';
            if (state === 'unavailable') return Promise.reject(new DOMException('Unsupported output language.', 'NotSupportedError'));
            if (state !== 'available' && !activated()) return refused();
            return (async () => {
              if (state !== 'available') await download(o.monitor);
              nano.set(out(o), 'available');
              return { promptStreaming: () => (async function* () {})(), destroy() {} };
            })();
          },
        };
      }
      const detected = cfg.detect ?? 'en';
      scope.LanguageDetector = { availability: async () => 'available', create: async () => ({ detect: async () => [{ detectedLanguage: detected, confidence: 0.99 }] }) };
    },
    [config, FAKE_AI_MARK] as const,
  );
}
