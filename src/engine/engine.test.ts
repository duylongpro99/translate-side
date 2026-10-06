import { describe, expect, it } from 'vitest';
import type { ModelRole, NormalizedEvent } from '../llm/types.ts';
import { createEngine, type EngineDeps } from './engine.ts';
import { createPromptRegistry } from './prompts/registry.ts';
import { DEFAULT_RETRY_POLICY, withRetry } from './retry.ts';
import { defineStrategy, type AnyStage } from './runner.ts';
import { fakeClient, fakeSleep, rateLimited, success, type FakeClient } from './testing.ts';
import type { EngineEvent, Segment, Stage, StageContext, Strategy, TranslationJob } from './types.ts';

const seg = (id: string, translate = true): Segment => ({ id, kind: 'p', text: id, inlineMarkup: id, domPath: `p[${id}]`, translate });

function job(segments: Segment[], strategy = 'test'): TranslationJob {
  return {
    doc: { url: 'https://example.com', title: 'T', sourceLang: 'en', targetLang: 'vi', outline: [], segments },
    priority: [],
    strategy,
    options: { style: 'natural', glossary: [{ term: 'future', rendering: 'future' }], maxConcurrency: 2, chunkTokens: 1200 },
  };
}

function deps(clients: Partial<Record<ModelRole, FakeClient>>, strategies: Strategy[], sleep = fakeSleep()): EngineDeps {
  return {
    llm: (role) => {
      const c = clients[role];
      if (c === undefined) throw new Error(`no client for ${role}`);
      return c;
    },
    now: () => 0,
    sleep,
    strategies,
    prompts: createPromptRegistry([]),
    random: () => 0,
  };
}

