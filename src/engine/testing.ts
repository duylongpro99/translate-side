// Test doubles for the engine's ports: a scripted LLMClient and a recording sleep. Plain engine
// code (no timers), usable from engine tests, later stage tests and the Node harness.

import type { LLMClient, LLMError, NormalizedEvent, NormalizedRequest } from '../llm/types.ts';

export interface FakeClient extends LLMClient {
  /** Every request, one entry per `stream()` call (= one attempt: adapters don't retry). */
  readonly requests: NormalizedRequest[];
}

/**
 * A client that plays `attempts[i]` on the i-th `stream()` call (the last one repeats). Like a
 * real adapter it makes exactly one attempt per call and throws `signal.reason` on abort.
 */
export function fakeClient(attempts: readonly (readonly NormalizedEvent[])[], options: { model?: string; reasoningReserveTokens?: number } = {}): FakeClient {
  const requests: NormalizedRequest[] = [];
  return {
    model: options.model ?? 'fake-model',
    reasoningReserveTokens: options.reasoningReserveTokens ?? 0,
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
