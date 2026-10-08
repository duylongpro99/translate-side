import { describe, expect, it } from 'vitest';
import type { LLMClient, ModelRole, NormalizedRequest } from '../llm/types.ts';
import { createBudget } from './budget.ts';
import { createEngine } from './engine.ts';
import { createWorkingMemory } from './memory.ts';
import { pickByPriority } from './priority.ts';
import { createDefaultPromptRegistry } from './prompts/index.ts';
import { createPromptRegistry } from './prompts/registry.ts';
import { defineStage, multiplex, runStages } from './runner.ts';
import { contextual } from './strategies/contextual.ts';
import { chunkJob, singlePass } from './strategies/single-pass.ts';
import { fakeClient, fakeSleep, success, translatorClient, wireLines, type FakeClient } from './testing.ts';
import type { EngineEvent, Segment, StageContext, TranslationJob } from './types.ts';

describe('pickByPriority (plan M3-E1)', () => {
  const items = [['a0', 'a1'], ['b0'], ['c0', 'c1'], ['d0'], ['e0']];

  it('keeps page order when nothing is on screen', () => {
    expect(pickByPriority(items, [3, 1, 4], [])).toBe(1);
    expect(pickByPriority(items, [3, 4], ['not-a-segment'])).toBe(3);
  });

  it('starts the chunks holding a priority id first, by their best rank', () => {
    expect(pickByPriority(items, [0, 1, 2, 3, 4], ['c1'])).toBe(2);
    expect(pickByPriority(items, [0, 1, 2, 3, 4], ['d0', 'b0'])).toBe(3);
    expect(pickByPriority(items, [0, 1, 4], ['d0', 'b0'])).toBe(1);
  });

  it('then reads on from the screen: the chunks after it, then the ones before', () => {
    // c (index 2) is on screen and already started.
    const pending = [0, 1, 3, 4];
    const order: number[] = [];
    const left = [...pending];
    while (left.length > 0) {
      const next = pickByPriority(items, left, ['c0']);
      order.push(next);
      left.splice(left.indexOf(next), 1);
    }
    expect(order).toEqual([3, 4, 0, 1]);
  });

  it('reads on from the last chunk on screen when the screen spans several', () => {
    expect(pickByPriority(items, [0, 4], ['b0', 'c0'])).toBe(4);
  });

  it('throws when nothing is pending', () => {
    expect(() => pickByPriority(items, [], [])).toThrow(/nothing pending/);
  });
});

