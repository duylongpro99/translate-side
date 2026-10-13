import { describe, expect, it } from 'vitest';
import type { LLMClient, ModelRole, NormalizedRequest } from '../../llm/types.ts';
import { BASIC_SWITCH_STAGE, createEngine } from '../engine.ts';
import * as engineIndex from '../index.ts';
import { ANALYZE_PROMPT_ID } from '../prompts/analyze.ts';
import { createDefaultPromptRegistry } from '../prompts/index.ts';
import { REVIEW_PROMPT_ID } from '../prompts/review.ts';
import { failed, fakeClient, fakeSleep, rateLimited, renderLines, success, translatorClient, wireLines, type FakeClient } from '../testing.ts';
import type { EngineEvent, ReviewReport, Segment, TranslationJob } from '../types.ts';
import { CONTEXTUAL_ID, CONTEXTUAL_TRANSLATE_PROMPT_ID, REVISED_REVISION, contextual } from './contextual.ts';
import { DRAFTS_STAGE, REFINE_CACHE_KEY, REFINE_ID, REFINE_VERSION, REVIEWED_REVISION, createRefine, refine } from './refine.ts';

const seg = (id: string, text: string, over: Partial<Segment> = {}): Segment => ({ id, kind: 'p', text, inlineMarkup: text, domPath: `p[${id}]`, translate: true, ...over });
const segments = [seg('h', 'Futures are lazy', { kind: 'heading', level: 1 }), seg('a', 'One sentence.'), seg('b', 'Two sentences here.'), seg('c', 'fn main() {}', { kind: 'code', translate: false })];

/** Small enough that `segments` is more than one chunk, so the analyze call and chunk 0's revise pass run. */
const JOB_CHUNK_TOKENS = 8;

function job(over: Partial<TranslationJob> = {}, options: Partial<TranslationJob['options']> = {}): TranslationJob {
  return {
    doc: { url: 'https://example.com/futures', title: 'Lazy futures', sourceLang: 'en', targetLang: 'vi', outline: ['Futures are lazy'], segments },
    priority: [],
    strategy: REFINE_ID,
    options: { style: 'natural', glossary: [], maxConcurrency: 2, chunkTokens: JOB_CHUNK_TOKENS, ...options },
    ...over,
  };
}

const BRIEF = { language: 'en', genre: 'technical blog post', audience: 'Rust developers', purpose: 'explain lazy futures', tone: 'conversational', glossary: [] };

/** Reads the drafts of a review request back (stages/review.ts reviewInput). */
const drafts = (req: NormalizedRequest) => [...(req.messages[0]?.content ?? '').matchAll(/<item id="(\d+)">\n<source>(.*)<\/source>\n<translation>(.*)<\/translation>/g)].map((m) => ({ n: Number(m[1]), source: m[2] ?? '', draft: m[3] ?? '' }));

/** A reviewer that rewrites every draft `vi:` → `vi+:` (a change that passes every post-check). */
function reviewer(options: { hold?: Promise<void> } = {}): FakeClient & { started: number } {
  const requests: NormalizedRequest[] = [];
  const client = {
    model: 'review-model',
    reasoningReserveTokens: () => 0,
    requests,
    started: 0,
    async *stream(req: NormalizedRequest) {
      requests.push(req);
      client.started++;
      if (options.hold) {
        await new Promise<void>((resolve, reject) => {
          req.signal.addEventListener('abort', () => reject(req.signal.reason), { once: true });
          void options.hold?.then(resolve);
        });
      }
      const text = drafts(req).map((d) => `<seg id="${d.n}">${d.draft.replace(/^vi:/, 'vi+:')}</seg>`).join('\n');
      yield { type: 'text' as const, delta: text };
      yield { type: 'usage' as const, input: 30, output: 12 };
      yield { type: 'done' as const, stopReason: 'end' as const };
    },
  };
  return client;
}

interface Clients {
  analyze?: LLMClient;
  translate?: FakeClient;
  review?: LLMClient;
}

