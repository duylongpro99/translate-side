import { describe, expect, it } from 'vitest';
import type { LLMClient, ModelRole, NormalizedEvent } from '../../llm/types.ts';
import { createEngine } from '../engine.ts';
import { ANALYZE_EXCERPT_TOKENS, ANALYZE_PROMPT_ID, analyzeExcerpt, analyzeInput } from '../prompts/analyze.ts';
import { createDefaultPromptRegistry } from '../prompts/index.ts';
import { ANALYZE_MAX_OUTPUT_TOKENS, briefCacheKey } from '../stages/analyze.ts';
import { fakeClient, fakeSleep, failed, success, translatorClient, type FakeClient } from '../testing.ts';
import { estimateTokens } from '../tokens.ts';
import type { EngineEvent, Segment, TranslationJob } from '../types.ts';
import { CONTEXTUAL_ID, contextual } from './contextual.ts';
import { singlePass } from './single-pass.ts';

const seg = (id: string, text: string, over: Partial<Segment> = {}): Segment => ({ id, kind: 'p', text, inlineMarkup: text, domPath: `p[${id}]`, translate: true, ...over });
const segments = [seg('h', 'Futures are lazy', { kind: 'heading', level: 1 }), seg('a', 'One sentence.'), seg('b', 'Two sentences here.'), seg('c', 'fn main() {}', { kind: 'code', translate: false })];

function job(over: Partial<TranslationJob['doc']> = {}, strategy = CONTEXTUAL_ID, budget?: TranslationJob['options']['budget']): TranslationJob {
  return {
    doc: { url: 'https://example.com/futures', title: 'Lazy futures', sourceLang: 'en', targetLang: 'vi', outline: ['Futures are lazy'], segments, ...over },
    priority: [],
    strategy,
    options: { style: 'natural', glossary: [], maxConcurrency: 2, chunkTokens: 1200, ...(budget ? { budget } : {}) },
  };
}

const BRIEF = { language: 'en', genre: 'technical blog post', audience: 'Rust developers', purpose: 'explain lazy futures', tone: 'conversational', glossary: [{ term: 'future', rendering: 'future', note: 'keep English' }] };

function run(analyze: LLMClient | (() => never), translate: FakeClient = translatorClient(), j = job()) {
  const engine = createEngine({
    llm: (role: ModelRole) => (role === 'analyze' ? (typeof analyze === 'function' ? analyze() : analyze) : translate),
    now: () => 0,
    sleep: fakeSleep(),
    strategies: [singlePass, contextual],
    prompts: createDefaultPromptRegistry(),
    random: () => 0,
  });
  return collect(engine.translate(j, new AbortController().signal));
}

