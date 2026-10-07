// Ordered-stage runner with event multiplexing (DESIGN.md §5.3). A strategy is usually just data:
//   contextual = [analyze(doc), chunk, translate(chunk), check(segment)]
//
// Data flow between stages:
// - The first stage gets the job.
// - A `document` stage gets the previous output whole. It yields at most one output value; if it
//   yields none, its input passes through unchanged (e.g. analyze, which only fills memory).
// - A `chunk` or `segment` stage needs an array. It runs once per element, up to
//   `concurrency` at a time, and the values each run yields are concatenated in element order
//   (not completion order), so chunk ordering is the engine's and stays stable.
// Events from concurrent runs are passed on as they arrive, each stage framed by
// `stage` start/done events.
//
// Failure: a stage that throws stops the strategy. For per-element stages, no new elements start;
// the ones in flight finish (their events still pass), then the first error is rethrown. Stages
// report per-segment failures as `segment.failed` events rather than throwing. An aborted signal
// also stops new elements; in-flight ones see the same signal.

import type { EngineEvent, EngineEventType, Stage, StageContext, Strategy, StrategyId, TranslationJob } from './types.ts';

export type AnyStage = Stage<never, unknown>;

const EVENT_TYPES = new Set<string>([
  'stage',
  'segment.partial',
  'segment.final',
  'segment.failed',
  'chunk',
  'artifact',
  'usage',
  'done',
] satisfies EngineEventType[]);

/**
 * Types a stage literal (its `run` input and output are checked against `I` and `O`) and erases
 * them for a strategy's stage list, so callers need no casts.
 */
export function defineStage<I, O>(stage: Stage<I, O>): AnyStage {
  return stage as unknown as AnyStage;
}

export function isEngineEvent(value: unknown): value is EngineEvent {
  return typeof value === 'object' && value !== null && EVENT_TYPES.has((value as { type?: unknown }).type as string);
}

export interface StrategyDefinition {
  id: StrategyId;
  version: number;
  stages: readonly AnyStage[];
}

/** A strategy built from stages, run with the job's `maxConcurrency`. */
export function defineStrategy(def: StrategyDefinition): Strategy {
  return {
    id: def.id,
    version: def.version,
    async *run(job: TranslationJob, ctx: StageContext) {
      yield* runStages(def.stages, job, ctx, { concurrency: job.options.maxConcurrency });
    },
  };
}

/** Runs `stages` in order and returns the last stage's output. */
export async function* runStages(
  stages: readonly AnyStage[],
  input: unknown,
  ctx: StageContext,
  options: { concurrency: number },
): AsyncGenerator<EngineEvent, unknown> {
  let current = input;
  for (const stage of stages) {
    ctx.signal.throwIfAborted();
    // The prompt a stage uses is part of the cache key (§5.5): it rides on the start event.
    yield { type: 'stage', stage: stage.id, status: 'start', ...(stage.promptId === undefined ? {} : { info: { promptId: stage.promptId } }) };
    current = yield* (stage.scope === 'document' ? runWhole(stage, current, ctx) : runEach(stage, current, ctx, options.concurrency));
    yield { type: 'stage', stage: stage.id, status: 'done' };
  }
  return current;
}

async function* runWhole(stage: AnyStage, input: unknown, ctx: StageContext): AsyncGenerator<EngineEvent, unknown> {
  const outputs: unknown[] = [];
  for await (const value of run(stage, input, ctx)) {
    if (isEngineEvent(value)) yield value;
    else outputs.push(value);
  }
  if (outputs.length > 1) throw new Error(`stage ${stage.id}: a document stage yields at most one output, got ${outputs.length}`);
  return outputs.length === 1 ? outputs[0] : input;
}

async function* runEach(stage: AnyStage, input: unknown, ctx: StageContext, concurrency: number): AsyncGenerator<EngineEvent, unknown[]> {
  if (!Array.isArray(input)) throw new Error(`stage ${stage.id}: a ${stage.scope} stage needs an array input`);
  const items: readonly unknown[] = input;
  const outputs: unknown[][] = items.map(() => []);
  for await (const { index, value } of multiplex(items, Math.max(1, Math.floor(concurrency)), (item) => run(stage, item, ctx), ctx.signal)) {
    if (isEngineEvent(value)) yield value;
    else outputs[index]?.push(value);
  }
  return outputs.flat();
}

function run(stage: AnyStage, input: unknown, ctx: StageContext): AsyncIterable<unknown> {
  // The runner checks shapes at runtime (array input, output count); stage input types are the
  // strategy author's contract.
  return stage.run(input as never, ctx);
}

interface Active {
  iterator: AsyncIterator<unknown>;
  next: Promise<Settled>;
}
type Settled = { index: number; result: IteratorResult<unknown> } | { index: number; error: unknown };

/**
 * Runs `start(item)` for every item, at most `limit` at a time, and yields each value with the
 * index of the item that produced it, in arrival order.
 */
export async function* multiplex<T>(
  items: readonly T[],
  limit: number,
  start: (item: T, index: number) => AsyncIterable<unknown>,
  signal: AbortSignal,
): AsyncGenerator<{ index: number; value: unknown }> {
  const active = new Map<number, Active>();
  const pull = (index: number, iterator: AsyncIterator<unknown>): Promise<Settled> =>
    iterator.next().then(
      (result) => ({ index, result }),
      (error: unknown) => ({ index, error }),
    );
  let nextIndex = 0;
  let failure: { error: unknown } | undefined;
  const fill = (): void => {
    while (failure === undefined && !signal.aborted && active.size < limit && nextIndex < items.length) {
      const index = nextIndex++;
      try {
        const iterator = start(items[index] as T, index)[Symbol.asyncIterator]();
        active.set(index, { iterator, next: pull(index, iterator) });
      } catch (error) {
        failure = { error };
      }
    }
  };

  try {
    fill();
    while (active.size > 0) {
      const settled = await Promise.race([...active.values()].map((a) => a.next));
      const entry = active.get(settled.index);
      if (entry === undefined) continue;
      if ('error' in settled) {
        active.delete(settled.index);
        failure ??= { error: settled.error };
        continue;
      }
      if (settled.result.done === true) {
        active.delete(settled.index);
        fill();
        continue;
      }
      yield { index: settled.index, value: settled.result.value };
      entry.next = pull(settled.index, entry.iterator);
    }
    if (failure !== undefined) throw failure.error;
    signal.throwIfAborted();
  } finally {
    // The consumer stopped early (or we threw): close what is still running, without waiting
    // for a pending `next()` that may never settle.
    for (const { iterator } of active.values()) void iterator.return?.().catch(() => undefined);
  }
}
