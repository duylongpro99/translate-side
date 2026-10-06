// Retry and backoff (DESIGN.md §4.3.5, plan M1 §5 "Retry owner"). The pipeline is the ONLY
// retry owner: adapters run their SDKs with `maxRetries: 0` and yield one classified error
// (src/llm/types.ts). The engine wraps each role's client once (engine.ts), and wrapping is
// idempotent, so retries can't stack.

import type { LLMClient, LLMError, NormalizedEvent, NormalizedRequest } from '../llm/types.ts';

export interface RetryPolicy {
  /** Retries after the first attempt. */
  maxRetries: number;
  /** Backoff for the first retry when the server gives no Retry-After; doubles each retry. */
  baseDelayMs: number;
  maxDelayMs: number;
  /** A longer Retry-After isn't waited for: the error goes to the caller (fallback). */
  maxRetryAfterMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  maxRetryAfterMs: 60_000,
});

/**
 * What to do about an error. `retry` is handled here; the others are for the caller once the
 * error reaches it: `fallback` (next fallback profile, later milestones), `shrink` (smaller
 * chunkTokens, §4.3.5), `stop` (show the error; no silent fallback for auth/quota/cors).
 */
export type RetryDecision = { action: 'retry'; delayMs: number } | { action: 'stop' | 'fallback' | 'shrink' };

/** §4.3.5: 429 (honor Retry-After), 5xx and network errors back off and retry. */
const RETRYABLE = new Set<LLMError['kind']>(['rate_limit', 'overloaded', 'network']);

export function decideRetry(error: LLMError, retriesSoFar: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY, random: () => number = Math.random): RetryDecision {
  if (error.kind === 'context_length') return { action: 'shrink' };
  if (!RETRYABLE.has(error.kind)) return { action: 'stop' };
  if (retriesSoFar >= policy.maxRetries) return { action: 'fallback' };
  if (error.retryAfterMs !== undefined) {
    if (error.retryAfterMs > policy.maxRetryAfterMs) return { action: 'fallback' };
    return { action: 'retry', delayMs: error.retryAfterMs };
  }
  // Exponential, with "equal jitter" so parallel chunks don't retry in lockstep.
  const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** retriesSoFar);
  return { action: 'retry', delayMs: Math.round(ceiling / 2 + random() * (ceiling / 2)) };
}

export interface RetryInfo {
  error: LLMError;
  /** 1 for the first retry. */
  retry: number;
  delayMs: number;
}

export interface RetryOptions {
  /** Timer port (engine/ has no timers): resolves after `ms`, rejects with `signal.reason` on abort. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  policy?: RetryPolicy;
  random?: () => number;
  onRetry?: (info: RetryInfo) => void;
}

const retrying = new WeakSet<LLMClient>();

/**
 * A client that retries `client` per the policy. Only an error that arrives before any text is
 * retried, because text already shown can't be taken back: a later error goes to the caller
 * (the `<seg>` repair path). Usage events of failed attempts are passed on (they may be billed).
 * Wrapping a client that already retries returns it unchanged.
 */
export function withRetry(client: LLMClient, options: RetryOptions): LLMClient {
  if (retrying.has(client)) return client;
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const random = options.random ?? Math.random;
  const wrapped: LLMClient = {
    model: client.model,
    reasoningReserveTokens: client.reasoningReserveTokens,
    async *stream(req: NormalizedRequest): AsyncGenerator<NormalizedEvent> {
      for (let retries = 0; ; retries++) {
        req.signal.throwIfAborted();
        let failure: LLMError | undefined;
        let sawText = false;
        for await (const event of client.stream(req)) {
          if (event.type === 'error' && !sawText) {
            failure = event.error;
            break;
          }
          if (event.type === 'text' && event.delta !== '') sawText = true;
          yield event;
        }
        if (failure === undefined) return;
        const decision = decideRetry(failure, retries, policy, random);
        if (decision.action !== 'retry') {
          yield { type: 'error', error: failure };
          return;
        }
        options.onRetry?.({ error: failure, retry: retries + 1, delayMs: decision.delayMs });
        await options.sleep(decision.delayMs, req.signal);
      }
    },
  };
  retrying.add(wrapped);
  return wrapped;
}
