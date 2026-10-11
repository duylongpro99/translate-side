// TranslationEngine (DESIGN.md §5.2): pure data in, event stream out. Everything it needs from
// the outside comes through EngineDeps ports, so it runs unchanged in the panel, in tests and in
// the Node harness (§5.1).

import type { LLMClient, LLMError, MTClient, ModelRole, NormalizedEvent, NormalizedRequest } from '../llm/types.ts';
import { createBudget } from './budget.ts';
import { DEFAULT_CONTEXT_PROVIDERS } from './context/budget.ts';
import { createWorkingMemory } from './memory.ts';
import { withFallback, withLatch, type FallbackInfo } from './fallback.ts';
import { isRetryable, withRetry, type RetryPolicy } from './retry.ts';
import { BASIC_ID, basicTranslate } from './strategies/basic.ts';
import type {
  ContextProvider,
  EngineEvent,
  PromptRegistry,
  Segment,
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
  /**
   * The machine translator of the `basic` strategy (Chrome's Translator, plan M5-E7): the last
   * fallback of a job with `options.basicFallback`. Absent: none on this device.
   */
  mt?: MTClient;
}

/**
 * The `stage` events of the switch to the `basic` strategy (plan M5-E7), `info` = `BasicSwitchInfo`:
 * `start` when every provider gave up, before the first block the switch takes over; `done` when
 * it ends, because a provider answered again (`recovered`) or the job ended. A job can switch
 * again after a recovery (another start/done pair).
 */
export const BASIC_SWITCH_STAGE = 'basic-fallback';

export interface BasicSwitchInfo {
  /** The model that gave up last. */
  from: string;
  /** The translator that takes over (`MTClient.model`), absent when there is none. */
  to?: string;
  error: LLMError;
  /** On `done`: a provider answered again, so the blocks after it are the model's again. */
  recovered?: true;
}

/** Shown for segments left untranslated when a strategy fails unexpectedly. */
export const DEGRADED_MESSAGE = 'Translation stopped because of an internal error';

