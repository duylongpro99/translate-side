// Chrome's on-device Translator behind the MTClient port (DESIGN.md §4.2.6, plan M5-E7): the
// `basic` strategy's translator, the last fallback when every provider is down. It is gated by
// `availability()` (plan §8: "a last fallback, not a dependency"): a pair Chrome can't translate,
// or a browser without the API, is an answer the reader sees, never a silent failure.
//
// A pair Chrome does not report `available` is never created here: creating it needs the reader's
// click (Chrome reports every pair this extension has not created yet as `downloadable`, and
// creating one starts a download). Such a block fails with a `needs-activation` result, which the
// panel turns into a turn-on button for the pair; `prepare` is that button's create.
// One translator per pair, created on first use and kept; a failed create is tried again next time.
// A create that does not settle within CREATE_TIMEOUT_MS (seen live: Chrome for Testing never
// downloads the model) is an answer too, and while it is still pending, later blocks get that
// answer at once instead of waiting again.

import type { LLMError, MTAvailability, MTClient, MTResult } from './types.ts';

/** `producedBy.model` of a block the basic strategy translated. */
export const CHROME_TRANSLATOR_MODEL = 'Chrome Translator';

interface ChromeTranslator {
  translate(text: string, opts?: { signal?: AbortSignal }): Promise<string>;
}
interface ChromeTranslatorStatic {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<MTAvailability>;
  create(opts: { sourceLanguage: string; targetLanguage: string; signal?: AbortSignal; monitor?: (m: EventTarget) => void }): Promise<ChromeTranslator>;
}
interface ChromeLanguageDetectorStatic {
  create(): Promise<{ detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]> }>;
}

/** How long a block waits for Chrome to create (and, if needed, download) the pair's translator. */
export const CREATE_TIMEOUT_MS = 30_000;

/** Below this confidence a detected language is not used as the source. */
const DETECT_MIN_CONFIDENCE = 0.5;

const failure = (message: string, raw?: unknown): MTResult => ({ ok: false, error: { kind: 'unknown', message, ...(raw === undefined ? {} : { raw }) } satisfies LLMError });

/** `LLMError.raw` of a block whose pair needs the reader's click before Chrome can translate it. */
export interface NeedsActivationRaw {
  reason: 'needs-activation';
  from: string;
  to: string;
}

/** The pair a failure is waiting on the turn-on click for; undefined for any other failure. */
export function needsActivation(error: LLMError): NeedsActivationRaw | undefined {
  const raw = error.raw as Partial<NeedsActivationRaw> | undefined;
  return raw?.reason === 'needs-activation' && typeof raw.from === 'string' && typeof raw.to === 'string' ? (raw as NeedsActivationRaw) : undefined;
}

/** A Translator download's progress, 0 to 1 (Chrome's `downloadprogress`, the 0 and 1 events always fire). */
export type DownloadProgress = (loaded: number) => void;

/** The MTClient over Chrome's Translator, and the turn-on click's create. */
export interface ChromeMTClient extends MTClient {
  /**
   * Creates the pair's translator: call it synchronously in the click handler, before any `await`
   * (Translator `create()` consumes the click's activation). Resolves when it is ready to use, after
   * any download; a stalled or failed earlier create of the pair is replaced.
   */
  prepare(from: string, to: string, opts?: { signal?: AbortSignal; progress?: DownloadProgress }): Promise<void>;
}

const pair = (from: string, to: string) => `${from || 'this language'} → ${to}`;

/** What the reader is told when Chrome can't translate the pair. */
export function unavailableMessage(from: string, to: string, state: MTAvailability | 'missing'): string {
  if (state === 'missing') return "This browser has no built-in translator (Chrome's Translator API), so there is no basic translation either.";
  if (state === 'unavailable') return `Chrome's built-in translator can't translate ${pair(from, to)} on this device, so there is no basic translation either.`;
  return `Chrome's built-in translator for ${pair(from, to)} is not downloaded yet, so there is no basic translation either.`;
}

