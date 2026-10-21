// `chrome-builtin` protocol adapter for Gemini Nano (Chrome's Prompt API, `LanguageModel`),
// DESIGN.md §4.2.2 and §4.2.6. The model runs on the device, so nothing leaves the browser (§8); it
// has a tiny context and no usage report, which is why it is a degraded mode. The on-device route
// (src/llm/on-device.ts) runs it when no provider can.
//
// Mapping (§4.2.2): `system` → an `initialPrompts` system entry, the messages → one
// `promptStreaming()` call, chunks → `text` deltas. No caching, no max-tokens param, no usage.
// A session is created only when `availability()` says `available`: a model still to download
// is downloaded from the panel's turn-on click (on-device.ts `prepareOnDevice`), never from a job.

import type { LLMError, ModelInfo, NormalizedEvent, ProbeResult, ProtocolAdapter } from './types.ts';

export const NANO_MODEL = 'gemini-nano';

type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';
type NanoMessage = { role: 'user' | 'assistant'; content: string };
interface NanoSession {
  promptStreaming(input: NanoMessage[], opts?: { signal?: AbortSignal }): AsyncIterable<string> | ReadableStream<string>;
  /** The context size and what is used of it; `inputQuota` / `inputUsage` / `measureInputUsage` before the rename. */
  contextWindow?: number;
  contextUsage?: number;
  measureContextUsage?(input: NanoMessage[]): Promise<number>;
  inputQuota?: number;
  inputUsage?: number;
  measureInputUsage?(input: NanoMessage[]): Promise<number>;
  destroy?(): void;
}
/** What the text in and out is written in: the Prompt API answers `unavailable` for a language it can't write. */
export interface NanoLanguages {
  expectedInputs?: { type: 'text'; languages: string[] }[];
  expectedOutputs?: { type: 'text'; languages: string[] }[];
}
export interface NanoStatic {
  availability(opts?: NanoLanguages): Promise<Availability>;
  params?(): Promise<{ defaultTopK: number } | null>;
  create(opts: NanoLanguages & { initialPrompts?: { role: 'system'; content: string }[]; temperature?: number; topK?: number; signal?: AbortSignal; monitor?: (m: EventTarget) => void }): Promise<NanoSession>;
}

const base = (code: string) => code.split('-')[0]?.toLowerCase() ?? code;

/**
 * The languages Gemini Nano reads and writes (Chrome's own list; `de` and `fr` from Chrome 149, where
 * `availability()` says so). Asked about any other, Chrome answers `unavailable` and logs a console
 * error, so such a pair is never asked about.
 */
export const NANO_LANGUAGES: readonly string[] = ['en', 'es', 'ja', 'de', 'fr'];

/** Can Nano take text in `from` ('' = not named) and write `to`, as far as its language list goes? */
export const nanoCanTry = (from: string, to: string): boolean => (from === '' || NANO_LANGUAGES.includes(base(from))) && NANO_LANGUAGES.includes(base(to));

/** The Prompt API's language options for text from `from` into `to` (base codes: `en-US` is `en`); `from` '' names none. */
export function nanoLanguages(from: string, to: string): NanoLanguages {
  return {
    ...(from === '' ? {} : { expectedInputs: [{ type: 'text', languages: [base(from)] }] }),
    expectedOutputs: [{ type: 'text', languages: [base(to)] }],
  };
}

export const nanoOf = (scope: object): NanoStatic | undefined => {
  const api = (scope as { LanguageModel?: NanoStatic }).LanguageModel;
  return api !== undefined && typeof api.create === 'function' && typeof api.availability === 'function' ? api : undefined;
};

const notHere = (state: Availability | 'missing'): LLMError => ({
  kind: 'model_not_found',
  message: state === 'missing' ? "This browser has no built-in model (Chrome's Prompt API)." : state === 'unavailable' ? 'Gemini Nano is not available on this device.' : 'Gemini Nano is not downloaded yet on this device.',
});

