// Test doubles for the engine's ports: a scripted LLMClient and a recording sleep. Plain engine
// code (no timers), usable from engine tests, later stage tests and the Node harness.

import type { LLMClient, LLMError, NormalizedEvent, NormalizedRequest, StopReason } from '../llm/types.ts';

/** A fixed reserve for every request, or a per-request one (a per-chunk thinking policy). */
function reserveOf(reserve: number | LLMClient['reasoningReserveTokens'] | undefined): LLMClient['reasoningReserveTokens'] {
  return typeof reserve === 'function' ? reserve : () => reserve ?? 0;
}

export interface FakeClient extends LLMClient {
  /** Every request, one entry per `stream()` call (= one attempt: adapters don't retry; this fake never quirk-flips). */
  readonly requests: NormalizedRequest[];
}

/**
 * A client that plays `attempts[i]` on the i-th `stream()` call (the last one repeats). Like a
 * real adapter it makes exactly one attempt per call and throws `signal.reason` on abort.
 */
export function fakeClient(attempts: readonly (readonly NormalizedEvent[])[], options: { model?: string; reasoningReserveTokens?: number | LLMClient['reasoningReserveTokens'] } = {}): FakeClient {
  const requests: NormalizedRequest[] = [];
  return {
    model: options.model ?? 'fake-model',
    reasoningReserveTokens: reserveOf(options.reasoningReserveTokens),
    requests,
    async *stream(req) {
      const script = attempts[Math.min(requests.length, attempts.length - 1)] ?? [];
      requests.push(req);
      for (const event of script) {
        await Promise.resolve();
        req.signal.throwIfAborted();
        yield event;
      }
    },
  };
}

export const rateLimited = (retryAfterMs?: number): NormalizedEvent => ({
  type: 'error',
  error: { kind: 'rate_limit', status: 429, message: 'too many concurrent requests', ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
});

export const failed = (error: LLMError): NormalizedEvent => ({ type: 'error', error });

export const success = (text: string): NormalizedEvent[] => [
  { type: 'text', delta: text },
  { type: 'usage', input: 10, output: 5 },
  { type: 'done', stopReason: 'end' },
];

/** A sleep port that records each delay and resolves at once (rejects if the signal aborted). */
export function fakeSleep(): ((ms: number, signal: AbortSignal) => Promise<void>) & { delays: number[] } {
  const delays: number[] = [];
  const sleep = async (ms: number, signal: AbortSignal): Promise<void> => {
    delays.push(ms);
    await Promise.resolve();
    signal.throwIfAborted();
  };
  return Object.assign(sleep, { delays });
}

// ---- A scripted translator: answers the `<seg>` lines of the user message -----------------------

/** One `<seg>` line of a request, as the fake reads it back. */
export interface WireLine {
  n: number;
  nonce?: string;
  source: string;
}

/** The fake's answer for one call: the output text, or the text plus how the stream ends. */
export type TranslatorAnswer = string | { text: string; stopReason?: StopReason; usage?: { input: number; output: number; cachedInput?: number } | null };

/** Parses the user message of a translate request (the `formatWire` shape, one segment per line). */
export function wireLines(content: string): WireLine[] {
  const out: WireLine[] = [];
  for (const line of content.split('\n')) {
    const m = /^<seg id="(\d+)"(?: n="([a-z0-9]{4})")?>([\s\S]*)<\/seg>$/.exec(line);
    if (m === null) continue;
    out.push({ n: Number(m[1]), ...(m[2] === undefined ? {} : { nonce: m[2] }), source: m[3] ?? '' });
  }
  return out;
}

/** Renders `<seg>` lines back, echoing each line's nonce, with `translate(source, n)` as the text. */
export function renderLines(lines: readonly WireLine[], translate: (source: string, n: number) => string): string {
  return lines.map((l) => `<seg id="${l.n}"${l.nonce === undefined ? '' : ` n="${l.nonce}"`}>${translate(l.source, l.n)}</seg>`).join('\n');
}

/** The default answer: every segment becomes `vi:<source>`, nonces echoed. */
export const echoTranslator = (lines: readonly WireLine[]): string => renderLines(lines, (s) => `vi:${s}`);

/**
 * A client that answers each request's `<seg>` lines through `answer(lines, call)` (call = 1 for
 * the first `stream()`), streamed in small deltas, with a usage event and `done`. Like
 * `fakeClient` it makes exactly one attempt per call and throws `signal.reason` on abort.
 */
export function translatorClient(
  answer: (lines: WireLine[], call: number, req: NormalizedRequest) => TranslatorAnswer = echoTranslator,
  options: { model?: string; reasoningReserveTokens?: number | LLMClient['reasoningReserveTokens']; deltaSize?: number } = {},
): FakeClient {
  const requests: NormalizedRequest[] = [];
  const deltaSize = options.deltaSize ?? 7;
  return {
    model: options.model ?? 'fake-model',
    reasoningReserveTokens: reserveOf(options.reasoningReserveTokens),
    requests,
    async *stream(req) {
      requests.push(req);
      const lines = wireLines(req.messages.find((m) => m.role === 'user')?.content ?? '');
      const a = answer(lines, requests.length, req);
      const { text, stopReason = 'end', usage = { input: 10 * Math.max(1, lines.length), output: 5 * Math.max(1, lines.length) } } = typeof a === 'string' ? { text: a } : a;
      for (let i = 0; i < text.length; i += deltaSize) {
        await Promise.resolve();
        req.signal.throwIfAborted();
        yield { type: 'text', delta: text.slice(i, i + deltaSize) };
      }
      await Promise.resolve();
      req.signal.throwIfAborted();
      if (usage !== null) yield { type: 'usage', ...usage };
      yield { type: 'done', stopReason };
    },
  };
}