describe('multiplex with pick: only pending items are reordered (M3-D3)', () => {
  it('asks pick each time a slot frees, and never touches an item in flight', async () => {
    const started: number[] = [];
    const finished: number[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let priority = 3;
    const asked: number[][] = [];
    const gen = multiplex(
      [0, 1, 2, 3],
      1,
      async function* (item) {
        started.push(item);
        if (started.length === 1) await held;
        finished.push(item);
        yield item;
      },
      new AbortController().signal,
      (pending) => {
        asked.push([...pending]);
        return pending.includes(priority) ? priority : (pending[0] as number);
      },
    );
    const values: unknown[] = [];
    const consume = (async () => {
      for await (const { value } of gen) values.push(value);
    })();
    await new Promise((r) => setTimeout(r, 0));
    // Item 3 started first; the screen moves to item 0 while it runs.
    expect(started).toEqual([3]);
    priority = 0;
    release();
    await consume;
    expect(started).toEqual([3, 0, 1, 2]);
    expect(finished).toEqual([3, 0, 1, 2]);
    expect(asked[0]).toEqual([0, 1, 2, 3]);
    expect(values).toEqual([3, 0, 1, 2]);
  });

  it('falls back to the first pending index when pick returns one that is not pending', async () => {
    const started: number[] = [];
    for await (const _ of multiplex([0, 1, 2], 1, async function* (i) { started.push(i); yield i; }, new AbortController().signal, () => 99)) void _;
    expect(started).toEqual([0, 1, 2]);
  });

  it('runStages keeps the outputs in element order whatever the start order', async () => {
    const ctx: StageContext = { llm: () => fakeClient([success('x')]), memory: createWorkingMemory(), context: [], prompts: createPromptRegistry([]), budget: createBudget({}, () => 0), signal: new AbortController().signal, priority: () => ['2'] };
    const started: number[] = [];
    const each = defineStage<number, number>({
      id: 'work',
      scope: 'chunk',
      async *run(i) {
        started.push(i);
        yield i * 10;
      },
      pick: (items, pending, c) => {
        const want = Number(c.priority?.()[0]);
        return pending.find((p) => items[p] === want) ?? (pending[0] as number);
      },
    });
    const gen = runStages([each], [0, 1, 2, 3], ctx, { concurrency: 1 });
    let r = await gen.next();
    while (r.done !== true) r = await gen.next();
    expect(started).toEqual([2, 0, 1, 3]);
    expect(r.value).toEqual([0, 10, 20, 30]);
  });
});

// ---- The strategies, end to end -------------------------------------------------------------

const seg = (id: string, text: string): Segment => ({ id, kind: 'p', text, inlineMarkup: text, domPath: `p[${id}]`, translate: true });
/** Six chunks of one ~430-token paragraph each at chunkTokens 500. */
const CHUNKS = 6;
const long = Array.from({ length: CHUNKS }, (_, i) => seg(`p${i}`, `P${i} ${'word '.repeat(300).trim()}`));

function job(strategy: string, over: Partial<TranslationJob> = {}, maxConcurrency = 1): TranslationJob {
  return {
    doc: { url: 'https://example.com', title: 'T', sourceLang: 'en', targetLang: 'vi', outline: [], segments: long },
    priority: [],
    strategy,
    options: { style: 'natural', glossary: [], maxConcurrency, chunkTokens: 500 },
    ...over,
  };
}

/** Which paragraph a translate request carries (`P<n>` at the start of its first line). */
const paragraphOf = (req: NormalizedRequest): string => {
  const [line] = wireLines(req.messages.find((m) => m.role === 'user')?.content ?? '');
  return `p${/^P(\d+)/.exec(line?.source ?? '')?.[1] ?? '?'}`;
};

/** A translator whose `hold`-th call waits for `release()`; it records each call's paragraph when it starts. */
function heldTranslator(hold: number) {
  const inner = translatorClient();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const order: string[] = [];
  let calls = 0;
  const client: LLMClient & { requests: NormalizedRequest[] } = {
    model: inner.model,
    requests: inner.requests,
    reasoningReserveTokens: inner.reasoningReserveTokens,
    async *stream(req) {
      order.push(paragraphOf(req));
      if (++calls === hold) await held;
      yield* inner.stream(req);
    },
  };
  return { client, release, order };
}

function engineFor(translate: LLMClient, analyze?: LLMClient) {
  return createEngine({
    llm: (role: ModelRole) => (role === 'analyze' ? (analyze ?? translate) : translate),
    now: () => 0,
    sleep: fakeSleep(),
    strategies: [singlePass, contextual],
    prompts: createDefaultPromptRegistry(),
    random: () => 0,
  });
}

async function collect(stream: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const finalIds = (events: EngineEvent[]) => events.flatMap((e) => (e.type === 'segment.final' ? [e.id] : []));

describe('single-pass: viewport first', () => {
  it('translates the chunk on screen first, then reads on, then goes back', async () => {
    const translate = translatorClient();
    const events = await collect(engineFor(translate).translate(job('single-pass', { priority: ['p3'] }), new AbortController().signal));
    expect(translate.requests.map(paragraphOf)).toEqual(['p3', 'p4', 'p5', 'p0', 'p1', 'p2']);
    expect(finalIds(events).sort()).toEqual(long.map((s) => s.id).sort());
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('follows a scroll: pending chunks are reordered, the chunk in flight finishes', async () => {
    const { client, release, order } = heldTranslator(1);
    let screen: readonly string[] = ['p1'];
    const controller = new AbortController();
    const done = collect(engineFor(client).translate(job('single-pass', { priority: ['p1'], livePriority: () => screen }), controller.signal));
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['p1']);
    // The user scrolls down to p4 while p1 is being translated.
    screen = ['p4'];
    release();
    const events = await done;
    expect(order).toEqual(['p1', 'p4', 'p5', 'p0', 'p2', 'p3']);
    // p1 was not aborted: its final arrived, and nothing failed.
    expect(finalIds(events)[0]).toBe('p1');
    expect(events.filter((e) => e.type === 'segment.failed')).toEqual([]);
  });
});

const BRIEF = { language: 'en', genre: 'post', audience: 'devs', purpose: 'explain', tone: 'plain', glossary: [] };

describe('contextual: viewport first (plan M3-E1, §8 risk)', () => {
  it('the chunk on screen is the brief-free one, and it is the one revised once the brief lands', async () => {
    const translate: FakeClient = translatorClient();
    const analyze = fakeClient([success(JSON.stringify(BRIEF))], { model: 'brief-model' });
    const events = await collect(engineFor(translate, analyze).translate(job('contextual', { priority: ['p4'] }, 2), new AbortController().signal));
    const paragraphs = translate.requests.map(paragraphOf);
    expect(paragraphs[0]).toBe('p4');
    // p4 went out without the brief; every other chunk waited for it.
    const chunks = events.flatMap((e) => (e.type === 'chunk' && e.revise === undefined ? [[e.index, e.briefed] as const] : []));
    expect(chunks.find(([i]) => i === 4)).toEqual([4, false]);
    expect(chunks.filter(([i]) => i !== 4).every(([, b]) => b)).toBe(true);
    // M2-D17's second pass is p4's, not chunk 0's.
    const revised = events.flatMap((e) => (e.type === 'segment.final' && e.revision === 2 ? [e.id] : []));
    expect(revised).toEqual(['p4']);
    expect(paragraphs.filter((p) => p === 'p4')).toHaveLength(2);
    expect(paragraphs.slice(1).filter((p) => p !== 'p4')).toEqual(['p5', 'p0', 'p1', 'p2', 'p3']);
    expect(events.filter((e) => e.type === 'segment.failed')).toEqual([]);
  });

  it('with nothing on screen it is chunk 0, as in M2', async () => {
    const translate: FakeClient = translatorClient();
    const analyze = fakeClient([success(JSON.stringify(BRIEF))], { model: 'brief-model' });
    const events = await collect(engineFor(translate, analyze).translate(job('contextual', {}, 2), new AbortController().signal));
    expect(translate.requests.map(paragraphOf)).toEqual(['p0', 'p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
    const revised = events.flatMap((e) => (e.type === 'segment.final' && e.revision === 2 ? [e.id] : []));
    expect(revised).toEqual(['p0']);
  });

  it('re-prioritizes the chunks waiting for the brief when the screen moves', async () => {
    const translate: FakeClient = translatorClient();
    let screen: readonly string[] = ['p0'];
    let releaseBrief!: () => void;
    const briefGate = new Promise<void>((r) => (releaseBrief = r));
    const inner = fakeClient([success(JSON.stringify(BRIEF))], { model: 'brief-model' });
    const analyze: LLMClient = {
      model: inner.model,
      reasoningReserveTokens: inner.reasoningReserveTokens,
      async *stream(req) {
        await briefGate;
        yield* inner.stream(req);
      },
    };
    const done = collect(engineFor(translate, analyze).translate(job('contextual', { priority: ['p0'], livePriority: () => screen }, 1), new AbortController().signal));
    await new Promise((r) => setTimeout(r, 10));
    // Chunk 0 is done; its revise item holds the only slot until the brief lands. Meanwhile the
    // user scrolls to p3.
    screen = ['p3'];
    releaseBrief();
    await done;
    expect(translate.requests.map(paragraphOf)).toEqual(['p0', 'p0', 'p3', 'p4', 'p5', 'p1', 'p2']);
  });
});

describe('the screen starts a chunk, and the first chunk started gets the first chunk\'s thinking (plan M3-E1, M2-D16)', () => {
  /** Twelve ~110-token paragraphs: four or so to a chunk at chunkTokens 500. */
  const short = Array.from({ length: 12 }, (_, i) => seg(`q${i}`, `Q${i} ${'word '.repeat(75).trim()}`));
  const shortJob = (strategy: string, over: Partial<TranslationJob> = {}) => job(strategy, { doc: { ...job(strategy).doc, segments: short }, ...over });
  const firstOf = (req: NormalizedRequest) => `q${/^Q(\d+)/.exec(wireLines(req.messages.find((m) => m.role === 'user')?.content ?? '')[0]?.source ?? '')?.[1] ?? '?'}`;
  const chunkFirsts = (j: TranslationJob, priority: string[] = []) => chunkJob(j, priority).map((c) => c.segments[0]?.id);

  it('chunkJob cuts at the first segment on screen, only for a document of more than one chunk', () => {
    const plain = chunkFirsts(shortJob('single-pass'));
    expect(plain).not.toContain('q6');
    expect(chunkFirsts(shortJob('single-pass'), ['q6', 'q7'])).toContain('q6');
    // Nothing on screen, or nothing on screen to translate: as before.
    expect(chunkFirsts(shortJob('single-pass'), [])).toEqual(plain);
    expect(chunkFirsts(shortJob('single-pass'), ['not-here'])).toEqual(plain);
    // One chunk stays one chunk (M2-D9).
    const one = shortJob('single-pass', { doc: { ...job('single-pass').doc, segments: short.slice(0, 3) } });
    expect(chunkJob(one, ['q2'])).toHaveLength(1);
  });

  it('single-pass: the first call starts at the screen, and its chunkIndex is 0', async () => {
    const translate = translatorClient();
    await collect(engineFor(translate).translate(shortJob('single-pass', { priority: ['q6', 'q7'] }), new AbortController().signal));
    expect(firstOf(translate.requests[0] as NormalizedRequest)).toBe('q6');
    expect(translate.requests.map((r) => r.chunkIndex)).toEqual(translate.requests.map((_, i) => i));
  });

  it('with nothing on screen, chunkIndex is the page position, as in M2', async () => {
    const translate = translatorClient();
    await collect(engineFor(translate).translate(shortJob('single-pass'), new AbortController().signal));
    const n = chunkJob(shortJob('single-pass')).length;
    expect(translate.requests.map((r) => r.chunkIndex)).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  it('contextual: the brief-free chunk starts at the screen with chunkIndex 0, and its revision keeps it', async () => {
    const translate: FakeClient = translatorClient();
    const analyze = fakeClient([success(JSON.stringify(BRIEF))], { model: 'brief-model' });
    const events = await collect(engineFor(translate, analyze).translate(shortJob('contextual', { priority: ['q6'] }), new AbortController().signal));
    const first = translate.requests[0] as NormalizedRequest;
    expect(firstOf(first)).toBe('q6');
    expect(first.chunkIndex).toBe(0);
    const zero = translate.requests.filter((r) => r.chunkIndex === 0).map(firstOf);
    expect(zero).toEqual(['q6', 'q6']);
    expect(events.filter((e) => e.type === 'segment.failed')).toEqual([]);
  });
});