/** A DOMException from the Prompt API, by name. */
export function classifyNanoError(error: unknown): LLMError {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'QuotaExceededError') return { kind: 'context_length', message: `The text is too long for Gemini Nano (${message})`, raw: error };
  if (name === 'NotSupportedError' || name === 'NotAllowedError') return { kind: 'model_not_found', message: `Gemini Nano can't run here (${message})`, raw: error };
  return { kind: 'unknown', message: `Gemini Nano failed (${message})`, raw: error };
}

async function* chunksOf(stream: AsyncIterable<string> | ReadableStream<string>): AsyncGenerator<string> {
  if (Symbol.asyncIterator in stream) {
    yield* stream as AsyncIterable<string>;
    return;
  }
  const reader = (stream as ReadableStream<string>).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Room left in the session for `input`, when the session can measure it; undefined when it can't. */
async function overflows(session: NanoSession, input: NanoMessage[]): Promise<{ requested: number; window: number } | undefined> {
  const window = session.contextWindow ?? session.inputQuota;
  const measure = session.measureContextUsage ?? session.measureInputUsage;
  if (window === undefined || measure === undefined) return undefined;
  const requested = await measure.call(session, input);
  const used = session.contextUsage ?? session.inputUsage ?? 0;
  return used + requested > window ? { requested, window: window - used } : undefined;
}

/**
 * The adapter over `scope`'s `LanguageModel`. `languages` (the job's pair) go with every
 * availability check and session; without them Chrome warns and assumes English.
 */
export function createChromeBuiltinAdapter(scope: object = globalThis, languages: NanoLanguages = {}): ProtocolAdapter {
  return {
    protocol: 'chrome-builtin',
    async *stream(_conn, req): AsyncGenerator<NormalizedEvent> {
      const api = nanoOf(scope);
      if (api === undefined) {
        yield { type: 'error', error: notHere('missing') };
        return;
      }
      let session: NanoSession | undefined;
      try {
        const state = await api.availability(languages);
        req.signal.throwIfAborted();
        if (state !== 'available') {
          yield { type: 'error', error: notHere(state) };
          return;
        }
        // The Prompt API takes a temperature only with a topK.
        const topK = req.temperature === undefined ? undefined : (await api.params?.())?.defaultTopK;
        session = await api.create({
          ...languages,
          ...(req.system ? { initialPrompts: [{ role: 'system', content: req.system }] } : {}),
          ...(req.temperature !== undefined && topK !== undefined ? { temperature: req.temperature, topK } : {}),
          signal: req.signal,
        });
        // Checked before sending: a chunk too long for the session is a `context_length` answer at
        // once, which the on-device route hands to Chrome's Translator (engine `onDeviceSwitch`).
        const over = await overflows(session, req.messages);
        req.signal.throwIfAborted();
        if (over) {
          yield { type: 'error', error: { kind: 'context_length', message: `The text is too long for Gemini Nano (${over.requested} tokens, ${over.window} left)` } };
          return;
        }
        for await (const delta of chunksOf(session.promptStreaming(req.messages, { signal: req.signal }))) {
          if (delta !== '') yield { type: 'text', delta };
        }
        yield { type: 'done', stopReason: 'end' };
      } catch (error) {
        req.signal.throwIfAborted();
        yield { type: 'error', error: classifyNanoError(error) };
      } finally {
        session?.destroy?.();
      }
    },
    async listModels(): Promise<ModelInfo[]> {
      const api = nanoOf(scope);
      return api && (await api.availability(languages).catch(() => 'unavailable')) !== 'unavailable' ? [{ id: NANO_MODEL, displayName: 'Gemini Nano' }] : [];
    },
    async probe(): Promise<ProbeResult> {
      const api = nanoOf(scope);
      if (api === undefined) return { ok: false, error: notHere('missing') };
      const state = await api.availability(languages).catch(() => 'unavailable' as const);
      return state === 'available' ? { ok: true, models: [{ id: NANO_MODEL, displayName: 'Gemini Nano' }] } : { ok: false, error: notHere(state) };
    },
  };
}
