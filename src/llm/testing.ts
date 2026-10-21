// Test doubles for the SDK adapters: a scripted `fetch` that records every request (so a test can
// count HTTP attempts, criterion 7) and SSE bodies in both wire formats.

import type { ResolvedConnection } from './types.ts';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type ScriptedResponse = { status: number; body: string; headers?: Record<string, string> } | { throw: unknown } | { hang: true } | { hangHeaders: true } | { hangAfter: string; swallowAbort?: boolean } | { slow: string[]; gapMs: number };

export interface MockFetch {
  fetch: typeof globalThis.fetch;
  requests: RecordedRequest[];
}

const SSE_HEADERS = { 'content-type': 'text/event-stream' };

function headersOf(init: RequestInit | undefined, input: RequestInfo | URL): Record<string, string> {
  const out: Record<string, string> = {};
  const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  h.forEach((v, k) => (out[k.toLowerCase()] = v));
  return out;
}

/** Plays `responses` in order (the last one repeats). `hang` streams nothing (headers, no body), `hangHeaders` sends no headers, `hangAfter` sends that SSE prefix and then stalls, each until the request's signal aborts. */
export function mockFetch(responses: readonly ScriptedResponse[]): MockFetch {
  const requests: RecordedRequest[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const script = responses[Math.min(requests.length, responses.length - 1)];
    const raw = init?.body;
    let body: unknown = raw;
    if (typeof raw === 'string') {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    requests.push({ url: input instanceof Request ? input.url : String(input), method: init?.method ?? 'GET', headers: headersOf(init, input), body });
    if (script === undefined) throw new Error('mockFetch: no scripted response');
    if ('throw' in script) throw script.throw;
    if ('hangHeaders' in script) {
      // No response headers: the promise settles only when the request's signal aborts.
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        const abort = (): void => reject(signal?.reason ?? new DOMException('aborted', 'AbortError'));
        if (signal?.aborted === true) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      });
    }
    if ('hangAfter' in script) {
      // Headers and `hangAfter` (an SSE prefix), then nothing until the request's signal aborts.
      const signal = init?.signal;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(script.hangAfter));
          // `swallowAbort`: an abort ends the body quietly (a client that swallows it) instead of erroring.
          const abort = (): void => (script.swallowAbort === true ? controller.close() : controller.error(signal?.reason ?? new DOMException('aborted', 'AbortError')));
          if (signal?.aborted === true) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        },
      });
      return new Response(stream, { status: 200, headers: SSE_HEADERS });
    }
    if ('slow' in script) {
      // The chunks of a body, one every `gapMs`: a stream that is slow but alive.
      const signal = init?.signal;
      let i = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          await new Promise((r) => setTimeout(r, script.gapMs));
          if (signal?.aborted === true) return controller.error(signal.reason ?? new DOMException('aborted', 'AbortError'));
          const chunk = script.slow[i++];
          if (chunk === undefined) controller.close();
          else controller.enqueue(new TextEncoder().encode(chunk));
        },
      });
      return new Response(stream, { status: 200, headers: SSE_HEADERS });
    }
    if ('hang' in script) {
      const signal = init?.signal;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const abort = (): void => controller.error(signal?.reason ?? new DOMException('aborted', 'AbortError'));
          if (signal?.aborted === true) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        },
      });
      return new Response(stream, { status: 200, headers: SSE_HEADERS });
    }
    return new Response(script.body, { status: script.status, headers: script.headers ?? { 'content-type': 'application/json' } });
  };
  return { fetch, requests };
}

export function sse(events: readonly { event?: string; data: unknown }[]): string {
  return events.map((e) => `${e.event === undefined ? '' : `event: ${e.event}\n`}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`).join('');
}

export interface AnthropicScript {
  text?: string[];
  thinking?: string[];
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
  stop_reason?: string;
  /** Appended as `event: error` before message_stop. */
  error?: unknown;
  /** Leave out message_delta and message_stop (a dropped connection). */
  cutOff?: boolean;
}

