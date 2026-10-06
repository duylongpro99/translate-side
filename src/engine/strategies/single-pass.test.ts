import { describe, expect, it } from 'vitest';
import type { LLMClient } from '../../llm/types.ts';
import { createBudget, maxOutputTokens } from '../budget.ts';
import { createEngine, type EngineDeps } from '../engine.ts';
import { createWorkingMemory } from '../memory.ts';
import { formatWire, toWire } from '../parsing/wire.ts';
import { UNREADABLE_MESSAGE } from '../parsing/translate-chunk.ts';
import { createDefaultPromptRegistry } from '../prompts/index.ts';
import { translateV1 } from '../prompts/translate.ts';
import { DEFAULT_RETRY_POLICY, withRetry } from '../retry.ts';
import { defineStage, defineStrategy, runStages } from '../runner.ts';
import { echoTranslator, fakeClient, fakeSleep, rateLimited, renderLines, translatorClient, type WireLine } from '../testing.ts';
import { estimateTokens } from '../tokens.ts';
import type { EngineEvent, Segment, StageContext, TranslationJob, WorkingMemory } from '../types.ts';
import {
  BUDGET_MESSAGE,
  SINGLE_PASS_CACHE_KEY,
  SINGLE_PASS_STAGES,
  TRANSLATE_TEMPERATURE,
  UNCHECKED_MESSAGE,
  callBudget,
  renderSystemPrompt,
  singlePass,
  translatable,
  type CheckSummary,
  type ChunkOutcome,
} from './single-pass.ts';

const seg = (id: string, markup: string, over: Partial<Segment> = {}): Segment => ({ id, kind: 'p', text: markup, inlineMarkup: markup, domPath: `p[${id}]`, translate: true, ...over });

const three = [seg('a', 'One sentence.'), seg('b', 'Two *sentences* here.'), seg('c', 'Three.')];

function job(segments: Segment[], over: Partial<TranslationJob['options']> = {}): TranslationJob {
  return {
    doc: { url: 'https://example.com', title: 'T', sourceLang: 'en', targetLang: 'vi', outline: [], segments },
    priority: [],
    strategy: 'single-pass',
    options: { style: 'natural', glossary: [], maxConcurrency: 2, chunkTokens: 1200, ...over },
  };
}

function deps(client: LLMClient, sleep = fakeSleep()): EngineDeps {
  return { llm: () => client, now: () => 0, sleep, strategies: [singlePass], prompts: createDefaultPromptRegistry(), random: () => 0 };
}

