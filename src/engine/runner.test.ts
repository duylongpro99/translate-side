import { describe, expect, it } from 'vitest';
import { createBudget } from './budget.ts';
import { createWorkingMemory } from './memory.ts';
import { createPromptRegistry } from './prompts/registry.ts';
import { defineStrategy, isEngineEvent, runStages, type AnyStage } from './runner.ts';
import { fakeClient, success } from './testing.ts';
import type { EngineEvent, Stage, StageContext, TranslationJob } from './types.ts';

function context(signal: AbortSignal = new AbortController().signal): StageContext {
  return {
    llm: () => fakeClient([success('x')]),
    memory: createWorkingMemory(),
    context: [],
    prompts: createPromptRegistry([]),
    budget: createBudget({}, () => 0),
    signal,
  };
}

async function drain(gen: AsyncGenerator<EngineEvent, unknown>): Promise<{ events: EngineEvent[]; output: unknown }> {
  const events: EngineEvent[] = [];
  for (;;) {
    const r = await gen.next();
    if (r.done === true) return { events, output: r.value };
    events.push(r.value);
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const partial = (id: string): EngineEvent => ({ type: 'segment.partial', id, text: id });

function stage<I, O>(id: string, scope: Stage<I, O>['scope'], run: Stage<I, O>['run']): AnyStage {
  return { id, scope, run } as AnyStage;
}

describe('runStages', () => {
  it('runs stages in order, framed by stage events, and passes outputs along', async () => {
    const stages = [
      stage<string, string>('upper', 'document', async function* (s) {
        yield s.toUpperCase();
      }),
      stage<string, string>('noop', 'document', async function* () {}), // passes its input through
      stage<string, string[]>('split', 'document', async function* (s) {
        yield s.split('');
      }),
      stage<string, string>('each', 'chunk', async function* (c) {
        yield partial(c);
        yield `${c}!`;
      }),
    ];
    const { events, output } = await drain(runStages(stages, 'ab', context(), { concurrency: 1 }));
    expect(output).toEqual(['A!', 'B!']);
    expect(events).toEqual([
      { type: 'stage', stage: 'upper', status: 'start' },
      { type: 'stage', stage: 'upper', status: 'done' },
      { type: 'stage', stage: 'noop', status: 'start' },
      { type: 'stage', stage: 'noop', status: 'done' },
      { type: 'stage', stage: 'split', status: 'start' },
      { type: 'stage', stage: 'split', status: 'done' },
      { type: 'stage', stage: 'each', status: 'start' },
      partial('A'),
      partial('B'),
      { type: 'stage', stage: 'each', status: 'done' },
    ]);
  });

  it('runs per-chunk work with at most `concurrency` in flight, multiplexing events as they arrive', async () => {
    const gates = [deferred(), deferred(), deferred()];
    let inFlight = 0;
    let maxInFlight = 0;
    const started: number[] = [];
    const translate = stage<number, string>('translate', 'chunk', async function* (i) {
      started.push(i);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      yield partial(`c${i}-start`);
      await gates[i]?.promise;
      yield partial(`c${i}-end`);
      yield `out${i}`;
      inFlight--;
    });
    const gen = runStages([translate], [0, 1, 2], context(), { concurrency: 2 });
    const seen: string[] = [];
    const pump = (async () => {
      for (;;) {
        const r = await gen.next();
        if (r.done === true) return r.value;
        if (r.value.type === 'segment.partial') {
          seen.push(r.value.id);
          // Chunk 1 finishes before chunk 0, then chunk 2 may start.
          if (r.value.id === 'c1-start') gates[1]?.resolve();
          if (r.value.id === 'c1-end') gates[0]?.resolve();
          if (r.value.id === 'c2-start') gates[2]?.resolve();
        }
      }
    })();
    const output = await pump;
    expect(maxInFlight).toBe(2);
    expect(started).toEqual([0, 1, 2]);
    // Interleaved across chunks (multiplexed), not one chunk after another…
    expect(seen.indexOf('c1-end')).toBeLessThan(seen.indexOf('c0-end'));
    // …but outputs are in chunk order, not completion order.
    expect(output).toEqual(['out0', 'out1', 'out2']);
  });

  it('a failing chunk stops new chunks, lets in-flight ones finish, then rethrows', async () => {
    const finished: number[] = [];
    const translate = stage<number, number>('translate', 'chunk', async function* (i) {
      await Promise.resolve();
      if (i === 0) throw new Error('boom');
      for (let k = 0; k < 3; k++) await Promise.resolve();
      yield partial(`c${i}`);
      finished.push(i);
    });
    const gen = runStages([translate], [0, 1, 2, 3], context(), { concurrency: 2 });
    const events: EngineEvent[] = [];
    await expect(
      (async () => {
        for await (const e of gen) events.push(e);
      })(),
    ).rejects.toThrow('boom');
    expect(finished).toEqual([1]);
    expect(events).toContainEqual(partial('c1'));
  });

  it('stops starting chunks once the signal aborts, and throws its reason', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const translate = stage<number, number>('translate', 'chunk', async function* (i) {
      started.push(i);
      controller.abort(new Error('cancelled'));
      yield i;
    });
    await expect(drain(runStages([translate], [0, 1, 2], context(controller.signal), { concurrency: 1 }))).rejects.toThrow('cancelled');
    expect(started).toEqual([0]);
  });

  it('rejects a document stage with two outputs and a chunk stage without an array', async () => {
    const two = stage<unknown, number>('two', 'document', async function* () {
      yield 1;
      yield 2;
    });
    await expect(drain(runStages([two], null, context(), { concurrency: 1 }))).rejects.toThrow(/at most one output/);
    const each = stage<unknown, number>('each', 'segment', async function* () {});
    await expect(drain(runStages([each], 'nope', context(), { concurrency: 1 }))).rejects.toThrow(/array input/);
  });

  it('closes running chunks when the consumer stops early', async () => {
    let closed = 0;
    const translate = stage<number, number>('translate', 'chunk', async function* (i) {
      try {
        for (;;) {
          yield partial(`c${i}`);
          await Promise.resolve();
        }
      } finally {
        closed++;
      }
    });
    let n = 0;
    for await (const e of runStages([translate], [0, 1], context(), { concurrency: 2 })) {
      if (e.type === 'segment.partial' && ++n === 5) break;
    }
    for (let k = 0; k < 10; k++) await Promise.resolve();
    expect(closed).toBe(2);
  });
});

describe('defineStrategy', () => {
  it('runs its stages with the job as input and the job concurrency', async () => {
    let maxInFlight = 0;
    let inFlight = 0;
    const strategy = defineStrategy({
      id: 'test',
      version: 1,
      stages: [
        stage<TranslationJob, number[]>('chunk', 'document', async function* (job) {
          yield job.doc.segments.map((_, i) => i);
        }),
        stage<number, number>('work', 'chunk', async function* (i) {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          for (let k = 0; k < 3; k++) await Promise.resolve();
          inFlight--;
          yield i;
        }),
      ],
    });
    const job = {
      doc: { url: 'u', title: 't', sourceLang: 'en', targetLang: 'vi', outline: [], segments: Array.from({ length: 5 }, () => ({})) },
      priority: [],
      strategy: 'test',
      options: { style: 'natural', glossary: [], maxConcurrency: 3, chunkTokens: 1200 },
    } as unknown as TranslationJob;
    const events: EngineEvent[] = [];
    for await (const e of strategy.run(job, context())) events.push(e);
    expect(maxInFlight).toBe(3);
    expect(events.filter((e) => e.type === 'stage')).toHaveLength(4);
  });
});

describe('isEngineEvent', () => {
  it('tells events from output values', () => {
    expect(isEngineEvent({ type: 'done' })).toBe(true);
    expect(isEngineEvent({ type: 'segment.final', id: '1' })).toBe(true);
    expect(isEngineEvent({ type: 'chunk' })).toBe(false);
    expect(isEngineEvent('done')).toBe(false);
    expect(isEngineEvent(null)).toBe(false);
  });
});
