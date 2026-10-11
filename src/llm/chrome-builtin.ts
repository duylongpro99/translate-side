// `chrome-builtin` protocol adapter for Gemini Nano (Chrome's Prompt API, `LanguageModel`),
// DESIGN.md §4.2.2 and §4.2.6, plan M5-E7. Experimental: createAdapter only hands it out when the
// CHROME_NANO flag is on (client.ts). The model runs on the device, so nothing leaves the browser
// (§8); it has a tiny context and no usage report, which is why it is a degraded mode.
//
// Mapping (§4.2.2): `system` → an `initialPrompts` system entry, the messages → one
// `promptStreaming()` call, chunks → `text` deltas. No caching, no max-tokens param, no usage.

import type { LLMError, ModelInfo, NormalizedEvent, ProbeResult, ProtocolAdapter } from './types.ts';

export const NANO_MODEL = 'gemini-nano';

type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';
interface NanoSession {
  promptStreaming(input: { role: 'user' | 'assistant'; content: string }[], opts?: { signal?: AbortSignal }): AsyncIterable<string> | ReadableStream<string>;
  destroy?(): void;
}
interface NanoStatic {
  availability(opts?: object): Promise<Availability>;
  params?(): Promise<{ defaultTopK: number } | null>;
  create(opts: { initialPrompts?: { role: 'system'; content: string }[]; temperature?: number; topK?: number; signal?: AbortSignal }): Promise<NanoSession>;
}

const nanoOf = (scope: object): NanoStatic | undefined => {
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

export function createChromeBuiltinAdapter(scope: object = globalThis): ProtocolAdapter {
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
        const state = await api.availability();
        req.signal.throwIfAborted();
        if (state !== 'available') {
          yield { type: 'error', error: notHere(state) };
          return;
        }
        // The Prompt API takes a temperature only with a topK.
        const topK = req.temperature === undefined ? undefined : (await api.params?.())?.defaultTopK;
        session = await api.create({
          ...(req.system ? { initialPrompts: [{ role: 'system', content: req.system }] } : {}),
          ...(req.temperature !== undefined && topK !== undefined ? { temperature: req.temperature, topK } : {}),
          signal: req.signal,
        });
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
      return api && (await api.availability().catch(() => 'unavailable')) !== 'unavailable' ? [{ id: NANO_MODEL, displayName: 'Gemini Nano' }] : [];
    },
    async probe(): Promise<ProbeResult> {
      const api = nanoOf(scope);
      if (api === undefined) return { ok: false, error: notHere('missing') };
      const state = await api.availability().catch(() => 'unavailable' as const);
      return state === 'available' ? { ok: true, models: [{ id: NANO_MODEL, displayName: 'Gemini Nano' }] } : { ok: false, error: notHere(state) };
    },
  };
}