async function collect(stream: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const finals = (events: EngineEvent[]) => events.flatMap((e) => (e.type === 'segment.final' ? [[e.id, e.text, e.attempt ?? 1] as const] : []));
const failures = (events: EngineEvent[]) => events.flatMap((e) => (e.type === 'segment.failed' ? [[e.id, e.error.kind, e.error.message] as const] : []));

/** Runs the strategy's stages directly (no engine), returning events, the check summary and the context. */
async function runDirect(j: TranslationJob, client: LLMClient, over: Partial<StageContext> = {}): Promise<{ events: EngineEvent[]; summary: CheckSummary; ctx: StageContext }> {
  const sleep = fakeSleep();
  const retrying = withRetry(client, { sleep, random: () => 0 });
  const ctx: StageContext = {
    llm: () => retrying,
    memory: createWorkingMemory(),
    context: [],
    prompts: createDefaultPromptRegistry(),
    budget: createBudget(j.options.budget ?? {}, () => 0),
    signal: new AbortController().signal,
    ...over,
  };
  const events: EngineEvent[] = [];
  const gen = runStages(SINGLE_PASS_STAGES, j, ctx, { concurrency: j.options.maxConcurrency });
  for (;;) {
    const r = await gen.next();
    if (r.done === true) return { events, summary: r.value as CheckSummary, ctx };
    events.push(r.value);
  }
}

const systemFor = (j: TranslationJob) => renderSystemPrompt((v) => translateV1.render(v), { sourceLang: j.doc.sourceLang, targetLang: j.doc.targetLang, style: j.options.style });

describe('single-pass: the translate call (M1-E5)', () => {
  it('sends translate@1 as the system block, the wire chunk as the user message, §5.7 max tokens, 0.2, cacheHint system', async () => {
    const client = translatorClient();
    const j = job(three);
    const events = await collect(createEngine(deps(client)).translate(j, new AbortController().signal));
    expect(client.requests).toHaveLength(1);
    const req = client.requests[0];
    const wire = toWire(three);
    const sourceTokens = three.reduce((n, s) => n + estimateTokens(s.inlineMarkup), 0);
    expect(req).toMatchObject({
      model: 'fake-model',
      system: systemFor(j),
      messages: [{ role: 'user', content: formatWire(wire) }],
      maxOutputTokens: maxOutputTokens({ sourceTokens, segments: 3, reasoningReserveTokens: 0 }),
      temperature: TRANSLATE_TEMPERATURE,
      cacheHint: 'system',
    });
    expect(req?.maxOutputTokens).toBe(callBudget(wire, 0));
    expect(req?.system).toContain('native writer of Vietnamese');
    expect(req?.system).toContain('from English into Vietnamese');
    expect(req?.system).toContain('Style mode: Natural');
    expect(req?.messages[0]?.content).toBe('<seg id="1">One sentence.</seg>\n<seg id="2">Two *sentences* here.</seg>\n<seg id="3">Three.</seg>');
    expect(finals(events)).toEqual([['a', 'vi:One sentence.', 1], ['b', 'vi:Two *sentences* here.', 1], ['c', 'vi:Three.', 1]]);
    expect(failures(events)).toEqual([]);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('adds the model\'s reasoning reserve to every call\'s budget, and honors the style and languages', async () => {
    const client = translatorClient(echoTranslator, { reasoningReserveTokens: 256 });
    const j = job(three, { style: 'faithful' });
    j.doc.sourceLang = 'ja';
    j.doc.targetLang = 'pt-BR';
    await collect(createEngine(deps(client)).translate(j, new AbortController().signal));
    const wire = toWire(three);
    expect(client.requests[0]?.maxOutputTokens).toBe(callBudget(wire, 0) + 256);
    expect(client.requests[0]?.system).toContain('native writer of Brazilian Portuguese');
    expect(client.requests[0]?.system).toContain('from Japanese into Brazilian Portuguese');
    expect(client.requests[0]?.system).toContain('Style mode: Faithful');
  });

  it('the system block is identical for every chunk of a document (the caching prefix)', async () => {
    const client = translatorClient();
    const j = job(three, { chunkTokens: 1 }); // each segment is its own chunk
    const events = await collect(createEngine(deps(client)).translate(j, new AbortController().signal));
    expect(client.requests).toHaveLength(3);
    expect(new Set(client.requests.map((r) => r.system)).size).toBe(1);
    // Local ids restart at 1 per chunk; the events carry the document's ids.
    expect(client.requests.map((r) => r.messages[0]?.content)).toEqual(['<seg id="1">One sentence.</seg>', '<seg id="1">Two *sentences* here.</seg>', '<seg id="1">Three.</seg>']);
    expect(finals(events).map(([id, text]) => [id, text])).toEqual([['a', 'vi:One sentence.'], ['b', 'vi:Two *sentences* here.'], ['c', 'vi:Three.']]);
  });

  it('a repair call carries only the re-requested segments, with their original ids and a smaller budget; finals come with attempt 2', async () => {
    const client = translatorClient((lines, call) => {
      if (call === 1) return { text: '<seg id="1">vi:One sentence.</seg>\n<seg id="2">vi:Two *sen', stopReason: 'max_tokens' };
      return echoTranslator(lines);
    });
    const events = await collect(createEngine(deps(client)).translate(job(three), new AbortController().signal));
    expect(client.requests).toHaveLength(2);
    const [first, repair] = client.requests;
    expect(repair?.messages[0]?.content).toBe('<seg id="2">Two *sentences* here.</seg>\n<seg id="3">Three.</seg>');
    const rest = toWire(three).segments.slice(1);
    expect(repair?.maxOutputTokens).toBe(callBudget(toWire(rest), 0));
    expect(repair?.maxOutputTokens ?? Infinity).toBeLessThan(first?.maxOutputTokens ?? 0);
    expect(repair?.system).toBe(first?.system);
    expect(finals(events)).toEqual([['a', 'vi:One sentence.', 1], ['b', 'vi:Two *sentences* here.', 2], ['c', 'vi:Three.', 2]]);
    expect(failures(events)).toEqual([]);
    expect(events.filter((e) => e.type === 'usage')).toHaveLength(2);
  });

  it('a chunk with literal tags is sent with a nonce; an answer that echoes it is accepted', async () => {
    const literal = [seg('a', 'Plain.'), seg('b', 'Write <seg id="2"> to open a segment.'), seg('c', 'End.')];
    const client = translatorClient();
    const events = await collect(createEngine(deps(client)).translate(job(literal), new AbortController().signal));
    const wire = toWire(literal);
    expect(wire.grammar).toBe('v2');
    const n = wire.nonce ?? '';
    expect(client.requests[0]?.messages[0]?.content).toBe(`<seg id="1" n="${n}">Plain.</seg>\n<seg id="2" n="${n}">Write <seg id="2"> to open a segment.</seg>\n<seg id="3" n="${n}">End.</seg>`);
    expect(finals(events)).toEqual([['a', 'vi:Plain.', 1], ['b', 'vi:Write <seg id="2"> to open a segment.', 1], ['c', 'vi:End.', 1]]);
  });

  it('a model that drops the nonce is still read in the lenient mode (M1-D11), in one call', async () => {
    const literal = [seg('a', 'Plain.'), seg('b', 'Write <seg id="2"> to open a segment.')];
    const client = translatorClient((lines) => renderLines(lines.map((l): WireLine => ({ n: l.n, source: l.source })), (s) => `vi:${s}`));
    const events = await collect(createEngine(deps(client)).translate(job(literal), new AbortController().signal));
    expect(client.requests).toHaveLength(1);
    expect(finals(events)).toEqual([['a', 'vi:Plain.', 1], ['b', 'vi:Write <seg id="2"> to open a segment.', 1]]);
    expect(failures(events)).toEqual([]);
  });

  it('only translate: true segments are sent; code blocks get no event', async () => {
    const segments = [seg('a', 'Text.'), seg('code', 'let x = 1;', { kind: 'code', translate: false }), seg('b', 'More.')];
    expect(translatable(segments)).toEqual(['a', 'b']);
    const client = translatorClient();
    const events = await collect(createEngine(deps(client)).translate(job(segments), new AbortController().signal));
    expect(client.requests[0]?.messages[0]?.content).toBe('<seg id="1">Text.</seg>\n<seg id="2">More.</seg>');
    expect(events.filter((e) => 'id' in e && e.id === 'code')).toEqual([]);
    expect(finals(events).map(([id]) => id)).toEqual(['a', 'b']);
  });

  it('a stream error after the pipeline\'s retries fails the chunk\'s segments with that error: one retry owner, 1 + maxRetries attempts', async () => {
    const client = fakeClient([[rateLimited(2000)]]);
    const sleep = fakeSleep();
    const events = await collect(createEngine(deps(client, sleep)).translate(job(three), new AbortController().signal));
    expect(client.requests).toHaveLength(DEFAULT_RETRY_POLICY.maxRetries + 1);
    expect(sleep.delays).toEqual(Array(DEFAULT_RETRY_POLICY.maxRetries).fill(2000));
    expect(failures(events).map(([id, kind]) => [id, kind])).toEqual([['a', 'rate_limit'], ['b', 'rate_limit'], ['c', 'rate_limit']]);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('an abort propagates as the signal\'s reason', async () => {
    const controller = new AbortController();
    const client = translatorClient((lines) => {
      controller.abort(new Error('user cancelled'));
      return echoTranslator(lines);
    });
    await expect(collect(createEngine(deps(client)).translate(job(three), controller.signal))).rejects.toThrow('user cancelled');
  });
});

describe('single-pass: stage events and the cache key (M1-E4 plumbing)', () => {
  it('the translate stage\'s start event carries promptId translate@1; the others carry no info', async () => {
    const events = await collect(createEngine(deps(translatorClient())).translate(job(three), new AbortController().signal));
    const stages = events.filter((e) => e.type === 'stage');
    expect(stages).toEqual([
      { type: 'stage', stage: 'chunk', status: 'start' },
      { type: 'stage', stage: 'chunk', status: 'done' },
      { type: 'stage', stage: 'translate', status: 'start', info: { promptId: 'translate@1' } },
      { type: 'stage', stage: 'translate', status: 'done' },
      { type: 'stage', stage: 'check', status: 'start' },
      { type: 'stage', stage: 'check', status: 'done' },
    ]);
    expect(Object.keys(stages[0] ?? {})).not.toContain('info');
  });

  it('the cache key names the strategy, its version and the prompt', () => {
    expect(SINGLE_PASS_CACHE_KEY).toEqual({ strategy: 'single-pass', version: 1, promptId: 'translate@1' });
    expect(singlePass.id).toBe('single-pass');
    expect(singlePass.version).toBe(1);
  });
});

describe('single-pass: budget', () => {
  it('an exhausted budget fails every segment of a chunk with BUDGET_MESSAGE without a call', async () => {
    const client = translatorClient();
    const events = await collect(createEngine(deps(client)).translate(job(three, { budget: { maxTokens: 0 } }), new AbortController().signal));
    expect(client.requests).toEqual([]);
    expect(failures(events)).toEqual([['a', 'unknown', BUDGET_MESSAGE], ['b', 'unknown', BUDGET_MESSAGE], ['c', 'unknown', BUDGET_MESSAGE]]);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('a budget spent by the first chunk stops the next one (sequential chunks)', async () => {
    const client = translatorClient(); // usage 10 input + 5 output per segment: one chunk spends 15
    const j = job(three, { chunkTokens: 1, maxConcurrency: 1, budget: { maxTokens: 12 } });
    const events = await collect(createEngine(deps(client)).translate(j, new AbortController().signal));
    expect(client.requests).toHaveLength(1);
    expect(finals(events).map(([id]) => id)).toEqual(['a']);
    expect(failures(events)).toEqual([['b', 'unknown', BUDGET_MESSAGE], ['c', 'unknown', BUDGET_MESSAGE]]);
  });
});

describe('single-pass: check stage (count only) and the strategy\'s summary', () => {
  it('counts the segments sent, final and failed', async () => {
    const { summary } = await runDirect(job(three), translatorClient());
    expect(summary).toEqual({ segments: 3, final: 3, failed: 0, unaccounted: [] });
  });

  it('fails a segment the translate stage left unaccounted (should not happen) with UNCHECKED_MESSAGE', async () => {
    const check = SINGLE_PASS_STAGES.slice(2);
    const outcomes: ChunkOutcome[] = [{ index: 0, ids: ['a', 'b', 'c'], final: ['a'], failed: ['c'] }];
    const ctx: StageContext = { llm: () => translatorClient(), memory: createWorkingMemory(), context: [], prompts: createDefaultPromptRegistry(), budget: createBudget({}, () => 0), signal: new AbortController().signal };
    const events: EngineEvent[] = [];
    const gen = runStages(check, outcomes, ctx, { concurrency: 1 });
    let summary: unknown;
    for (;;) {
      const r = await gen.next();
      if (r.done === true) {
        summary = r.value;
        break;
      }
      events.push(r.value);
    }
    expect(failures(events)).toEqual([['b', 'unknown', UNCHECKED_MESSAGE]]);
    expect(summary).toEqual({ segments: 3, final: 1, failed: 2, unaccounted: ['b'] });
  });
});

describe('single-pass: working memory after a failed repair (carry-over b)', () => {
  // Call 1 answers segment 1 twice (ambiguous → the plan re-requests the whole chunk, but
  // segment 1 was already shown as final); the repair then never returns segment 1.
  const ambiguous = (lines: WireLine[], call: number) =>
    call === 1
      ? '<seg id="1">vi:One sentence.</seg><seg id="1">again</seg><seg id="2">vi:Two.</seg><seg id="3">vi:Three.</seg>'
      : renderLines(
          lines.filter((l) => l.n !== 1),
          (s) => `vi2:${s}`,
        );

  it('through the engine: a final that is later failed is removed from memory; the others stay', async () => {
    const seen: WorkingMemory['translated'][] = [];
    const probe = defineStage<unknown, never>({
      id: 'probe',
      scope: 'document',
      async *run(_in, ctx) {
        seen.push(new Map(ctx.memory.translated));
        yield* [];
      },
    });
    const strategy = defineStrategy({ id: 'single-pass', version: 1, stages: [...SINGLE_PASS_STAGES, probe] });
    const client = translatorClient(ambiguous);
    const engine = createEngine({ ...deps(client), strategies: [strategy] });
    const events = await collect(engine.translate(job(three), new AbortController().signal));
    expect(finals(events)).toEqual([['a', 'vi:One sentence.', 1], ['b', 'vi:Two.', 1], ['c', 'vi:Three.', 1], ['b', 'vi2:Two *sentences* here.', 2], ['c', 'vi2:Three.', 2]]);
    expect(failures(events)).toEqual([['a', 'unknown', UNREADABLE_MESSAGE]]);
    expect(seen).toHaveLength(1);
    expect([...(seen[0] ?? new Map()).entries()]).toEqual([['b', { text: 'vi2:Two *sentences* here.', revision: 1 }], ['c', { text: 'vi2:Three.', revision: 1 }]]);
  });

  it('directly: only this strategy\'s revision is dropped; a later stage\'s revision is kept', async () => {
    const draft = createWorkingMemory();
    draft.translated.set('a', { text: 'old draft', revision: 1 });
    const { ctx: c1 } = await runDirect(job(three), translatorClient(ambiguous), { memory: draft });
    expect(c1.memory.translated.has('a')).toBe(false);

    const refined = createWorkingMemory();
    refined.translated.set('a', { text: 'refined', revision: 2 });
    const { ctx: c2 } = await runDirect(job(three), translatorClient(ambiguous), { memory: refined });
    expect(c2.memory.translated.get('a')).toEqual({ text: 'refined', revision: 2 });
  });
});
