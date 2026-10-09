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
// server is not waited out again chunk after chunk. A new job starts on the first link again. The
// last link is never skipped: its errors are the stream's, and each request tries it again (with
// its own backoff), since a rate limit may have passed.
//
// The request a link sends names the link's model, with the thinking reserve of that link in its
// output cap. `servedBy(req)` says which link is answering (its model and its client's `id`), for
// producedBy, usage and the cache key (§7). Each link's usage is passed on while `servedBy` names
// that link, so tokens a failed link spent are counted for its profile, not the next one's.

import type { LLMClient, LLMError, NormalizedEvent, NormalizedRequest, Served } from '../llm/types.ts';
import { isRetryable } from './retry.ts';

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

const servedOf = (link: LLMClient): Served => ({ model: link.model, ...(link.id === undefined ? {} : { id: link.id }) });

/** One client over `links` (each already retrying), first to last. One link: that link, unchanged. */
export function withFallback(links: readonly LLMClient[], options: FallbackOptions = {}): LLMClient {
  const chain = [...new Set(links)];
  const first = chain[0];
  if (first === undefined) throw new Error('a fallback chain needs at least one client');
  if (chain.length === 1) return first;
  const dead = options.dead ?? new Set<LLMClient>();
  const live = chain.filter((_, i) => i < chain.length - 1);
  const last = chain[chain.length - 1] as LLMClient;
  const current = (): LLMClient => live.find((l) => !dead.has(l)) ?? last;
  const served = new WeakMap<NormalizedRequest, Served>();
  return {
    get model() {
      return current().model;
    },
    get id() {
      return current().id;
    },
    reasoningReserveTokens: (req) => current().reasoningReserveTokens(req),
    servedBy: (req) => served.get(req),
    async *stream(req: NormalizedRequest): AsyncGenerator<NormalizedEvent> {
      // The link the request was built for (its reserve is in `maxOutputTokens`): the current one,
      // which the caller just read the model from; else the first with that model.
      const now = current();
      const builtFor = now.model === req.model ? now : (chain.find((l) => l.model === req.model) ?? now);
      for (let i = chain.indexOf(now); i < chain.length; i++) {
        const link = chain[i] as LLMClient;
        const isLast = link === last;
        if (dead.has(link) && !isLast) continue;
        const sent = link === builtFor ? req : { ...req, model: link.model, maxOutputTokens: Math.max(1, req.maxOutputTokens - builtFor.reasoningReserveTokens(req) + link.reasoningReserveTokens(req)) };
        served.set(req, servedOf(link));
        let sawText = false;
        let failure: LLMError | undefined;
        for await (const event of link.stream(sent)) {
          if (event.type === 'error' && !sawText && !isLast && isRetryable(event.error)) {
            failure = event.error;
            break;
          }
          if (event.type === 'text' && event.delta !== '') sawText = true;
          // Usage is passed on as it comes, while `servedBy` still names this link.
          yield event;
          if (event.type === 'done' || event.type === 'error') return;
        }
        // The link's stream ended without a terminal event (a broken adapter).
        if (failure === undefined) return;
        dead.add(link);
        const next = chain.slice(i + 1).find((l) => !dead.has(l) || l === last) ?? last;
        options.onFallback?.({ from: link.model, to: next.model, error: failure });
      }
    },
  };
}

/**
 * The errors that every later request to the same link would hit too: a refused key (`auth`), no
 * allowance (`quota`), no access (`cors`), a missing model (`model_not_found`). §4.3.5 says
 * "stop": once a link answered with one, it is not asked again in this job.
 */
const LATCHING = new Set<LLMError['kind']>(['auth', 'quota', 'cors', 'model_not_found']);

/**
 * `client`, except that once it fails with a latching error (above), every later request fails
 * with that error at once, without being sent (`latched` is the job's, by client). The chain
 * never hands these errors over, so nothing goes to another provider either.
 */
export function withLatch(client: LLMClient, latched: Map<LLMClient, LLMError>): LLMClient {
  return {
    model: client.model,
    ...(client.id === undefined ? {} : { id: client.id }),
    reasoningReserveTokens: (req) => client.reasoningReserveTokens(req),
    async *stream(req: NormalizedRequest): AsyncGenerator<NormalizedEvent> {
      const known = latched.get(client);
      if (known !== undefined) {
        req.signal.throwIfAborted();
        yield { type: 'error', error: known };
        return;
      }
      for await (const event of client.stream(req)) {
        if (event.type === 'error' && LATCHING.has(event.error.kind)) latched.set(client, event.error);
        yield event;
      }
    },
  };
}