async function collect(stream: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

/** A translate-like stage: one model call per chunk, the text becomes the segment's final text. */
function callStage(onEvents?: (events: NormalizedEvent[], ctx: StageContext) => void): AnyStage {
  const s: Stage<Segment[], never> = {
    id: 'translate',
    scope: 'chunk',
    role: 'translate',
    async *run(chunk, ctx) {
      const client = ctx.llm('translate');
      const events: NormalizedEvent[] = [];
      for await (const e of client.stream({ model: client.model, system: 's', messages: [{ role: 'user', content: 'u' }], maxOutputTokens: 100, signal: ctx.signal })) {
        events.push(e);
      }
      onEvents?.(events, ctx);
      const error = events.find((e) => e.type === 'error');
      for (const segment of chunk) {
        if (error?.type === 'error') yield { type: 'segment.failed', id: segment.id, error: error.error };
        else yield { type: 'segment.final', id: segment.id, text: `vi:${segment.id}`, revision: 1, producedBy: { strategy: 'test', stage: 'translate', model: client.model } };
      }
      const usage = events.find((e) => e.type === 'usage');
      if (usage?.type === 'usage') yield { type: 'usage', role: 'translate', model: client.model, input: usage.input, output: usage.output };
    },
  };
  return s as AnyStage;
}

const chunker: AnyStage = {
  id: 'chunk',
  scope: 'document',
  async *run(j: TranslationJob) {
    yield j.doc.segments.map((s) => [s]);
  },
} as AnyStage;

describe('criterion 7: a rate limit is retried by exactly one owner', () => {
  // The adapter side (SDK maxRetries: 0) is re-verified in Phase C when the real adapter exists.
  // Here the fake adapter makes exactly one attempt per stream() call, as the contract requires,
  // so its request count is the number of HTTP attempts.
  it('one rate-limited request is retried by the pipeline only: attempts = maxRetries + 1, not more', async () => {
    const adapter = fakeClient([[rateLimited(14_000)]]);
    const sleep = fakeSleep();
    // Two layers try to add retries on top: a stage that wraps its client again, and a role
    // client that the shell already wrapped. Neither may multiply the attempts.
    const doubleWrapStage: AnyStage = {
      id: 'translate',
      scope: 'document',
      async *run(_j: TranslationJob, ctx: StageContext) {
        const client = withRetry(withRetry(ctx.llm('translate'), { sleep }), { sleep });
        for await (const e of client.stream({ model: client.model, system: 's', messages: [], maxOutputTokens: 1, signal: ctx.signal })) {
          if (e.type === 'error') yield { type: 'segment.failed', id: 'a', error: e.error };
        }
      },
    } as AnyStage;
    const engine = createEngine(deps({ translate: adapter }, [defineStrategy({ id: 'test', version: 1, stages: [doubleWrapStage] })], sleep));
    const events = await collect(engine.translate(job([seg('a')]), new AbortController().signal));

    expect(adapter.requests).toHaveLength(DEFAULT_RETRY_POLICY.maxRetries + 1);
    expect(sleep.delays).toEqual(Array(DEFAULT_RETRY_POLICY.maxRetries).fill(14_000));
    const failures = events.filter((e) => e.type === 'segment.failed');
    expect(failures).toEqual([{ type: 'segment.failed', id: 'a', error: expect.objectContaining({ kind: 'rate_limit' }) }]);
  });

  it('a rate limit that clears is invisible to the stage: one success, retries counted once', async () => {
    const adapter = fakeClient([[rateLimited(2000)], success('ok')]);
    const sleep = fakeSleep();
    const seen: NormalizedEvent[][] = [];
    const engine = createEngine(deps({ translate: adapter }, [defineStrategy({ id: 'test', version: 1, stages: [chunker, callStage((e) => seen.push(e))] })], sleep));
    const events = await collect(engine.translate(job([seg('a')]), new AbortController().signal));
    expect(adapter.requests).toHaveLength(2);
    expect(sleep.delays).toEqual([2000]);
    expect(seen).toEqual([success('ok')]);
    expect(events.filter((e) => e.type === 'segment.final').map((e) => e.type === 'segment.final' && e.text)).toEqual(['vi:a']);
  });

  it('every role client the engine hands out is the same retrying wrapper', async () => {
    const adapter = fakeClient([success('ok')]);
    const clients: unknown[] = [];
    const probe: AnyStage = {
      id: 'probe',
      scope: 'document',
      async *run(_j: TranslationJob, ctx: StageContext) {
        clients.push(ctx.llm('translate'), ctx.llm('translate'));
        yield* [];
      },
    } as AnyStage;
    const engine = createEngine(deps({ translate: adapter }, [defineStrategy({ id: 'test', version: 1, stages: [probe, probe] })]));
    await collect(engine.translate(job([]), new AbortController().signal));
    expect(new Set(clients).size).toBe(1);
    expect(clients[0]).not.toBe(adapter);
    expect(withRetry(clients[0] as FakeClient, { sleep: fakeSleep() })).toBe(clients[0]);
  });
});

describe('createEngine', () => {
  it('streams stage and segment events, then exactly one done', async () => {
    const strategy = defineStrategy({ id: 'test', version: 1, stages: [chunker, callStage()] });
    const engine = createEngine(deps({ translate: fakeClient([success('ok')]) }, [strategy]));
    const events = await collect(engine.translate(job([seg('a'), seg('b')]), new AbortController().signal));
    const types = events.map((e) => e.type);
    expect(types.slice(0, 3)).toEqual(['stage', 'stage', 'stage']); // chunk start/done, translate start
    expect(types.filter((t) => t === 'segment.final')).toHaveLength(2);
    expect(types.filter((t) => t === 'usage')).toHaveLength(2);
    expect(events.at(-2)).toEqual({ type: 'stage', stage: 'translate', status: 'done' });
    expect(types.filter((t) => t === 'done')).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('keeps memory and budget from the events (last good revision, usage)', async () => {
    let ctxSeen: StageContext | undefined;
    const strategy: Strategy = {
      id: 'test',
      version: 1,
      async *run(_j, ctx) {
        ctxSeen = ctx;
        const producedBy = { strategy: 'test', stage: 's', model: 'm' };
        yield { type: 'segment.final', id: 'a', text: 'draft', revision: 1, producedBy };
        yield { type: 'segment.final', id: 'a', text: 'refined', revision: 2, producedBy };
        yield { type: 'segment.final', id: 'a', text: 'late draft', revision: 1, producedBy };
        yield { type: 'usage', role: 'translate', model: 'm', input: 100, output: 40, cachedInput: 60 };
        yield { type: 'done' }; // swallowed: the engine sends its own done last
      },
    };
    const engine = createEngine(deps({}, [strategy]));
    const events = await collect(engine.translate(job([seg('a')]), new AbortController().signal));
    expect(ctxSeen?.memory.translated.get('a')).toEqual({ text: 'refined', revision: 2 });
    expect(ctxSeen?.memory.glossary).toEqual([{ term: 'future', rendering: 'future' }]);
    expect(ctxSeen?.budget.spent).toEqual({ input: 100, output: 40, cachedInput: 60 });
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
  });

  it('degrades gracefully: a throwing strategy fails only the segments without a good revision', async () => {
    const strategy: Strategy = {
      id: 'test',
      version: 1,
      async *run() {
        yield { type: 'segment.final', id: 'a', text: 'ok', revision: 1, producedBy: { strategy: 'test', stage: 's', model: 'm' } };
        yield { type: 'segment.failed', id: 'b', error: { kind: 'overloaded', message: 'x' } };
        throw new Error('stage bug');
      },
    };
    const engine = createEngine(deps({}, [strategy]));
    const events = await collect(engine.translate(job([seg('a'), seg('b'), seg('c'), seg('code', false)]), new AbortController().signal));
    const failed = events.filter((e) => e.type === 'segment.failed');
    expect(failed.map((e) => e.type === 'segment.failed' && [e.id, e.error.kind])).toEqual([['b', 'overloaded'], ['c', 'unknown']]);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('a cancel throws the signal reason and sends no done', async () => {
    const controller = new AbortController();
    const strategy: Strategy = {
      id: 'test',
      version: 1,
      async *run(_j, ctx) {
        controller.abort(new Error('cancelled'));
        ctx.signal.throwIfAborted();
        yield { type: 'done' };
      },
    };
    const engine = createEngine(deps({}, [strategy]));
    const events: EngineEvent[] = [];
    await expect(
      (async () => {
        for await (const e of engine.translate(job([seg('a')]), controller.signal)) events.push(e);
      })(),
    ).rejects.toThrow('cancelled');
    expect(events).toEqual([]);
  });

  it('rejects an unknown strategy', async () => {
    const engine = createEngine(deps({}, []));
    await expect(collect(engine.translate(job([], 'nope'), new AbortController().signal))).rejects.toThrow(/unknown strategy nope/);
  });

  it('translateSnippet runs the snippet as a small job (single-pass by default)', async () => {
    const strategy = defineStrategy({ id: 'single-pass', version: 1, stages: [chunker, callStage()] });
    const engine = createEngine(deps({ translate: fakeClient([success('ok')]) }, [strategy]));
    const { doc, options } = job([]);
    const events = await collect(engine.translateSnippet({ doc, segments: [seg('s1')], options }, new AbortController().signal));
    expect(events.filter((e) => e.type === 'segment.final').map((e) => e.type === 'segment.final' && e.id)).toEqual(['s1']);
  });
});