/** An Anthropic Messages SSE stream. */
export function anthropicStream(s: AnthropicScript): string {
  const usage = s.usage ?? { input_tokens: 10, output_tokens: 5 };
  const events: { event: string; data: unknown }[] = [
    {
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'm',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: usage.input_tokens, output_tokens: 1, cache_read_input_tokens: usage.cache_read_input_tokens ?? null, cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null },
        },
      },
    },
  ];
  let index = 0;
  if (s.thinking !== undefined) {
    events.push({ event: 'content_block_start', data: { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } } });
    for (const t of s.thinking) events.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: t } } });
    events.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index } });
    index++;
  }
  events.push({ event: 'content_block_start', data: { type: 'content_block_start', index, content_block: { type: 'text', text: '' } } });
  for (const t of s.text ?? []) events.push({ event: 'content_block_delta', data: { type: 'content_block_delta', index, delta: { type: 'text_delta', text: t } } });
  events.push({ event: 'ping', data: { type: 'ping' } });
  if (s.error !== undefined) events.push({ event: 'error', data: s.error });
  if (s.cutOff !== true) {
    events.push({ event: 'content_block_stop', data: { type: 'content_block_stop', index } });
    events.push({
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason: s.stop_reason ?? 'end_turn', stop_sequence: null },
        usage: { input_tokens: null, output_tokens: usage.output_tokens, cache_read_input_tokens: null, cache_creation_input_tokens: null },
      },
    });
    events.push({ event: 'message_stop', data: { type: 'message_stop' } });
  }
  return sse(events);
}

export interface OpenAIScript {
  text?: string[];
  reasoning?: string[];
  usage?: { prompt_tokens: number; completion_tokens: number; cached_tokens?: number; reasoning_tokens?: number } | null;
  finish_reason?: string;
  /** Sent as a `data: {"error": …}` line before [DONE]. */
  error?: unknown;
  cutOff?: boolean;
}

/** An OpenAI chat completions SSE stream, OpenAI style: a final usage chunk with empty `choices`. */
export function openaiStream(s: OpenAIScript): string {
  const chunk = (delta: Record<string, unknown>, finish: string | null = null): unknown => ({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'm',
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  const events: { data: unknown }[] = [{ data: chunk({ role: 'assistant', content: '' }) }];
  for (const r of s.reasoning ?? []) events.push({ data: chunk({ reasoning: r, content: null }) });
  for (const t of s.text ?? []) events.push({ data: chunk({ content: t }) });
  if (s.error !== undefined) events.push({ data: { error: s.error } });
  if (s.cutOff !== true) {
    events.push({ data: chunk({}, s.finish_reason ?? 'stop') });
    if (s.usage !== null) {
      const u = s.usage ?? { prompt_tokens: 10, completion_tokens: 5 };
      events.push({
        data: {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'm',
          choices: [],
          usage: { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, total_tokens: u.prompt_tokens + u.completion_tokens, ...(u.cached_tokens === undefined ? {} : { prompt_tokens_details: { cached_tokens: u.cached_tokens } }), ...(u.reasoning_tokens === undefined ? {} : { completion_tokens_details: { reasoning_tokens: u.reasoning_tokens } }) },
        },
      });
    }
    events.push({ data: '[DONE]' });
  }
  return sse(events);
}

/** Like Partial, but an explicit `undefined` removes the key (tests write `apiKey: undefined`). */
export type Overrides<T> = { [K in keyof T]?: T[K] | undefined };

export function withOverrides<T extends object>(base: T, over: Overrides<T>): T {
  const kept = Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined));
  const dropped = new Set(Object.keys(over).filter((k) => (over as Record<string, unknown>)[k] === undefined));
  return { ...Object.fromEntries(Object.entries(base).filter(([k]) => !dropped.has(k))), ...kept } as T;
}

export function connection(over: Overrides<ResolvedConnection> = {}): ResolvedConnection {
  return withOverrides<ResolvedConnection>(
    {
      id: 'c1',
      protocol: 'openai-chat',
      baseUrl: 'https://api.example.com/v1',
      auth: { style: 'bearer' },
      apiKey: 'sk-test',
      quirks: {},
      hasHostPermission: async () => true,
    },
    over,
  );
}

// ---- Chrome's built-in AI (Translator, LanguageModel), faked ------------------------------------

type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export interface FakeBuiltinAI {
  /** The scope to hand to the code under test (`Translator`, `LanguageModel`, `LanguageDetector`). */
  scope: Record<string, unknown>;
  /** Every `create()` call: which API, and the pair (Nano: its output language). */
  creates: { api: 'translator' | 'nano'; from: string; to: string }[];
  /** Translator pairs (`from>to`) and Nano output languages, by state; changed by the test at will. */
  pairs: Map<string, Availability>;
  nano: Map<string, Availability>;
  /**
   * The user's activation, as Chrome checks it: a Translator `create()` of a pair that is not
   * `available` throws `NotAllowedError` unless it is set; the create consumes it. A Nano create
   * needs it once (sticky). Tests set it in the "click" and read whether it was still there.
   */
  activation: { transient: boolean; sticky: boolean };
  /** With `hold`: lets the downloads that are waiting finish. */
  finish(): void;
}

