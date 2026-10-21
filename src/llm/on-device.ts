// The on-device route (plan "zero-setup translation with Chrome built-in AI"): when no provider can
// run, Chrome's own models translate. Gemini Nano writes only a few languages (en, es, ja; de, fr
// from Chrome 149), so `auto` takes Nano when the pair allows it and Chrome's Translator otherwise.
//
// Choosing reads `availability()` only, never `create()`: Chrome reports a model or pair it has not
// created for this extension as `downloadable` (even when it is on the device), and creating one
// starts a download. That happens only from the reader's turn-on click (`prepareOnDevice`), so a job never
// downloads anything on its own.

import { bindClient } from './client.ts';
import { NANO_MODEL, createChromeBuiltinAdapter, nanoCanTry, nanoLanguages, nanoOf } from './chrome-builtin.ts';
import { CHROME_TRANSLATOR_MODEL, type ChromeMTClient, type DownloadProgress } from './chrome-translator.ts';
import type { LLMClient, MTAvailability, MTClient, ResolvedConnection } from './types.ts';

export type OnDeviceEngine = 'nano' | 'translator';

/** `Routing.onDevice`: which engine the route may take. */
export type OnDeviceSetting = 'auto' | OnDeviceEngine;
export const ON_DEVICE_SETTINGS: readonly OnDeviceSetting[] = ['auto', 'nano', 'translator'];

/**
 * Why no on-device engine can run: the browser has neither API, neither can do this pair, or the
 * engine setting (synced from another computer, say) leaves out the one that could.
 */
export type UnavailableReason = 'no-api' | 'pair' | 'setting';

export type EngineChoice =
  /** Runs now. */
  | { engine: OnDeviceEngine }
  /** Needs the reader's click first: its model or pair is not created for this extension yet. */
  | { needsSetup: OnDeviceEngine; from: string; to: string }
  /** Chrome is downloading it (a click started it earlier). */
  | { downloading: OnDeviceEngine; from: string; to: string }
  /** The page's language is not known, so no pair can be named. */
  | { unknownSource: true }
  | { unavailable: UnavailableReason; from: string; to: string };

interface TranslatorStatic {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<MTAvailability>;
  create(opts: { sourceLanguage: string; targetLanguage: string; signal?: AbortSignal; monitor?: (m: EventTarget) => void }): Promise<unknown>;
}

export const translatorOf = (scope: object): TranslatorStatic | undefined => {
  const api = (scope as { Translator?: TranslatorStatic }).Translator;
  return api !== undefined && typeof api.create === 'function' && typeof api.availability === 'function' ? api : undefined;
};

const stateOf = async (check: () => Promise<MTAvailability>): Promise<MTAvailability> => {
  try {
    return await check();
  } catch {
    return 'unavailable';
  }
};

/**
 * The engine for translating `from` → `to` on this device. `translator` false: the reader removed
 * "basic translation" from the fallback list, so Chrome's Translator is not used (the route then
 * stops as before, "Add your key"). Calls `availability()` only.
 */
export async function pickEngine(scope: object, opts: { setting: OnDeviceSetting; from: string; to: string; translator: boolean }): Promise<EngineChoice> {
  const choice = await pickWithin(scope, opts);
  if (!('unavailable' in choice) || opts.setting === 'auto') return choice;
  const auto = await pickWithin(scope, { ...opts, setting: 'auto' });
  return 'unavailable' in auto ? choice : { unavailable: 'setting', from: opts.from, to: opts.to };
}

async function pickWithin(scope: object, opts: { setting: OnDeviceSetting; from: string; to: string; translator: boolean }): Promise<EngineChoice> {
  const { setting, from, to } = opts;
  const nano = setting === 'translator' ? undefined : nanoOf(scope);
  const mt = setting === 'nano' || !opts.translator ? undefined : translatorOf(scope);
  if (nano === undefined && mt === undefined) return { unavailable: 'no-api', from, to };
  if (from === '') return { unknownSource: true };
  const nanoState = nano === undefined || !nanoCanTry(from, to) ? 'unavailable' : await stateOf(() => nano.availability(nanoLanguages(from, to)));
  if (nanoState === 'available') return { engine: 'nano' };
  const mtState = mt === undefined ? 'unavailable' : await stateOf(() => mt.availability({ sourceLanguage: from, targetLanguage: to }));
  if (mtState === 'available') return { engine: 'translator' };
  // Translator first when it can be set up: small packs, every language; Nano is a 4 GB download.
  for (const [engine, state] of [['translator', mtState], ['nano', nanoState]] as const) {
    if (state === 'downloading') return { downloading: engine, from, to };
    if (state === 'downloadable') return { needsSetup: engine, from, to };
  }
  return { unavailable: 'pair', from, to };
}

/** What the on-device clients are bound to: no base URL, no key, no host permission to ask for. */
const ON_DEVICE: ResolvedConnection = { id: 'chrome-on-device', protocol: 'chrome-builtin', baseUrl: '', auth: { style: 'none' }, quirks: {}, hasHostPermission: async () => true };

/** Gemini Nano for `from` → `to`: its sessions are created with the pair's languages. */
export function nanoClient(scope: object, from: string, to: string): LLMClient {
  return bindClient(createChromeBuiltinAdapter(scope, nanoLanguages(from, to)), ON_DEVICE, NANO_MODEL);
}

/**
 * The translate client of a Translator route. The job runs the `basic` strategy, which uses the
 * MTClient, never this; a prompt that reaches it anyway (a strategy that needs a language model)
 * fails visibly instead of crashing.
 */
export function translatorRouteClient(): LLMClient {
  return {
    model: CHROME_TRANSLATOR_MODEL,
    reasoningReserveTokens: () => 0,
    async *stream(req) {
      req.signal.throwIfAborted();
      yield { type: 'error', error: { kind: 'bad_request', message: "Chrome Translator can't run prompts" } };
    },
  };
}

/**
 * The turn-on click's create: downloads (when needed) and creates the engine for the pair, so a
 * job can then run on it. Call it synchronously in the click handler, before any `await`: Chrome's
 * Translator consumes the click's activation in `create()`. The Translator goes through `mt` (the
 * panel's client keeps the created translator for its jobs); Nano's session is only made to fetch
 * the model, then closed. `progress` gets 0 to 1. Rejects when Chrome refuses or the download fails.
 */
export function prepareOnDevice(scope: object, mt: MTClient | undefined, engine: OnDeviceEngine, from: string, to: string, opts: { signal?: AbortSignal; progress?: DownloadProgress } = {}): Promise<void> {
  if (engine === 'translator') {
    const prepare = (mt as Partial<ChromeMTClient> | undefined)?.prepare;
    return prepare ? prepare.call(mt, from, to, opts) : Promise.reject(new DOMException('This browser has no built-in translator', 'NotSupportedError'));
  }
  const nano = nanoOf(scope);
  if (nano === undefined) return Promise.reject(new DOMException('This browser has no built-in model', 'NotSupportedError'));
  const { progress, signal } = opts;
  return nano
    .create({
      ...nanoLanguages(from, to),
      ...(signal ? { signal } : {}),
      ...(progress ? { monitor: (m: EventTarget) => m.addEventListener('downloadprogress', (e) => progress((e as ProgressEvent).loaded)) } : {}),
    })
    .then((session) => session.destroy?.());
}