async function collect(stream: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const artifacts = (events: EngineEvent[]) => events.filter((e) => e.type === 'artifact');
const finals = (events: EngineEvent[]) => events.flatMap((e) => (e.type === 'segment.final' ? [e] : []));
const noFailures = (events: EngineEvent[]) => expect(events.filter((e) => e.type === 'segment.failed')).toEqual([]);

describe('contextual: analyze → chunk → translate → check', () => {
  it('emits the brief as an artifact before any segment, then translates every segment as contextual', async () => {
    const analyze = fakeClient([success(JSON.stringify(BRIEF))], { model: 'brief-model' });
    const events = await run(analyze);
    expect(artifacts(events)).toEqual([{ type: 'artifact', kind: 'brief', data: BRIEF }]);
    const firstSeg = events.findIndex((e) => e.type.startsWith('segment.'));
    expect(events.findIndex((e) => e.type === 'artifact')).toBeLessThan(firstSeg);
    expect(events.filter((e) => e.type === 'stage' && e.status === 'start').map((e) => e.type === 'stage' && [e.stage, e.info])).toEqual([
      ['analyze', { promptId: ANALYZE_PROMPT_ID }],
      ['chunk', undefined],
      ['translate', { promptId: 'translate@1' }],
      ['check', undefined],
    ]);
    expect(finals(events).map((e) => [e.id, e.text, e.producedBy.strategy])).toEqual([
      ['h', 'vi:Futures are lazy', 'contextual'],
      ['a', 'vi:One sentence.', 'contextual'],
      ['b', 'vi:Two sentences here.', 'contextual'],
    ]);
    expect(events).toContainEqual({ type: 'usage', role: 'analyze', model: 'brief-model', input: 10, output: 5 });
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('sends the title, outline and excerpt as data, with analyze@1 as the system block and no jsonMode', async () => {
    const analyze = fakeClient([success(JSON.stringify(BRIEF))], { reasoningReserveTokens: 100 });
    await run(analyze);
    expect(analyze.requests).toHaveLength(1);
    const req = analyze.requests[0];
    expect(req?.system).toBe(createDefaultPromptRegistry().get('analyze@1').render({ TARGET_LANG: 'Vietnamese' }));
    expect(req?.messages).toEqual([{ role: 'user', content: analyzeInput(job().doc, segments) }]);
    expect(req?.messages[0]?.content).toBe('<document>\n<title>Lazy futures</title>\n<outline>\n- Futures are lazy\n</outline>\n<excerpt>\nFutures are lazy\n\nOne sentence.\n\nTwo sentences here.\n\nfn main() {}\n</excerpt>\n</document>');
    expect(req?.jsonMode).toBeUndefined();
    expect(req?.maxOutputTokens).toBe(ANALYZE_MAX_OUTPUT_TOKENS + 100);
  });

  it('accepts a fenced or prose-wrapped brief', async () => {
    const fenced = await run(fakeClient([success(`Here you go:\n\`\`\`json\n${JSON.stringify(BRIEF)}\n\`\`\``)]));
    expect(artifacts(fenced)).toEqual([{ type: 'artifact', kind: 'brief', data: BRIEF }]);
  });

  const noBrief: [string, () => LLMClient | (() => never)][] = [
    ['invalid JSON', () => fakeClient([success('{"genre": "blog", ')])],
    ['prose only', () => fakeClient([success('This is a blog post about futures.')])],
    ['a cut answer (max_tokens) even if it parses', () => fakeClient([[{ type: 'text', delta: JSON.stringify(BRIEF) }, { type: 'done', stopReason: 'max_tokens' }]])],
    ['a stream error after retries', () => fakeClient([[failed({ kind: 'bad_request', status: 400, message: 'nope' })]])],
    ['a client that throws', () => ({ model: 'x', reasoningReserveTokens: 0, stream: () => { throw new Error('boom'); } }) as LLMClient],
    ['no model routed for analyze', () => () => { throw new Error('no model profile is routed for the analyze role'); }],
    ['a stream with no terminal event', () => fakeClient([[{ type: 'text', delta: JSON.stringify(BRIEF) } satisfies NormalizedEvent]])],
  ];
  for (const [name, make] of noBrief) {
    it(`goes on without a brief on ${name}`, async () => {
      const events = await run(make());
      expect(artifacts(events)).toEqual([]);
      noFailures(events);
      expect(finals(events).map((e) => e.id)).toEqual(['h', 'a', 'b']);
      expect(events.at(-1)).toEqual({ type: 'done' });
    });
  }

  it('skips the brief call once the budget is exhausted', async () => {
    const analyze = fakeClient([success(JSON.stringify(BRIEF))]);
    const engine = createEngine({ llm: (r) => (r === 'analyze' ? analyze : translatorClient()), now: () => 0, sleep: fakeSleep(), strategies: [contextual], prompts: createDefaultPromptRegistry() });
    await collect(engine.translate(job({}, CONTEXTUAL_ID, { maxTokens: 0 }), new AbortController().signal));
    expect(analyze.requests).toHaveLength(0);
  });

  it('stops on an abort during the brief call (no fallback)', async () => {
    const ac = new AbortController();
    const analyze: LLMClient = {
      model: 'x',
      reasoningReserveTokens: 0,
      async *stream(req) {
        ac.abort(new DOMException('cancelled', 'AbortError'));
        await Promise.resolve();
        req.signal.throwIfAborted();
        yield { type: 'done', stopReason: 'end' };
      },
    };
    const translate = translatorClient();
    const engine = createEngine({ llm: (r) => (r === 'analyze' ? analyze : translate), now: () => 0, sleep: fakeSleep(), strategies: [contextual], prompts: createDefaultPromptRegistry() });
    await expect(collect(engine.translate(job(), ac.signal))).rejects.toThrow('cancelled');
    expect(translate.requests).toHaveLength(0);
  });

  it('takes the source language from the brief only when the job has none', async () => {
    const unknown = translatorClient();
    await run(fakeClient([success(JSON.stringify({ ...BRIEF, language: 'de' }))]), unknown, job({ sourceLang: '' }));
    expect(unknown.requests[0]?.system).toContain('from German into Vietnamese');
    const known = translatorClient();
    await run(fakeClient([success(JSON.stringify({ ...BRIEF, language: 'de' }))]), known, job({ sourceLang: 'en' }));
    expect(known.requests[0]?.system).toContain('from English into Vietnamese');
    const none = translatorClient();
    await run(fakeClient([success('not json')]), none, job({ sourceLang: '' }));
    expect(none.requests[0]?.system).toContain('from the source language into Vietnamese');
  });

  it('leaves single-pass as it was: no brief call, single-pass finals', async () => {
    const analyze = fakeClient([success(JSON.stringify(BRIEF))]);
    const events = await run(analyze, translatorClient(), job({}, 'single-pass'));
    expect(analyze.requests).toHaveLength(0);
    expect(artifacts(events)).toEqual([]);
    expect(new Set(finals(events).map((e) => e.producedBy.strategy))).toEqual(new Set(['single-pass']));
  });
});

describe('analyze excerpt and brief cache key', () => {
  it('takes whole segments up to ~1,500 tokens and cuts a first segment that is longer', () => {
    const para = 'word '.repeat(300).trim(); // ~429 tokens
    const many = Array.from({ length: 10 }, (_, i) => seg(String(i), para));
    const excerpt = analyzeExcerpt(many);
    expect(excerpt.split('\n\n')).toHaveLength(3);
    expect(estimateTokens(excerpt)).toBeLessThanOrEqual(ANALYZE_EXCERPT_TOKENS + 2);
    const huge = analyzeExcerpt([seg('x', 'a'.repeat(20_000)), seg('y', 'next')]);
    expect(huge).toHaveLength(5250);
    expect(analyzeExcerpt([seg('e', '  '), seg('f', 'kept')])).toBe('kept');
  });

  it('keys the brief by url, content sent, target language and analyze prompt version', () => {
    const doc = job().doc;
    const key = briefCacheKey(doc, segments);
    expect(briefCacheKey({ ...doc }, [...segments])).toBe(key);
    expect(JSON.parse(key)).toEqual([doc.url, expect.any(String), 'vi', 'analyze@1']);
    expect(briefCacheKey({ ...doc, url: 'https://example.com/other' }, segments)).not.toBe(key);
    expect(briefCacheKey({ ...doc, targetLang: 'de' }, segments)).not.toBe(key);
    expect(briefCacheKey({ ...doc, title: 'Other' }, segments)).not.toBe(key);
    expect(briefCacheKey(doc, [...segments, seg('z', 'more')])).not.toBe(key);
    expect(briefCacheKey(doc, segments, 'analyze@2')).not.toBe(key);
    // Text past the excerpt is not sent, so it does not change the key.
    const long = Array.from({ length: 20 }, (_, i) => seg(String(i), 'word '.repeat(300)));
    expect(briefCacheKey(doc, [...long, seg('tail', 'changed')])).toBe(briefCacheKey(doc, long));
  });
});
