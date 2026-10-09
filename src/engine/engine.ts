// TranslationEngine (DESIGN.md §5.2): pure data in, event stream out. Everything it needs from
// the outside comes through EngineDeps ports, so it runs unchanged in the panel, in tests and in
// the Node harness (§5.1).

import type { LLMClient, LLMError, ModelRole } from '../llm/types.ts';
import { createBudget } from './budget.ts';
import { DEFAULT_CONTEXT_PROVIDERS } from './context/budget.ts';
import { createWorkingMemory } from './memory.ts';
import { withFallback, withLatch, type FallbackInfo } from './fallback.ts';
import { withRetry, type RetryPolicy } from './retry.ts';
import type {
  ContextProvider,
  EngineEvent,
  PromptRegistry,
  SnippetRequest,
  StageContext,
  Strategy,
  TranslationEngine,
  TranslationJob,
} from './types.ts';

export interface EngineDeps {
  /** Routing port: the shell maps a role to a model profile and returns its client (§4.3.1). */
  llm: (role: ModelRole) => LLMClient;
  /**
   * The role's fallback clients, in order (§4.3.5, `Routing.fallback`): tried when `llm(role)` gives
   * up on a rate limit, an overloaded provider or the network (fallback.ts). The shell has already
   * applied the privacy rule. Absent or empty: no fallback. Pass the same client object for a
   * profile every role uses, so a link that gave up is skipped by every role.
   */
  fallback?: (role: ModelRole) => readonly LLMClient[];
  /** A link of a role's chain handed a request over to the next one (fallback.ts). */
  onFallback?: (info: FallbackInfo & { role: ModelRole }) => void;
  /** Clock port (ms). */
  now: () => number;
  /** Timer port: resolves after `ms`, rejects with `signal.reason` when it aborts. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  strategies: readonly Strategy[];
  prompts: PromptRegistry;
  /** Context providers (§5.4) for prompts that use them (translate@2). Default: the v1 three (context/budget.ts). */
  context?: readonly ContextProvider[];
  retry?: RetryPolicy;
  /** For backoff jitter; deterministic in tests. */
  random?: () => number;
}

/** Shown for segments left untranslated when a strategy fails unexpectedly. */
export const DEGRADED_MESSAGE = 'Translation stopped because of an internal error';

export function createEngine(deps: EngineDeps): TranslationEngine {
  const strategies = new Map(deps.strategies.map((s) => [s.id, s]));

  async function* translate(job: TranslationJob, signal: AbortSignal): AsyncGenerator<EngineEvent> {
    const strategy = strategies.get(job.strategy);
    if (strategy === undefined) throw new Error(`unknown strategy ${job.strategy}`);
    const ctx = createStageContext(deps, job, signal);
    const failed = new Set<string>();
    try {
      for await (const event of strategy.run(job, ctx)) {
        if (event.type === 'usage') ctx.budget.record(event);
        else if (event.type === 'segment.final') {
          const known = ctx.memory.translated.get(event.id);
          if (known === undefined || event.revision >= known.revision) {
            ctx.memory.translated.set(event.id, { text: event.text, revision: event.revision, ...(event.attempt === undefined ? {} : { attempt: event.attempt }) });
          }
          failed.delete(event.id);
        } else if (event.type === 'segment.failed') failed.add(event.id);
        // `done` belongs to the engine: it is sent once, after everything else.
        if (event.type !== 'done') yield event;
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      // Graceful degradation (§5.6): segments with a good revision keep it (the panel already
      // shows it); the rest fail individually instead of the job failing.
      // The exception may be an internal bug text, so the user sees a generic message; the
      // original stays in `raw`.
      for (const segment of job.doc.segments) {
        if (segment.translate && !ctx.memory.translated.has(segment.id) && !failed.has(segment.id)) {
          yield { type: 'segment.failed', id: segment.id, error: { kind: 'unknown', message: DEGRADED_MESSAGE, raw: error } };
        }
      }
    }
    yield { type: 'done' };
  }

  return {
    translate,
    translateSnippet(req: SnippetRequest, signal: AbortSignal) {
      const job: TranslationJob = {
        doc: { ...req.doc, segments: req.segments },
        priority: [],
        strategy: req.strategy ?? 'single-pass',
        options: req.options,
      };
      return translate(job, signal);
    },
  };
}

function createStageContext(deps: EngineDeps, job: TranslationJob, signal: AbortSignal): StageContext {
  // One client per role, built once: each link retrying on its own (the pipeline is the single
  // retry owner), then the role's fallback chain over them (fallback.ts). A client shared by two
  // roles gets one retrying wrapper, so a link that gave up is skipped by both (`dead`).
  const clients = new Map<ModelRole, LLMClient>();
  const retrying = new Map<LLMClient, LLMClient>();
  const dead = new Set<LLMClient>();
  // A link refused for its key, allowance, access or model is not asked again in this job (withLatch).
  const latched = new Map<LLMClient, LLMError>();
  const retry = {
    sleep: deps.sleep,
    ...(deps.retry === undefined ? {} : { policy: deps.retry }),
    ...(deps.random === undefined ? {} : { random: deps.random }),
  };
  const retried = (raw: LLMClient): LLMClient => {
    let client = retrying.get(raw);
    if (client === undefined) {
      // A request still backing off on a link the chain has given up on stops waiting.
      const own: LLMClient = withRetry(withLatch(raw, latched), { ...retry, abandon: () => dead.has(own) });
      client = own;
      retrying.set(raw, client);
    }
    return client;
  };
  return {
    llm(role) {
      let client = clients.get(role);
      if (client === undefined) {
        const links = [deps.llm(role), ...(deps.fallback?.(role) ?? [])].map(retried);
        const onFallback = deps.onFallback;
        client = withFallback(links, { dead, ...(onFallback === undefined ? {} : { onFallback: (info: FallbackInfo) => onFallback({ ...info, role }) }) });
        clients.set(role, client);
      }
      return client;
    },
    memory: { ...createWorkingMemory(job.options.glossary), ...(job.options.brief ? { brief: job.options.brief } : {}) },
    context: [...(deps.context ?? DEFAULT_CONTEXT_PROVIDERS)],
    prompts: deps.prompts,
    budget: createBudget(job.options.budget ?? {}, deps.now),
    signal,
    priority: job.livePriority ?? (() => job.priority),
  };
}
