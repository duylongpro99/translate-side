// Retry and backoff (DESIGN.md §4.3.5, plan M1 §5 "Retry owner"). The pipeline is the ONLY
// retry owner: adapters run their SDKs with `maxRetries: 0` and yield one classified error
// (src/llm/types.ts; their only resend is the §4.2.4 quirk flip on a 400, never a rate limit).
// The engine wraps each role's client once (engine.ts), and wrapping is idempotent, so retries
// can't stack.

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

type Usage = Extract<NormalizedEvent, { type: 'usage' }>;

function addUsage(sum: Usage | undefined, next: Usage): Usage {
  if (sum === undefined) return next;
  const cached = sum.cachedInput === undefined && next.cachedInput === undefined ? {} : { cachedInput: (sum.cachedInput ?? 0) + (next.cachedInput ?? 0) };
  return { type: 'usage', input: sum.input + next.input, output: sum.output + next.output, ...cached };
}

const retrying = new WeakSet<LLMClient>();

/**
 * A client that retries `client` per the policy. Only an error that arrives before any text is
 * retried, because text already shown can't be taken back: a later error goes to the caller
 * (the `<seg>` repair path). It keeps the stream contract (src/llm/types.ts): the `usage` of every
 * attempt (failed ones may be billed) is summed into at most one `usage` event, sent just before
 * the terminal event. Wrapping a client that already retries returns it unchanged.
 */
export function withRetry(client: LLMClient, options: RetryOptions): LLMClient {
  if (retrying.has(client)) return client;
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const random = options.random ?? Math.random;
  const wrapped: LLMClient = {
    model: client.model,
    reasoningReserveTokens: client.reasoningReserveTokens,
    async *stream(req: NormalizedRequest): AsyncGenerator<NormalizedEvent> {
      let usage: Usage | undefined;
      for (let retries = 0; ; retries++) {
        req.signal.throwIfAborted();
        let failure: LLMError | undefined;
        let sawText = false;
        for await (const event of client.stream(req)) {
          if (event.type === 'usage') {
            usage = addUsage(usage, event);
            continue;
          }
          if (event.type === 'error' && !sawText) {
            failure = event.error;
            break;
          }
          if (event.type === 'text') {
            if (event.delta !== '') sawText = true;
            yield event;
            continue;
          }
          // Terminal: done, or an error after text.
          if (usage !== undefined) yield usage;
          yield event;
          return;
        }
        if (failure === undefined) {
          // The inner stream ended without a terminal event (a broken adapter): keep the usage.
          if (usage !== undefined) yield usage;
          return;
        }
        const decision = decideRetry(failure, retries, policy, random);
        if (decision.action !== 'retry') {
          if (usage !== undefined) yield usage;
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
