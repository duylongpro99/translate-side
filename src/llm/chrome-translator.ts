// Chrome's on-device Translator behind the MTClient port (DESIGN.md §4.2.6, plan M5-E7): the
// `basic` strategy's translator, the last fallback when every provider is down. It is gated by
// `availability()` (plan §8: "a last fallback, not a dependency"): a pair Chrome can't translate,
// or a browser without the API, is an answer the reader sees, never a silent failure.
//
// A pair whose model is not on the device yet ("downloadable") may need a user gesture to create;
// the fallback starts long after any click, so creating can fail. That failure is the answer too.
// One translator per pair, created on first use and kept; a failed create is tried again next time.

import type { LLMError, MTAvailability, MTClient, MTResult } from './types.ts';

/** `producedBy.model` of a block the basic strategy translated. */
export const CHROME_TRANSLATOR_MODEL = 'Chrome Translator';

interface ChromeTranslator {
  translate(text: string, opts?: { signal?: AbortSignal }): Promise<string>;
}
interface ChromeTranslatorStatic {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<MTAvailability>;
  create(opts: { sourceLanguage: string; targetLanguage: string; signal?: AbortSignal }): Promise<ChromeTranslator>;
}
interface ChromeLanguageDetectorStatic {
  create(): Promise<{ detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]> }>;
}

/** Below this confidence a detected language is not used as the source. */
const DETECT_MIN_CONFIDENCE = 0.5;

const failure = (message: string, raw?: unknown): MTResult => ({ ok: false, error: { kind: 'unknown', message, ...(raw === undefined ? {} : { raw }) } satisfies LLMError });

const pair = (from: string, to: string) => `${from || 'this language'} → ${to}`;

/** What the reader is told when Chrome can't translate the pair. */
export function unavailableMessage(from: string, to: string, state: MTAvailability | 'missing'): string {
  if (state === 'missing') return "This browser has no built-in translator (Chrome's Translator API), so there is no basic translation either.";
  if (state === 'unavailable') return `Chrome's built-in translator can't translate ${pair(from, to)} on this device, so there is no basic translation either.`;
  return `Chrome's built-in translator for ${pair(from, to)} is not downloaded yet, so there is no basic translation either.`;
}

/** The Translator of `scope` (the panel's window), or undefined when the browser has none. */
export function chromeTranslator(scope: object = globalThis): MTClient | undefined {
  const api = (scope as { Translator?: ChromeTranslatorStatic }).Translator;
  if (api === undefined || typeof api.create !== 'function' || typeof api.availability !== 'function') return undefined;
  const detectorApi = (scope as { LanguageDetector?: ChromeLanguageDetectorStatic }).LanguageDetector;
  const made = new Map<string, Promise<ChromeTranslator>>();

  const detect = async (text: string): Promise<string> => {
    if (detectorApi === undefined || typeof detectorApi.create !== 'function') return '';
    try {
      const top = (await (await detectorApi.create()).detect(text))[0];
      return top && top.confidence >= DETECT_MIN_CONFIDENCE && top.detectedLanguage !== 'und' ? top.detectedLanguage : '';
    } catch {
      return '';
    }
  };

  const translatorFor = (from: string, to: string): Promise<ChromeTranslator> => {
    const key = `${from}>${to}`;
    let t = made.get(key);
    if (t === undefined) {
      t = api.create({ sourceLanguage: from, targetLanguage: to });
      made.set(key, t);
      t.catch(() => made.delete(key));
    }
    return t;
  };

  return {
    model: CHROME_TRANSLATOR_MODEL,
    async availability(from, to) {
      if (from === '') return 'available';
      try {
        return await api.availability({ sourceLanguage: from, targetLanguage: to });
      } catch {
        return 'unavailable';
      }
    },
    async translate(text, from, to, signal) {
      signal.throwIfAborted();
      const source = from || (await detect(text));
      signal.throwIfAborted();
      if (source === '') return failure("The page's language is not known, so Chrome's built-in translator can't translate it.");
      // Already in the target language: nothing to translate.
      if (source.split('-')[0]?.toLowerCase() === to.split('-')[0]?.toLowerCase()) return { ok: true, text };
      let state: MTAvailability;
      try {
        state = await api.availability({ sourceLanguage: source, targetLanguage: to });
      } catch {
        state = 'unavailable';
      }
      signal.throwIfAborted();
      if (state === 'unavailable') return failure(unavailableMessage(source, to, state));
      let translator: ChromeTranslator;
      try {
        translator = await translatorFor(source, to);
      } catch (error) {
        signal.throwIfAborted();
        return failure(state === 'available' ? `Chrome's built-in translator did not start (${errorText(error)}).` : unavailableMessage(source, to, state), error);
      }
      try {
        return { ok: true, text: await translator.translate(text, { signal }) };
      } catch (error) {
        signal.throwIfAborted();
        return failure(`Chrome's built-in translator failed (${errorText(error)}).`, error);
      }
    },
  };
}

const errorText = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));