/**
 * Chrome's Translator and Prompt API as this extension sees them: `pairs` and `nano` give
 * `availability()`; a create follows Chrome's activation rules, reports download progress (0, then
 * 1) through `monitor`, and makes the pair `available`. Translations are `[to] text`; Nano answers
 * with `nanoAnswer` (default: echoes the prompt).
 */
export function fakeBuiltinAI(init: { pairs?: Record<string, Availability>; nano?: Record<string, Availability>; nanoAnswer?: (prompt: string) => string; detect?: string; translator?: boolean; languageModel?: boolean; hold?: boolean } = {}): FakeBuiltinAI {
  const pairs = new Map(Object.entries(init.pairs ?? {}));
  const nano = new Map(Object.entries(init.nano ?? {}));
  const creates: FakeBuiltinAI['creates'] = [];
  const activation = { transient: false, sticky: false };
  const held: (() => void)[] = [];
  /** The download: 0, then (with `hold`, once `finish()` is called) 0.5 and 1; an abort rejects it. */
  const progress = async (monitor: ((m: EventTarget) => void) | undefined, signal: AbortSignal | undefined) => {
    const target = new EventTarget();
    monitor?.(target);
    const report = (loaded: number) => target.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded, total: 1 }));
    report(0);
    if (init.hold) {
      await new Promise<void>((resolve, reject) => {
        held.push(resolve);
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      report(0.5);
    }
    report(1);
  };
  const nanoKey = (opts: { expectedOutputs?: { languages: string[] }[] } | undefined) => opts?.expectedOutputs?.[0]?.languages[0] ?? 'en';
  const scope: Record<string, unknown> = {};
  if (init.translator !== false) {
    scope.Translator = {
      availability: async ({ sourceLanguage, targetLanguage }: { sourceLanguage: string; targetLanguage: string }) => pairs.get(`${sourceLanguage}>${targetLanguage}`) ?? 'unavailable',
      create: (opts: { sourceLanguage: string; targetLanguage: string; monitor?: (m: EventTarget) => void; signal?: AbortSignal }) => {
        const key = `${opts.sourceLanguage}>${opts.targetLanguage}`;
        creates.push({ api: 'translator', from: opts.sourceLanguage, to: opts.targetLanguage });
        const state = pairs.get(key) ?? 'unavailable';
        if (state === 'unavailable') return Promise.reject(new DOMException('unsupported pair', 'NotSupportedError'));
        if (state !== 'available') {
          if (!activation.transient) return Promise.reject(new DOMException('needs a user gesture', 'NotAllowedError'));
          activation.transient = false;
        }
        return (async () => {
          if (state !== 'available') await progress(opts.monitor, opts.signal);
          pairs.set(key, 'available');
          return { translate: async (text: string) => `[${opts.targetLanguage}] ${text}` };
        })();
      },
    };
  }
  if (init.languageModel !== false) {
    scope.LanguageModel = {
      availability: async (opts?: { expectedOutputs?: { languages: string[] }[] }) => nano.get(nanoKey(opts)) ?? 'unavailable',
      params: async () => ({ defaultTopK: 3 }),
      create: (opts: { expectedInputs?: { languages: string[] }[]; expectedOutputs?: { languages: string[] }[]; monitor?: (m: EventTarget) => void; signal?: AbortSignal }) => {
        const to = nanoKey(opts);
        creates.push({ api: 'nano', from: opts.expectedInputs?.[0]?.languages[0] ?? '', to });
        const state = nano.get(to) ?? 'unavailable';
        if (state === 'unavailable') return Promise.reject(new DOMException('unsupported language', 'NotSupportedError'));
        if (state === 'downloadable' && !activation.sticky && !activation.transient) return Promise.reject(new DOMException('needs a user gesture', 'NotAllowedError'));
        return (async () => {
          if (state !== 'available') await progress(opts.monitor, opts.signal);
          nano.set(to, 'available');
          return {
            promptStreaming: (input: { content: string }[]) =>
              (async function* () {
                const prompt = input.map((m) => m.content).join('\n');
                yield init.nanoAnswer ? init.nanoAnswer(prompt) : prompt;
              })(),
            destroy() {},
          };
        })();
      },
    };
  }
  if (init.detect !== undefined) {
    const detected = init.detect;
    scope.LanguageDetector = { create: async () => ({ detect: async () => [{ detectedLanguage: detected, confidence: 0.9 }] }) };
  }
  return { scope, creates, pairs, nano, activation, finish: () => held.splice(0).forEach((f) => f()) };
}