/** The Translator of `scope` (the panel's window), or undefined when the browser has none. */
export function chromeTranslator(scope: object = globalThis, options: { createTimeoutMs?: number } = {}): ChromeMTClient | undefined {
  const createTimeoutMs = options.createTimeoutMs ?? CREATE_TIMEOUT_MS;
  const api = (scope as { Translator?: ChromeTranslatorStatic }).Translator;
  if (api === undefined || typeof api.create !== 'function' || typeof api.availability !== 'function') return undefined;
  const detectorApi = (scope as { LanguageDetector?: ChromeLanguageDetectorStatic }).LanguageDetector;
  const made = new Map<string, Promise<ChromeTranslator>>();
  /** Pairs whose create timed out and is still pending. */
  const stalled = new Set<string>();

  const detect = async (text: string): Promise<string> => {
    if (detectorApi === undefined || typeof detectorApi.create !== 'function') return '';
    try {
      const top = (await (await detectorApi.create()).detect(text))[0];
      return top && top.confidence >= DETECT_MIN_CONFIDENCE && top.detectedLanguage !== 'und' ? top.detectedLanguage : '';
    } catch {
      return '';
    }
  };

  const create = (from: string, to: string, opts: { signal?: AbortSignal; progress?: DownloadProgress } = {}): Promise<ChromeTranslator> => {
    const key = `${from}>${to}`;
    const { progress, signal } = opts;
    const t = api.create({
      sourceLanguage: from,
      targetLanguage: to,
      ...(signal ? { signal } : {}),
      ...(progress ? { monitor: (m: EventTarget) => m.addEventListener('downloadprogress', (e) => progress((e as ProgressEvent).loaded)) } : {}),
    });
    made.set(key, t);
    stalled.delete(key);
    t.then(
      () => {
        if (made.get(key) === t) stalled.delete(key);
      },
      () => {
        if (made.get(key) !== t) return;
        made.delete(key);
        stalled.delete(key);
      },
    );
    return t;
  };

  /** The pair's translator: the one created before, or a new one when Chrome has the pair `available`. */
  const translatorFor = (from: string, to: string, state: MTAvailability, signal: AbortSignal): Promise<ChromeTranslator> => {
    const key = `${from}>${to}`;
    let t = made.get(key);
    if (t === undefined) {
      if (state !== 'available') return Promise.reject(new NeedsActivation());
      t = create(from, to);
    }
    if (stalled.has(key)) return Promise.reject(new DOMException('still creating', 'TimeoutError'));
    const created = t;
    return new Promise<ChromeTranslator>((resolve, reject) => {
      const timer = setTimeout(() => {
        stalled.add(key);
        reject(new DOMException(`not created within ${createTimeoutMs} ms`, 'TimeoutError'));
      }, createTimeoutMs);
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', aborted);
      };
      const aborted = () => {
        done();
        reject(signal.reason);
      };
      signal.addEventListener('abort', aborted, { once: true });
      created.then(
        (v) => (done(), resolve(v)),
        (e: unknown) => (done(), reject(e)),
      );
    });
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
        translator = await translatorFor(source, to, state, signal);
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof NeedsActivation) return failure(unavailableMessage(source, to, 'downloadable'), { reason: 'needs-activation', from: source, to } satisfies NeedsActivationRaw);
        return failure(state === 'available' && !(error instanceof Error && error.name === 'TimeoutError') ? `Chrome's built-in translator did not start (${errorText(error)}).` : unavailableMessage(source, to, 'downloadable'), error);
      }
      try {
        return { ok: true, text: await translator.translate(text, { signal }) };
      } catch (error) {
        signal.throwIfAborted();
        return failure(`Chrome's built-in translator failed (${errorText(error)}).`, error);
      }
    },
    prepare(from, to, opts = {}) {
      return create(from, to, opts).then(() => undefined);
    },
  };
}

/** The pair is not `available` and was never created here: only the turn-on click may create it. */
class NeedsActivation extends Error {
  override name = 'NeedsActivation';
}

const errorText = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));