function engineWith(clients: Clients = {}) {
  const analyze = clients.analyze ?? fakeClient([success(JSON.stringify(BRIEF))], { model: 'brief-model' });
  const translate = clients.translate ?? translatorClient();
  const review = clients.review ?? reviewer();
  return createEngine({
    llm: (role: ModelRole) => (role === 'analyze' ? analyze : role === 'review' ? review : translate),
    now: () => 0,
    sleep: fakeSleep(),
    strategies: [contextual, refine],
    prompts: createDefaultPromptRegistry(),
    random: () => 0,
  });
}

async function collect(stream: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const run = (j: TranslationJob, clients: Clients = {}, signal = new AbortController().signal) => collect(engineWith(clients).translate(j, signal));

const finals = (events: EngineEvent[]) => events.flatMap((e) => (e.type === 'segment.final' ? [e] : []));
const reports = (events: EngineEvent[]) => events.flatMap((e) => (e.type === 'chunk' && e.review ? [e.review] : []));
const noFailures = (events: EngineEvent[]) => expect(events.filter((e) => e.type === 'segment.failed')).toEqual([]);
const at = (events: EngineEvent[], test: (e: EngineEvent) => boolean) => events.findIndex(test);
const lastAt = (events: EngineEvent[], test: (e: EngineEvent) => boolean) => events.length - 1 - [...events].reverse().findIndex(test);
const isDrafts = (e: EngineEvent) => e.type === 'stage' && e.stage === DRAFTS_STAGE;

describe('refine: contextual draft, then review', () => {
  it('drafts as contextual, announces the drafts, then replaces them with reviewed revisions', async () => {
    const review = reviewer();
    const events = await run(job(), { review });
    noFailures(events);
    const drafted = finals(events).filter((e) => e.revision < REVIEWED_REVISION);
    expect(new Set(drafted.map((e) => e.producedBy.strategy))).toEqual(new Set([CONTEXTUAL_ID]));
    const reviewed = finals(events).filter((e) => e.revision === REVIEWED_REVISION);
    expect(reviewed.map((e) => [e.id, e.text, e.producedBy])).toEqual(
      expect.arrayContaining([
        ['h', 'vi+:Futures are lazy', { strategy: REFINE_ID, stage: 'review', model: 'review-model' }],
        ['a', 'vi+:One sentence.', { strategy: REFINE_ID, stage: 'review', model: 'review-model' }],
        ['b', 'vi+:Two sentences here.', { strategy: REFINE_ID, stage: 'review', model: 'review-model' }],
      ]),
    );
    expect(reviewed).toHaveLength(3);
    // The drafts event comes after the whole contextual run (its check stage included) and before any review.
    const draftsAt = at(events, isDrafts);
    expect(events[draftsAt]).toEqual({ type: 'stage', stage: DRAFTS_STAGE, status: 'done' });
    expect(lastAt(events, (e) => e.type === 'stage' && e.stage === 'check')).toBeLessThan(draftsAt);
    expect(lastAt(events, (e) => e.type === 'segment.final' && e.revision < REVIEWED_REVISION)).toBeLessThan(draftsAt);
    expect(at(events, (e) => e.type === 'stage' && e.stage === 'review' && e.status === 'start')).toBeGreaterThan(draftsAt);
    expect(at(events, (e) => e.type === 'segment.final' && e.revision === REVIEWED_REVISION)).toBeGreaterThan(draftsAt);
    expect(events).toContainEqual({ type: 'usage', role: 'review', model: 'review-model', input: 30, output: 12 });
    expect(reports(events).flatMap((r) => r.accepted).sort()).toEqual(['a', 'b', 'h']);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('chunk 0\'s revise pass (revision 2) lands before any reviewed revision, and the review sees it', async () => {
    const review = reviewer();
    const events = await run(job(), { review });
    const revised = at(events, (e) => e.type === 'segment.final' && e.revision === REVISED_REVISION);
    expect(revised).toBeGreaterThanOrEqual(0);
    expect(revised).toBeLessThan(at(events, (e) => e.type === 'segment.final' && e.revision === REVIEWED_REVISION));
    // The draft each review call sent is the latest text, revision 2 where there is one.
    const revisedFinal = events[revised] as EngineEvent & { type: 'segment.final' };
    expect(review.requests.flatMap(drafts).map((d) => d.draft)).toContain(revisedFinal.text);
  });

  it('with the budget spent by the drafts: no review call, every chunk skipped, and otherwise the events of contextual', async () => {
    const probe = await run({ ...job(), strategy: CONTEXTUAL_ID });
    const spent = probe.reduce((n, e) => n + (e.type === 'usage' ? e.input + e.output : 0), 0);
    const budget = { maxTokens: spent };
    const review = reviewer();
    const balanced = await run({ ...job({}, { budget }), strategy: CONTEXTUAL_ID });
    const best = await run(job({}, { budget }), { review });
    expect(review.requests).toHaveLength(0);
    expect(reports(best).length).toBeGreaterThan(0);
    expect(reports(best).every((r) => r.skipped === 'budget' && r.accepted.length + r.unchanged.length + r.rejected.length === 0)).toBe(true);
    expect(reports(best).flatMap((r) => r.ids).sort()).toEqual(['a', 'b', 'h']);
    noFailures(best);
    const withoutReview = best.filter((e) => !(e.type === 'chunk' && e.review) && !isDrafts(e));
    expect(withoutReview).toEqual(balanced);
  });

  it('reviews the drafts a job brings without drafting them again', async () => {
    const translate = translatorClient();
    const review = reviewer();
    const brought = new Map([
      ['h', { text: 'vi:cached heading', revision: 1 }],
      ['a', { text: 'vi:cached sentence.', revision: 2 }],
    ]);
    const events = await run(job({ drafts: brought }), { translate, review });
    noFailures(events);
    // Contextual drafted only b.
    expect(translate.requests.flatMap((r) => wireLines(r.messages[0]?.content ?? '')).map((l) => l.source)).toEqual(['Two sentences here.']);
    expect(finals(events).filter((e) => e.revision < REVIEWED_REVISION).map((e) => e.id)).toEqual(['b']);
    // The review covers all three, the brought drafts as given.
    const sent = review.requests.flatMap(drafts).map((d) => d.draft).sort();
    expect(sent).toEqual(['vi:Two sentences here.', 'vi:cached heading', 'vi:cached sentence.']);
    expect(finals(events).filter((e) => e.revision === REVIEWED_REVISION).map((e) => e.text).sort()).toEqual(['vi+:Two sentences here.', 'vi+:cached heading', 'vi+:cached sentence.']);
  });

  it('reviews only the segments that have a draft: one contextual failed stays out of the review', async () => {
    const translate = translatorClient((lines) => renderLines(lines.filter((l) => l.source !== 'Two sentences here.'), (s) => `vi:${s}`));
    const review = reviewer();
    const events = await run(job(), { translate, review });
    expect(events.filter((e) => e.type === 'segment.failed').map((e) => e.id)).toEqual(['b']);
    expect(review.requests.flatMap(drafts).map((d) => d.source)).not.toContain('Two sentences here.');
    expect(reports(events).flatMap((r) => r.ids).sort()).toEqual(['a', 'h']);
  });

  it('ignores brought drafts of segments it does not translate or does not know', async () => {
    const translate = translatorClient();
    const review = reviewer();
    const brought = new Map([
      ['c', { text: 'code', revision: 1 }],
      ['zz', { text: 'nothing', revision: 1 }],
    ]);
    const events = await run(job({ drafts: brought }), { translate, review });
    expect(finals(events).some((e) => e.id === 'c' || e.id === 'zz')).toBe(false);
    expect(review.requests.flatMap(drafts).map((d) => d.source)).not.toContain('fn main() {}');
  });

  it.each([
    ['retries exhausted', () => fakeClient([[{ type: 'usage', input: 4, output: 0 }, rateLimited()]], { model: 'review-model' }), 'rate_limit', 16],
    ['a non-retryable error', () => fakeClient([[{ type: 'usage', input: 4, output: 0 }, failed({ kind: 'auth', status: 401, message: 'bad key' })]], { model: 'review-model' }), 'auth', 4],
  ] as const)('a review call that fails (%s): drafts kept, no failure, usage recorded', async (_name, make, kind, input) => {
    const events = await run(job(), { review: make() });
    noFailures(events);
    expect(finals(events).every((e) => e.revision < REVIEWED_REVISION)).toBe(true);
    expect(new Set(finals(events).map((e) => e.id))).toEqual(new Set(['h', 'a', 'b']));
    expect(reports(events).every((r) => r.skipped === 'error' && r.error === kind)).toBe(true);
    expect(events.filter((e) => e.type === 'usage' && e.role === 'review').every((e) => e.type === 'usage' && e.input === input)).toBe(true);
  });

  it('with the basic fallback on, a provider that dies during the review never switches the job', async () => {
    const review = fakeClient([[rateLimited()]], { model: 'review-model' });
    const events = await run(job({}, { basicFallback: true }), { review });
    noFailures(events);
    expect(events.some((e) => e.type === 'stage' && e.stage === BASIC_SWITCH_STAGE)).toBe(false);
    expect(new Set(finals(events).map((e) => e.id))).toEqual(new Set(['h', 'a', 'b']));
    expect(reports(events).every((r) => r.skipped === 'error')).toBe(true);
  });

  it('a job that no longer wants reviews makes no review call', async () => {
    const review = reviewer();
    const events = await run(job({ reviewWanted: () => false }), { review });
    expect(review.requests).toHaveLength(0);
    expect(reports(events).map((r) => r.skipped)).toEqual(['dropped', 'dropped', 'dropped']);
  });

  it('a job with nothing to translate makes no review stage', async () => {
    const review = reviewer();
    const events = await run(job({ doc: { ...job().doc, segments: [segments[3] as Segment] } }), { review });
    expect(review.requests).toHaveLength(0);
    expect(events.some((e) => e.type === 'stage' && e.stage === 'review')).toBe(false);
    expect(events.filter(isDrafts)).toHaveLength(1);
  });

  it('rethrows the abort reason when stopped mid-review, as the other strategies do', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const review = reviewer({ hold });
    const controller = new AbortController();
    const running = run(job(), { review }, controller.signal);
    for (let i = 0; i < 200 && review.started === 0; i++) await new Promise((r) => setTimeout(r, 0));
    expect(review.started).toBeGreaterThan(0);
    const reason = new Error('stopped by the reader');
    controller.abort(reason);
    release();
    await expect(running).rejects.toBe(reason);
  });

  it('createRefine sends the given prompts', async () => {
    const review = reviewer();
    const translate = translatorClient();
    const engine = createEngine({
      llm: (role) => (role === 'review' ? review : role === 'analyze' ? fakeClient([success(JSON.stringify(BRIEF))]) : translate),
      now: () => 0,
      sleep: fakeSleep(),
      strategies: [createRefine({ translatePrompt: 'translate@1', reviewPrompt: REVIEW_PROMPT_ID })],
      prompts: createDefaultPromptRegistry(),
    });
    const events = await collect(engine.translate(job(), new AbortController().signal));
    expect(events).toContainEqual({ type: 'stage', stage: 'translate', status: 'start', info: { promptId: 'translate@1' } });
    expect(events).toContainEqual({ type: 'stage', stage: 'review', status: 'start', info: { promptId: REVIEW_PROMPT_ID } });
    expect(review.requests.length).toBeGreaterThan(0);
  });

  it('keys the cache by strategy, version and every prompt it sends', () => {
    expect(refine.id).toBe('refine');
    expect(refine.version).toBe(REFINE_VERSION);
    expect(REFINE_CACHE_KEY).toEqual({ strategy: 'refine', version: 1, promptIds: [ANALYZE_PROMPT_ID, CONTEXTUAL_TRANSLATE_PROMPT_ID, 'review@1'] });
  });

  it('is exported from the engine entry point', () => {
    expect(engineIndex.refine).toBe(refine);
    expect(engineIndex.createRefine).toBe(createRefine);
    expect(engineIndex.REFINE_CACHE_KEY).toBe(REFINE_CACHE_KEY);
    expect(engineIndex.REVIEWED_REVISION).toBe(REVIEWED_REVISION);
    expect(engineIndex.REVIEW_PROMPT_ID).toBe(REVIEW_PROMPT_ID);
    expect(engineIndex.PROMPTS).toContain(engineIndex.reviewV1);
    expect(typeof engineIndex.createReviewStage).toBe('function');
    const report: ReviewReport = { ids: [], accepted: [], unchanged: [], rejected: [] };
    expect(report.skipped).toBeUndefined();
  });
});
