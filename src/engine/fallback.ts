// The fallback chain (DESIGN.md §4.3.5, plan M4-E9 and §5 "Retry vs fallback ownership"). The
// shell hands the engine a role's client and, in order, the clients of its fallback profiles
// (`Routing.fallback`, already filtered: the privacy rule, links that can't run). Each link is
// wrapped in the pipeline's retry (retry.ts) on its own, so the chain is:
//
//   link 1: attempt, backoff, … (rate_limit / overloaded / network) → gives up → link 2: …
//
// A link hands over only on an error the pipeline backs off on (`isRetryable`) that arrived
// before any text: `auth`, `quota`, `cors`, `model_not_found`, `bad_request` and `context_length`
// stop at the link that hit them (a bad key must never send the page to another provider). Text
// already shown can't be taken back, so an error after text goes to the caller (the repair path).
//
// The switch is sticky for the job: a link that gave up is skipped by every later request of
// every role (the set of given-up links is the job's, shared through `dead`), so a stopped local
// server is not waited out again chunk after chunk. A new job starts on the first link again.
// When every link has given up, a request goes to the last one again (a rate limit may have
// passed), with its own backoff.
//
// The request a link sends names the link's model, with the thinking reserve of that link in its
// output cap; `servedBy(req)` says which model answered (producedBy, usage, the cache key, §7).
// The usage of the links that failed (rarely any: they failed before text) is summed into the one
// `usage` event of the stream (the contract, src/llm/types.ts), counted for the model that answered.

import type { LLMClient, LLMError, NormalizedEvent, NormalizedRequest } from '../llm/types.ts';
import { addUsage, isRetryable, type Usage } from './retry.ts';

/** A link handing a request over to the next one. */
export interface FallbackInfo {
  from: string;
  to: string;
  error: LLMError;
}

export interface FallbackOptions {
  /** The links that gave up in this job (shared by every role's chain). Default: this chain's own. */
  dead?: Set<LLMClient>;
  onFallback?: (info: FallbackInfo) => void;
}

/** One client over `links` (each already retrying), first to last. One link: that link, unchanged. */
export function withFallback(links: readonly LLMClient[], options: FallbackOptions = {}): LLMClient {
  const chain = [...new Set(links)];
  const first = chain[0];
  if (first === undefined) throw new Error('a fallback chain needs at least one client');
  if (chain.length === 1) return first;
  const last = chain[chain.length - 1] as LLMClient;
  const dead = options.dead ?? new Set<LLMClient>();
  const current = (): LLMClient => chain.find((l) => !dead.has(l)) ?? last;
  const served = new WeakMap<NormalizedRequest, string>();
  return {
    get model() {
      return current().model;
    },
    reasoningReserveTokens: (req) => current().reasoningReserveTokens(req),
    servedBy: (req) => served.get(req),
    async *stream(req: NormalizedRequest): AsyncGenerator<NormalizedEvent> {
      // The link the request was built for: its reserve is in `maxOutputTokens`.
      const builtFor = chain.find((l) => l.model === req.model) ?? current();
      let usage: Usage | undefined;
      const start = chain.every((l) => dead.has(l)) ? chain.length - 1 : 0;
      for (let i = start; i < chain.length; i++) {
        const link = chain[i] as LLMClient;
        const isLast = i === chain.length - 1;
        if (dead.has(link) && !isLast) continue;
        const sent = link === builtFor ? req : { ...req, model: link.model, maxOutputTokens: Math.max(1, req.maxOutputTokens - builtFor.reasoningReserveTokens(req) + link.reasoningReserveTokens(req)) };
        served.set(req, link.model);
        let sawText = false;
        let failure: LLMError | undefined;
        for await (const event of link.stream(sent)) {
          if (event.type === 'usage') {
            usage = addUsage(usage, event);
            continue;
          }
          if (event.type === 'error' && !sawText && !isLast && isRetryable(event.error)) {
            failure = event.error;
            break;
          }
          if (event.type === 'text') {
            if (event.delta !== '') sawText = true;
            yield event;
            continue;
          }
          if (usage !== undefined) yield usage;
          yield event;
          return;
        }
        if (failure === undefined) {
          // The link's stream ended without a terminal event (a broken adapter): keep the usage.
          if (usage !== undefined) yield usage;
          return;
        }
        dead.add(link);
        const next = chain.slice(i + 1).find((l) => !dead.has(l) || l === last) ?? last;
        options.onFallback?.({ from: link.model, to: next.model, error: failure });
      }
    },
  };
}