export function createEngine(deps: EngineDeps): TranslationEngine {
  const strategies = new Map(deps.strategies.map((s) => [s.id, s]));

  async function* translate(job: TranslationJob, signal: AbortSignal): AsyncGenerator<EngineEvent> {
    const strategy = strategies.get(job.strategy);
    if (strategy === undefined) throw new Error(`unknown strategy ${job.strategy}`);
    const toBasic = job.options.basicFallback === true && strategy.id !== BASIC_ID ? createSwitch() : undefined;
    const ctx = createStageContext(deps, job, signal, toBasic);
    const failed = new Set<string>();
    try {
      const events = toBasic ? withBasicSwitch(strategy.run(job, ctx), toBasic, job, ctx) : strategy.run(job, ctx);
      for await (const event of events) {
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

// ---- The terminal `basic` entry (plan M5-E7, §4.3.5) ------------------------------------------
// The chain's profiles hand a request on until the last one gives up (fallback.ts); with
// `options.basicFallback` the engine then switches the job to the `basic` strategy:
// - A block that failed on an error the pipeline backs off on (`isRetryable`: rate limit,
//   overload, network) and has no good revision is not reported failed: the switch takes it over.
// - From then on every role's client answers at once with that error, without sending anything,
//   so the chunks not started yet come straight to the switch instead of backing off again on
//   providers that are down. Chunks already streaming finish (their text is not taken back).
// - Except one request at a time, the probe: it goes to the chain once (its last link is always
//   tried again, fallback.ts), without backing off. When it gets text or ends well, the provider
//   is back: the switch ends and later requests go to the providers again (a job switches again
//   if they fail again). One chunk that ran out of retries does not hand a long page to basic.
// - The blocks taken over are translated by `basicTranslate` as they arrive, alongside the
//   strategy, and marked by `producedBy.strategy` = `basic`. A device without a translator for the
//   pair answers each block with why (never a silent failure).
// `auth`, `quota`, `cors` and the other stop errors never switch: they stop at the link that hit
// them (§4.3.5), as they never fall back to another provider either.

interface BasicSwitch {
  /** While switched: the error the last provider gave up on. */
  error?: LLMError;
  /** A request is trying the providers again (see above). */
  probing?: boolean;
  /** The switch's `start` was sent and its `done` not yet. */
  announced?: BasicSwitchInfo;
}

const createSwitch = (): BasicSwitch => ({});

async function* withBasicSwitch(events: AsyncIterable<EngineEvent>, state: BasicSwitch, job: TranslationJob, ctx: StageContext): AsyncGenerator<EngineEvent> {
  // Each block with the provider error it was taken over on: a probe may end the switch (and
  // clear `state.error`) before the worker gets to it, and that error stays the block's cause.
  const queue: { segment: Segment; cause: LLMError }[] = [];
  const byId = new Map(job.doc.segments.map((s) => [s.id, s]));
  let wake: (() => void) | undefined;
  let strategyDone = false;
  const poke = () => {
    wake?.();
    wake = undefined;
  };
  async function* worker(): AsyncGenerator<EngineEvent> {
    for (;;) {
      if (queue.length === 0) {
        if (strategyDone) return;
        await new Promise<void>((resolve) => (wake = resolve));
        continue;
      }
      // In runs of one cause (a job that switched again has a newer one), in queue order.
      const runs: { cause: LLMError; segments: Segment[] }[] = [];
      for (const { segment, cause } of queue.splice(0)) {
        const last = runs.at(-1);
        if (last?.cause === cause) last.segments.push(segment);
        else runs.push({ cause, segments: [segment] });
      }
      for (const run of runs) yield* basicTranslate(run.segments, job, ctx, run.cause);
    }
  }
  async function* strategy(): AsyncGenerator<EngineEvent> {
    try {
      for await (const event of events) {
        const segment = event.type === 'segment.failed' && event.revision === undefined && isRetryable(event.error) && !ctx.memory.translated.has(event.id) ? byId.get(event.id) : undefined;
        // The providers answered again (a probe got through): the switch ends.
        if (state.announced && state.error === undefined) yield* ended(true);
        if (segment === undefined || event.type !== 'segment.failed') {
          yield event;
          continue;
        }
        state.error ??= event.error;
        if (!state.announced) {
          state.announced = { from: ctx.llm('translate').model, ...(ctx.mt ? { to: ctx.mt.model } : {}), error: state.error };
          yield { type: 'stage', stage: BASIC_SWITCH_STAGE, status: 'start', info: state.announced };
        }
        queue.push({ segment, cause: state.announced.error });
        poke();
      }
    } finally {
      strategyDone = true;
      poke();
    }
  }
  function* ended(recovered: boolean): Generator<EngineEvent> {
    if (!state.announced) return;
    const info: BasicSwitchInfo = { ...state.announced, ...(recovered ? { recovered: true } : {}) };
    delete state.announced;
    yield { type: 'stage', stage: BASIC_SWITCH_STAGE, status: 'done', info };
  }
  yield* merge(strategy(), worker());
  yield* ended(false);
}

/** The events of `a` and `b` as they come. Either throwing stops both (the other is returned). */
async function* merge<T>(a: AsyncGenerator<T>, b: AsyncGenerator<T>): AsyncGenerator<T> {
  const live = new Map<AsyncGenerator<T>, Promise<{ from: AsyncGenerator<T>; result: IteratorResult<T> }>>();
  const pull = (from: AsyncGenerator<T>) => live.set(from, from.next().then((result) => ({ from, result })));
  pull(a);
  pull(b);
  try {
    while (live.size > 0) {
      const { from, result } = await Promise.race(live.values());
      if (result.done) live.delete(from);
      else {
        yield result.value;
        pull(from);
      }
    }
  } finally {
    for (const g of live.keys()) void g.return(undefined).catch(() => {});
  }
}

/** `client`, answering at once with the switch's error once the job switched to `basic`. */
function switchable(client: LLMClient, state: BasicSwitch): LLMClient {
  return {
    get model() {
      return client.model;
    },
    get id() {
      return client.id;
    },
    reasoningReserveTokens: (req) => client.reasoningReserveTokens(req),
    servedBy: (req) => client.servedBy?.(req),
    async *stream(req: NormalizedRequest): AsyncGenerator<NormalizedEvent> {
      if (state.error === undefined) {
        yield* client.stream(req);
        return;
      }
      if (state.probing) {
        req.signal.throwIfAborted();
        yield { type: 'error', error: state.error };
        return;
      }
      // The probe: this request tries the providers again.
      state.probing = true;
      try {
        for await (const event of client.stream(req)) {
          if ((event.type === 'text' && event.delta !== '') || event.type === 'done') delete state.error;
          yield event;
        }
      } finally {
        state.probing = false;
      }
    },
  };
}

function createStageContext(deps: EngineDeps, job: TranslationJob, signal: AbortSignal, toBasic?: BasicSwitch): StageContext {
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
      // A request still backing off on a link the chain has given up on stops waiting, and so does
      // one while the job is switched to `basic`: a probe is one attempt, never a backoff.
      const own: LLMClient = withRetry(withLatch(raw, latched), { ...retry, abandon: () => dead.has(own) || toBasic?.error !== undefined });
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
        if (toBasic) client = switchable(client, toBasic);
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
    ...(job.focus === undefined ? {} : { focus: job.focus }),
    ...(job.within === undefined ? {} : { within: job.within }),
    ...(deps.mt === undefined ? {} : { mt: deps.mt }),
  };
}
