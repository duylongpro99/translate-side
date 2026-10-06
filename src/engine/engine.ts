// TranslationEngine (DESIGN.md §5.2): pure data in, event stream out. Everything it needs from
// the outside comes through EngineDeps ports, so it runs unchanged in the panel, in tests and in
// the Node harness (§5.1).

import type { LLMClient, ModelRole } from '../llm/types.ts';
import { createBudget } from './budget.ts';
import { createWorkingMemory } from './memory.ts';
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
  /** Clock port (ms). */
  now: () => number;
  /** Timer port: resolves after `ms`, rejects with `signal.reason` when it aborts. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  strategies: readonly Strategy[];
  prompts: PromptRegistry;
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
            ctx.memory.translated.set(event.id, { text: event.text, revision: event.revision });
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
  // One retrying client per role, built once: the pipeline is the single retry owner.
  const clients = new Map<ModelRole, LLMClient>();
  const retry = {
    sleep: deps.sleep,
    ...(deps.retry === undefined ? {} : { policy: deps.retry }),
    ...(deps.random === undefined ? {} : { random: deps.random }),
  };
  return {
    llm(role) {
      let client = clients.get(role);
      if (client === undefined) {
        client = withRetry(deps.llm(role), retry);
        clients.set(role, client);
      }
      return client;
    },
    memory: createWorkingMemory(job.options.glossary),
    context: [...(deps.context ?? [])],
    prompts: deps.prompts,
    budget: createBudget(job.options.budget ?? {}, deps.now),
    signal,
  };
}
