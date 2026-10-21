// Best (`refine`) in the panel's jobs: the strategy resolved once per run, the review role routed,
// refined revisions folded in with their draft kept, the cache (refined, reviewed-unchanged and
// draft entries), lazy rounds that do not wait for reviews, and held revisions.
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { REVIEWED_REVISION, type EngineEvent, type Segment } from '@/engine/index';
import { renderLines, translatorClient, wireLines } from '@/engine/testing';
import type { LLMClient, NormalizedRequest } from '@/llm/types';
import { keyScope, openTranslationCache, scopeHash, segmentKey, type TranslationCache } from '@/shared/cache';
import type { JobRecord } from '@/shared/diagnostics';
import { GEMINI_PROFILE } from '@/shared/settings';
import type { ModelProfile } from '@/shared/settings';
import { applySegmentEvent, Jobs, type AnalyzeResult, type ClientResult, type ClientTarget, type JobDeps, type JobDoc, type JobView, type SegState } from './jobs.ts';

// Best is held back from release; these tests exercise it, so they run with the switch on.
vi.mock('@/shared/quality', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/shared/quality')>()), BEST_MODE_RELEASED: true }));

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
function doc(n: number, w = 120, over: Partial<JobDoc> = {}): JobDoc {
  const segments: Segment[] = Array.from({ length: n }, (_, i) => {
    const text = `P${i} ${words(w)}`;
    return { id: `s${i}`, kind: 'p', text, inlineMarkup: text, domPath: `/p[${i + 1}]`, translate: true };
  });
  return { url: 'https://example.com/', title: 'T', sourceLang: 'en', targetLang: 'vi', segments, strategy: 'refine', ...over };
}

const BRIEF = { language: 'en', genre: 'blog post', audience: 'developers', purpose: 'explain', tone: 'dry', glossary: [] };
const REVIEW_PROFILE: ModelProfile = { ...GEMINI_PROFILE, id: 'review-profile', model: 'review-model' };
const isAnalyze = (req: NormalizedRequest) => req.system.startsWith('You prepare a translator');
const isReview = (req: NormalizedRequest) => (req.messages[0]?.content ?? '').startsWith('<review>');
const isTranslate = (req: NormalizedRequest) => !isAnalyze(req) && !isReview(req);
/** The items of a review request (stages/review.ts reviewInput). */
const items = (req: NormalizedRequest) => [...(req.messages[0]?.content ?? '').matchAll(/<item id="(\d+)">\n<source>(.*)<\/source>\n<translation>(.*)<\/translation>/g)].map((m) => ({ n: Number(m[1]), source: m[2] ?? '', draft: m[3] ?? '' }));
/** The paragraph numbers a request carries (translate lines or review items). */
const paragraphs = (req: NormalizedRequest) => (isReview(req) ? items(req).map((i) => i.source) : wireLines(req.messages[0]?.content ?? '').map((l) => l.source)).map((s) => Number(/^P(\d+)/.exec(s)?.[1]));

/** What the reviewer makes of a draft: a candidate, or undefined for "unchanged". */
type Reviewer = (draft: string, n: number) => string | undefined;
const rewrite: Reviewer = (draft) => `rv:${draft}`;

interface TestClient extends LLMClient {
  requests: NormalizedRequest[];
  /** Review calls waiting (with `hold`), in the order they started; `go` lets one answer. */
  waiting: { req: NormalizedRequest; go: () => void }[];
  /** Every call in order: `translate`, `analyze` or `review`. */
  log: string[];
  /** The paragraphs of each translate call, as it started. */
  drafted: number[][];
}

/** One client for every role: drafts are `vi:` + source, the brief is fixed, the review is `reviewer` (or a failed call). */
function client(opts: { model?: string; reviewer?: Reviewer | 'error'; hold?: boolean } = {}): TestClient {
  const inner = translatorClient(
    (lines, _n, req) => {
      if (isAnalyze(req)) return JSON.stringify(BRIEF);
      if (!isReview(req)) return renderLines(lines, (s) => `vi:${s}`);
      const reviewer = opts.reviewer === 'error' || opts.reviewer === undefined ? rewrite : opts.reviewer;
      const out = items(req).flatMap(({ n, draft }) => {
        const c = reviewer(draft, n);
        return c === undefined ? [] : [`<seg id="${n}">${c}</seg>`];
      });
      return out.length > 0 ? out.join('\n') : '<none/>';
    },
    { model: opts.model ?? GEMINI_PROFILE.model },
  );
  const waiting: TestClient['waiting'] = [];
  const log: string[] = [];
  const drafted: number[][] = [];
  return {
    model: inner.model,
    reasoningReserveTokens: inner.reasoningReserveTokens,
    requests: inner.requests,
    waiting,
    log,
    drafted,
    async *stream(req) {
      log.push(isAnalyze(req) ? 'analyze' : isReview(req) ? 'review' : 'translate');
      if (isTranslate(req)) drafted.push(paragraphs(req));
      if (isReview(req) && opts.reviewer === 'error') {
        inner.requests.push(req);
        await Promise.resolve();
        yield { type: 'error', error: { kind: 'bad_request', status: 400, message: 'review refused' } };
        return;
      }
      if (isReview(req) && opts.hold) {
        await new Promise<void>((resolve, reject) => {
          waiting.push({ req, go: resolve });
          req.signal.addEventListener('abort', () => reject(req.signal.reason), { once: true });
        });
      }
      yield* inner.stream(req);
    },
  };
}

const ok = (c: LLMClient, extra: Partial<Extract<ClientResult, { ok: true }>> = {}) => (): Promise<ClientResult> => Promise.resolve({ ok: true, client: c, profile: GEMINI_PROFILE, ...extra });
const routedReview = (c: LLMClient): (() => Promise<AnalyzeResult | undefined>) => () => Promise.resolve({ ok: true, client: c, profile: REVIEW_PROFILE });
const newCache = () => openTranslationCache({ factory: new IDBFactory() }) as TranslationCache;
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await settle(2);
  }
}
const jobsWith = (deps: JobDeps) => {
  const jobs = new Jobs(deps);
  jobs.setActive(1);
  return jobs;
};
const states = (v: JobView | undefined) => [...(v?.segs.values() ?? [])];
const refinedIds = (v: JobView | undefined) => [...(v?.segs ?? [])].filter(([, s]) => s.refined).map(([id]) => id);

describe('applySegmentEvent: the review revision', () => {
  const by = (stage: string, model = 'm') => ({ strategy: 'refine', stage, model });
  const final = (text: string, revision: number, stage = 'translate', model?: string): EngineEvent => ({ type: 'segment.final', id: 'a', text, revision, producedBy: by(stage, model) });
  const fold = (events: EngineEvent[]) => events.reduce<SegState | undefined>((s, e) => applySegmentEvent(s, e), undefined);

  it('draft (1), revise (2), review (3): the refined text replaces the draft, which is kept, and names its reviewer', () => {
    expect(fold([final('draft', 1)])).toMatchObject({ status: 'final', text: 'draft', revision: 1, model: 'm' });
    expect(fold([final('draft', 1), final('revised', 2)])).toMatchObject({ text: 'revised', revision: 2 });
    const s = fold([final('draft', 1), final('revised', 2), final('reviewed', 3, 'review', 'big')]);
    expect(s).toEqual({ status: 'final', text: 'reviewed', revision: 3, attempt: 1, refined: true, draft: 'revised', reviewModel: 'big' });
    // Not the block's model: no fallback badge.
    expect(s?.model).toBeUndefined();
  });

  it('a rejected review sends nothing: the draft stays; a late draft never replaces the review', () => {
    expect(fold([final('draft', 1), final('revised', 2)])).toMatchObject({ text: 'revised', revision: 2 });
    expect(fold([final('draft', 1), final('reviewed', 3, 'review'), final('draft again', 1)])).toMatchObject({ text: 'reviewed', refined: true });
  });
});

describe('Jobs: the strategy of a run', () => {
  it('a document asking for refine runs it (review calls, refined blocks) when best-mode is available', async () => {
    const c = client();
    const featureAvailable = vi.fn(() => Promise.resolve(true));
    const targets: ClientTarget[] = [];
    const records: JobRecord[] = [];
    const jobs = jobsWith({ translateClient: (t) => (targets.push(t), ok(c)()), featureAvailable, onJobRecord: (r) => records.push(r) });
    await jobs.start(1, 'd', doc(8));
    const v = jobs.get(1);
    expect(v?.status).toBe('done');
    expect(featureAvailable).toHaveBeenCalledWith('best-mode');
    expect(targets[0]).toMatchObject({ analyze: true, review: true });
    expect(c.requests.filter(isReview).length).toBeGreaterThan(0);
    expect(v?.counts).toEqual({ total: 8, final: 8, failed: 0 });
    expect(refinedIds(v)).toHaveLength(8);
    expect(records.at(-1)).toMatchObject({ outcome: 'done', strategy: 'refine', review: { accepted: 8, unchanged: 0, rejected: 0, skipped: 0 } });
  });

  it('without best-mode a refine request runs contextual: the review route is never resolved, no review call', async () => {
    const c = client();
    const records: JobRecord[] = [];
    const review = vi.fn(routedReview(client({ model: 'review-model' })));
    const jobs = jobsWith({ translateClient: ok(c, { review }), featureAvailable: () => Promise.resolve(false), onJobRecord: (r) => records.push(r) });
    await jobs.start(1, 'd', doc(8));
    expect(jobs.get(1)?.counts.final).toBe(8);
    expect(review).not.toHaveBeenCalled();
    expect(c.requests.filter(isReview)).toEqual([]);
    expect(refinedIds(jobs.get(1))).toEqual([]);
    expect(records.map((r) => r.strategy)).toEqual(['contextual', 'contextual']);
    expect(records.at(-1)?.review).toBeUndefined();
  });

  it('a feature check that fails is a no: the run is contextual', async () => {
    const c = client();
    const jobs = jobsWith({ translateClient: ok(c), featureAvailable: () => Promise.reject(new Error('no state')) });
    await jobs.start(1, 'd', doc(8));
    expect(jobs.get(1)?.counts.final).toBe(8);
    expect(c.requests.filter(isReview)).toEqual([]);
  });

  it("the Jobs' own strategy wins over the document's: a selection asking for refine runs single-pass, with no analyze or review call", async () => {
    const c = client();
    const featureAvailable = vi.fn(() => Promise.resolve(true));
    const targets: ClientTarget[] = [];
    const jobs = jobsWith({ strategy: 'single-pass', translateClient: (t) => (targets.push(t), ok(c)()), featureAvailable });
    await jobs.start(1, 'd', doc(8));
    expect(jobs.get(1)?.counts.final).toBe(8);
    expect(c.requests.filter(isAnalyze)).toEqual([]);
    expect(c.requests.filter(isReview)).toEqual([]);
    expect(targets[0]).toEqual({ tabId: 1, url: 'https://example.com/', sourceLang: 'en', targetLang: 'vi', analyze: false });
    expect(featureAvailable).not.toHaveBeenCalled();
  });

  it('a document without a strategy runs Balanced and never asks for the feature', async () => {
    const c = client();
    const featureAvailable = vi.fn(() => Promise.resolve(true));
    const jobs = jobsWith({ translateClient: ok(c), featureAvailable });
    const d = doc(8);
    delete d.strategy;
    await jobs.start(1, 'd', d);
    expect(c.requests.filter(isReview)).toEqual([]);
    expect(c.requests.filter(isAnalyze)).toHaveLength(1);
    expect(featureAvailable).not.toHaveBeenCalled();
  });
});

describe('Jobs: the review role', () => {
  it('goes to its own routed client; its usage is priced with its profile, and its blocks get no fallback badge', async () => {
    const page = client();
    const reviewer = client({ model: 'review-model' });
    const jobs = jobsWith({ translateClient: ok(page, { review: routedReview(reviewer) }) });
    await jobs.start(1, 'd', doc(8));
    const v = jobs.get(1) as JobView;
    expect(page.requests.filter(isReview)).toEqual([]);
    expect(reviewer.requests.length).toBeGreaterThan(0);
    expect(reviewer.requests.every(isReview)).toBe(true);
    for (const s of states(v)) expect(s).toMatchObject({ status: 'final', refined: true, model: GEMINI_PROFILE.model, reviewModel: 'review-model' });
    expect(v.segs.get('s0')?.draft).toBe(`vi:P0 ${words(120)}`);
  });

  it("a review route that can't run makes the run Balanced and says why; nothing fails, and the Balanced cache has it", async () => {
    const cache = newCache();
    const c = client();
    const error = { kind: 'auth' as const, message: 'Add your Review API key in settings' };
    const jobs = jobsWith({ translateClient: ok(c, { review: () => Promise.resolve({ ok: false, error }) }), cache });
    await jobs.start(1, 'd', doc(8));
    await jobs.cacheIdle();
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('done');
    expect(v.reviewUnavailable).toEqual(error);
    expect(v.counts).toEqual({ total: 8, final: 8, failed: 0 });
    expect(c.requests.filter(isReview)).toEqual([]);
    // Stored under Balanced's scope: a Balanced revisit asks nothing.
    const again = client();
    const balanced = jobsWith({ translateClient: ok(again), cache });
    const d = doc(8);
    delete d.strategy;
    await balanced.start(1, 'd2', d);
    expect(again.requests).toEqual([]);
  });

  it('a review call that fails keeps every draft, with no failed block', async () => {
    const c = client({ reviewer: 'error' });
    const records: JobRecord[] = [];
    const jobs = jobsWith({ translateClient: ok(c), onJobRecord: (r) => records.push(r) });
    await jobs.start(1, 'd', doc(8));
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('done');
    expect(v.counts).toEqual({ total: 8, final: 8, failed: 0 });
    expect(refinedIds(v)).toEqual([]);
    expect(states(v).every((s) => s.text?.startsWith('vi:'))).toBe(true);
    expect(records.at(-1)?.review).toEqual({ accepted: 0, unchanged: 0, rejected: 0, skipped: 8 });
  });

  it('rejected candidates keep their drafts: no failed block, no refined marker', async () => {
    // Eight times the draft: it fails the length check.
    const c = client({ reviewer: (draft) => draft.repeat(8) });
    const records: JobRecord[] = [];
    const jobs = jobsWith({ translateClient: ok(c), onJobRecord: (r) => records.push(r) });
    await jobs.start(1, 'd', doc(8));
    const v = jobs.get(1) as JobView;
    expect(v.counts).toEqual({ total: 8, final: 8, failed: 0 });
    expect(refinedIds(v)).toEqual([]);
    expect(records.at(-1)?.review).toEqual({ accepted: 0, unchanged: 0, rejected: 8, skipped: 0 });
  });

  it('a budget the drafts fit in but the review does not: every block final, none failed, none refined', async () => {
    // What the drafts of this page cost (refine drafts exactly as Balanced does).
    const probe = client();
    const balanced = jobsWith({ translateClient: ok(probe) });
    await balanced.start(1, 'd', doc(8, 120, { strategy: 'contextual' }));
    const { input, output } = (balanced.get(1) as JobView).usage;
    const c = client();
    const records: JobRecord[] = [];
    const jobs = jobsWith({ translateClient: ok(c), onJobRecord: (r) => records.push(r) });
    await jobs.start(1, 'd', doc(8, 120, { budgetTokens: input + output + 1 }));
    const v = jobs.get(1) as JobView;
    expect(v.counts).toEqual({ total: 8, final: 8, failed: 0 });
    expect(refinedIds(v)).toEqual([]);
    expect(c.requests.filter(isReview)).toEqual([]);
    expect(records.at(-1)?.review).toEqual({ accepted: 0, unchanged: 0, rejected: 0, skipped: 8 });
  });
});

describe('Jobs: Best and the translation cache', () => {
  it('a reload of a refined page makes no call and shows the markers, with the review on another model', async () => {
    const cache = newCache();
    const reviewer = client({ model: 'review-model' });
    const first = jobsWith({ translateClient: ok(client(), { review: routedReview(reviewer) }), cache });
    await first.start(1, 'd', doc(8));
    await first.cacheIdle();
    expect(refinedIds(first.get(1))).toHaveLength(8);

    const page = client();
    const reviewer2 = client({ model: 'review-model' });
    const second = jobsWith({ translateClient: ok(page, { review: routedReview(reviewer2) }), cache });
    await second.start(1, 'd2', doc(8));
    const v = second.get(1) as JobView;
    expect(page.requests).toEqual([]);
    expect(reviewer2.requests).toEqual([]);
    expect(v.cached).toBe(8);
    expect(v.counts).toEqual({ total: 8, final: 8, failed: 0 });
    // Refined from the cache: the marker, no draft (it is not kept), no fallback badge.
    for (const s of states(v)) expect(s).toEqual({ status: 'final', text: expect.stringMatching(/^rv:vi:/), revision: REVIEWED_REVISION, attempt: 1, refined: true });
  });

  it('a reload after a review that changed nothing makes no call either; the blocks are not marked', async () => {
    const cache = newCache();
    const first = jobsWith({ translateClient: ok(client({ reviewer: () => undefined })), cache });
    await first.start(1, 'd', doc(8));
    await first.cacheIdle();
    expect(refinedIds(first.get(1))).toEqual([]);

    const again = client();
    const second = jobsWith({ translateClient: ok(again), cache });
    await second.start(1, 'd2', doc(8));
    expect(again.requests).toEqual([]);
    expect(second.get(1)?.counts.final).toBe(8);
    expect(refinedIds(second.get(1))).toEqual([]);
    expect(states(second.get(1)).every((s) => s.revision === REVIEWED_REVISION && s.text?.startsWith('vi:'))).toBe(true);
  });

  it('accepted, unchanged and rejected blocks are all final on a reload; nothing is sent', async () => {
    const cache = newCache();
    // Even items rewritten, every third rejected (too long), the rest left as they are.
    const mixed: Reviewer = (draft, n) => (n % 3 === 0 ? draft.repeat(8) : n % 2 === 0 ? `rv:${draft}` : undefined);
    const first = jobsWith({ translateClient: ok(client({ reviewer: mixed })), cache });
    await first.start(1, 'd', doc(8));
    await first.cacheIdle();
    const marked = refinedIds(first.get(1));
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.length).toBeLessThan(8);

    const again = client();
    const second = jobsWith({ translateClient: ok(again), cache });
    await second.start(1, 'd2', doc(8));
    expect(again.requests).toEqual([]);
    expect(refinedIds(second.get(1))).toEqual(marked);
  });

  it('drafts in the cache below the review revision are shown at once and only reviewed, not drafted again', async () => {
    const cache = newCache();
    // The first visit's reviews all fail: its drafts are stored, unreviewed.
    const first = jobsWith({ translateClient: ok(client({ reviewer: 'error' })), cache });
    await first.start(1, 'd', doc(8));
    await first.cacheIdle();

    const c = client();
    // What each update showed (the view's map is live, so it is read as it comes).
    const seen: { status: string; final: number; refined: number }[] = [];
    const second = jobsWith({ translateClient: ok(c), cache });
    second.subscribe((_, v) => v && seen.push({ status: v.status, final: v.counts.final, refined: refinedIds(v).length }));
    await second.start(1, 'd2', doc(8));
    const v = second.get(1) as JobView;
    expect(c.requests.filter(isTranslate)).toEqual([]);
    expect(c.requests.filter(isReview).length).toBeGreaterThan(0);
    expect(refinedIds(v)).toHaveLength(8);
    expect(v.cached).toBe(8);
    // The drafts were shown, as finals, before any review answered.
    expect(seen.find((s) => s.final === 8)).toEqual({ status: 'running', final: 8, refined: 0 });
  });

  it("on a Best miss, Balanced's entries of the page are the drafts", async () => {
    const cache = newCache();
    const balanced = jobsWith({ translateClient: ok(client()), cache });
    await balanced.start(1, 'd', doc(8, 120, { strategy: 'contextual' }));
    await balanced.cacheIdle();

    const c = client();
    const best = jobsWith({ translateClient: ok(c), cache });
    await best.start(1, 'd2', doc(8));
    expect(c.requests.filter(isTranslate)).toEqual([]);
    expect(c.requests.filter(isReview).length).toBeGreaterThan(0);
    expect(refinedIds(best.get(1))).toHaveLength(8);
    await best.cacheIdle();
    // Balanced's entries were left as they were.
    const again = client();
    const balanced2 = jobsWith({ translateClient: ok(again), cache });
    await balanced2.start(1, 'd3', doc(8, 120, { strategy: 'contextual' }));
    expect(again.requests).toEqual([]);
    expect(refinedIds(balanced2.get(1))).toEqual([]);
  });

  it('another "Review with" model is another Best entry: the page is reviewed again', async () => {
    const cache = newCache();
    const first = jobsWith({ translateClient: ok(client(), { review: routedReview(client({ model: 'review-model' })) }), cache });
    await first.start(1, 'd', doc(8));
    await first.cacheIdle();

    const page = client();
    const other = client({ model: 'other-review-model' });
    const second = jobsWith({ translateClient: ok(page, { review: () => Promise.resolve({ ok: true, client: other, profile: { ...REVIEW_PROFILE, id: 'other', model: 'other-review-model' } }) }), cache });
    await second.start(1, 'd2', doc(8));
    // Nothing of the first reviewer's entries is used: the page is drafted (no Balanced entries here) and reviewed again.
    expect(page.requests.filter(isTranslate).length).toBeGreaterThan(0);
    expect(other.requests.length).toBeGreaterThan(0);
    expect(refinedIds(second.get(1))).toHaveLength(8);
    expect(second.get(1)?.segs.get('s0')?.reviewModel).toBe('other-review-model');
  });
});

describe('Jobs: Best in lazy mode', () => {
  /** Lets the held reviews answer until `cond` holds. */
  async function releaseUntil(c: TestClient, cond: () => boolean) {
    for (let i = 0; i < 400 && !cond(); i++) {
      c.waiting.splice(0).forEach((w) => w.go());
      await settle(5);
    }
    if (!cond()) throw new Error('never got there');
  }

  for (const [name, screen] of [
    ['nears the end of the round', ['s20', 's21']],
    ['leaves the round', ['s200', 's201']],
  ] as const) {
    it(`a reader who ${name} once the drafts are done waits only for the reviews in flight`, async () => {
      const c = client({ hold: true });
      const records: JobRecord[] = [];
      const jobs = jobsWith({ translateClient: ok(c), lazyAbove: 50, onJobRecord: (r) => records.push(r) });
      void jobs.start(1, 'd', doc(300, 200));
      await until(() => c.waiting.length === GEMINI_PROFILE.maxConcurrency);
      const reviewsInFlight = c.log.filter((k) => k === 'review').length;
      const roundOne = c.log.length;
      const roundOneDrafts = new Set(c.drafted.flat()).size;
      jobs.setViewport(1, 'd', screen);
      await releaseUntil(c, () => c.log.slice(roundOne).includes('translate'));
      // Between the scroll and the next round's first request, no review started: only those in flight finished.
      expect(c.log.slice(roundOne, c.log.indexOf('translate', roundOne))).toEqual([]);
      expect(reviewsInFlight).toBe(GEMINI_PROFILE.maxConcurrency);
      const round = c.requests.filter(isReview).slice(0, reviewsInFlight).flatMap(paragraphs);
      // The round's window had more chunks to review than were in flight.
      const drafted = new Set(c.requests.filter(isTranslate).flatMap(paragraphs).filter((n) => n < 30));
      expect(drafted.size).toBeGreaterThan(round.length);
      await releaseUntil(c, () => jobs.get(1)?.status === 'done' && jobs.get(1)?.segs.get(screen[0])?.status === 'final');
      // Dropped blocks stay drafts: final, not failed.
      expect(jobs.get(1)?.counts.failed).toBe(0);
      expect(jobs.get(1)?.segs.get('s10')).toMatchObject({ status: 'final' });
      // The first round's record counts every block it drafted: reviewed, or not (dropped, with or without a report).
      const first = records.find((r) => r.outcome === 'done');
      const r = first?.review;
      expect(r?.accepted).toBeGreaterThan(0);
      expect(r?.skipped).toBeGreaterThan(0);
      expect((r?.accepted ?? 0) + (r?.unchanged ?? 0) + (r?.rejected ?? 0) + (r?.skipped ?? 0)).toBe(roundOneDrafts);
    });
  }

  it("Balanced's entries for the whole page: each window the reader reaches has its drafts reviewed, none drafted again", async () => {
    const cache = newCache();
    const balanced = jobsWith({ translateClient: ok(client()), cache, lazyAbove: Infinity });
    await balanced.start(1, 'd', doc(300, 200, { strategy: 'contextual' }));
    await balanced.cacheIdle();
    const c = client();
    const jobs = jobsWith({ translateClient: ok(c), cache, lazyAbove: 50 });
    await jobs.start(1, 'd2', doc(300, 200));
    expect(jobs.get(1)?.counts.final).toBe(300);
    expect(jobs.get(1)?.segs.get('s0')?.refined).toBe(true);
    expect(jobs.get(1)?.segs.get('s80')?.refined).toBeUndefined();
    // The third window: nothing pending there, only drafts to review.
    jobs.setViewport(1, 'd2', ['s80', 's81']);
    await until(() => jobs.get(1)?.status === 'done' && jobs.get(1)?.segs.get('s80')?.refined === true);
    expect(c.requests.filter(isTranslate)).toEqual([]);
    expect(c.requests.filter(isReview).flatMap(paragraphs)).toEqual(expect.arrayContaining([80, 81]));
    // Reviewed once: back on the same screen, nothing more is sent.
    const sent = c.requests.length;
    jobs.setViewport(1, 'd2', ['s81']);
    await settle(30);
    expect(c.requests.length).toBe(sent);
  });

  it('a screen of code only (nothing translatable on it) neither drops the reviews nor starts rounds without end', async () => {
    const d = doc(300, 200);
    d.segments.splice(150, 0, { id: 'code', kind: 'code', text: 'fn main() {}', inlineMarkup: 'fn main() {}', domPath: '/pre[1]', translate: false });
    const c = client();
    // A cap, so a loop fails the test instead of hanging it: past it, the route refuses.
    let starts = 0;
    const CAP = 12;
    const refused = { ok: false as const, error: { kind: 'bad_request' as const, message: 'capped' } };
    const jobs = jobsWith({ translateClient: () => (++starts > CAP ? Promise.resolve(refused) : ok(c)()), lazyAbove: 50 });
    jobs.setViewport(1, 'd', ['code']);
    await jobs.start(1, 'd', d);
    await settle(200);
    expect(starts).toBeLessThanOrEqual(2);
    expect(jobs.get(1)?.status).toBe('done');
    // The round (from the top: the screen names no block of its own) is drafted and reviewed.
    expect(c.requests.filter(isReview).length).toBeGreaterThan(0);
    expect(jobs.get(1)?.segs.get('s0')?.refined).toBe(true);
    expect(jobs.get(1)?.segs.get('s10')?.refined).toBe(true);
  });

  it('a reader who stays inside the round lets every review run', async () => {
    const c = client({ hold: true });
    const records: JobRecord[] = [];
    const jobs = jobsWith({ translateClient: ok(c), lazyAbove: 50, onJobRecord: (r) => records.push(r) });
    const run = jobs.start(1, 'd', doc(300, 200));
    await until(() => c.waiting.length === GEMINI_PROFILE.maxConcurrency);
    jobs.setViewport(1, 'd', ['s2', 's3']);
    await releaseUntil(c, () => jobs.get(1)?.status === 'done');
    await run;
    expect(records.at(-1)?.review?.skipped).toBe(0);
    expect(refinedIds(jobs.get(1)).length).toBe(jobs.get(1)?.counts.final);
  });
});

describe('Jobs: keep drafts on screen', () => {
  it('a refined revision of a block on screen waits until it leaves the screen; the cache has it at once', async () => {
    const cache = newCache();
    const c = client({ hold: true });
    const jobs = jobsWith({ translateClient: ok(c), cache });
    jobs.setViewport(1, 'd', ['s0']);
    const run = jobs.start(1, 'd', doc(8, 120, { keepDraftsOnScreen: true }));
    // The screen's chunk is reviewed last: the others answer first, one stays out.
    const answer = async (n: number) => {
      await until(() => c.waiting.some((w) => paragraphs(w.req).includes(n)));
      c.waiting.find((w) => paragraphs(w.req).includes(n))?.go();
    };
    await answer(1);
    await until(() => jobs.get(1)?.segs.get('s1')?.refined === true);
    await answer(0);
    await settle(30);
    expect(jobs.get(1)?.status).toBe('running');
    expect(jobs.get(1)?.segs.get('s0')).toMatchObject({ status: 'final', text: `vi:P0 ${words(120)}` });
    expect(jobs.get(1)?.segs.get('s0')?.refined).toBeUndefined();
    await jobs.cacheIdle();
    const s0 = doc(1).segments[0] as Segment;
    const key = segmentKey(scopeHash(keyScope({ targetLang: 'vi', model: GEMINI_PROFILE.model, strategy: 'refine', reviewModel: GEMINI_PROFILE.model })), s0);
    expect((await cache.getMany([key])).get(key)).toMatchObject({ revision: REVIEWED_REVISION, refined: true });
    // Scrolled away: the refined text is shown now.
    jobs.setViewport(1, 'd', ['s7']);
    expect(jobs.get(1)?.segs.get('s0')).toMatchObject({ refined: true, text: `rv:vi:P0 ${words(120)}` });
    // The other review lands on screen (s7): held until the run ends, then shown.
    c.waiting.splice(0).forEach((w) => w.go());
    await run;
    expect(jobs.get(1)?.status).toBe('done');
    expect(refinedIds(jobs.get(1))).toHaveLength(8);
    await jobs.cacheIdle();
    const reload = client();
    const second = jobsWith({ translateClient: ok(reload), cache });
    await second.start(1, 'd2', doc(8));
    expect(reload.requests).toEqual([]);
    expect(refinedIds(second.get(1))).toHaveLength(8);
  });

  it('without the setting a block on screen is refined as soon as its review lands', async () => {
    const c = client();
    const jobs = jobsWith({ translateClient: ok(c) });
    jobs.setViewport(1, 'd', ['s0']);
    const seen: (boolean | undefined)[] = [];
    jobs.subscribe((_, v) => v?.status === 'running' && seen.push(v.segs.get('s0')?.refined));
    await jobs.start(1, 'd', doc(8));
    expect(seen).toContain(true);
  });
});

describe('Jobs: Best across runs', () => {
  it('a run cancelled during its reviews, then resumed, reviews the drafts it kept and drafts nothing again', async () => {
    const c = client({ hold: true });
    const jobs = jobsWith({ translateClient: ok(c) });
    const run = jobs.start(1, 'd', doc(8));
    await until(() => c.waiting.length > 0);
    jobs.cancel(1);
    await run;
    expect(jobs.get(1)?.status).toBe('cancelled');
    expect(jobs.get(1)?.counts.final).toBe(8);
    const translated = c.requests.filter(isTranslate).length;
    const resumed = jobs.resume(1);
    for (let i = 0; i < 200 && jobs.get(1)?.status !== 'done'; i++) {
      c.waiting.splice(0).forEach((w) => w.go());
      await settle(5);
    }
    await resumed;
    expect(jobs.get(1)?.status).toBe('done');
    expect(c.requests.filter(isTranslate).length).toBe(translated);
    expect(refinedIds(jobs.get(1))).toHaveLength(8);
  });

  it('the feature check does not hold the job: it is there at once, and a cancel meanwhile sends nothing', async () => {
    let answer: (v: boolean) => void = () => {};
    const featureAvailable = () => new Promise<boolean>((resolve) => (answer = resolve));
    const c = client();
    const records: JobRecord[] = [];
    const jobs = jobsWith({ translateClient: ok(c), featureAvailable, onJobRecord: (r) => records.push(r) });
    const run = jobs.start(1, 'd', doc(8));
    // Set up (and the tab's job replaced) before the answer.
    expect(jobs.get(1)?.status).toBe('running');
    jobs.cancel(1);
    answer(true);
    await run;
    await settle(20);
    expect(jobs.get(1)?.status).toBe('cancelled');
    expect(c.requests).toEqual([]);
    // Ended before the answer: the strategy logged is the one asked for, and says so.
    expect(records.map((r) => [r.outcome, r.strategy, r.requested])).toEqual([['cancelled', 'refine', true]]);
  });

  it('a second start while the first waits for the feature check replaces it; the page cost is kept', async () => {
    const answers: ((v: boolean) => void)[] = [];
    const featureAvailable = () => new Promise<boolean>((resolve) => answers.push(resolve));
    const c = client();
    const jobs = jobsWith({ translateClient: ok(c), featureAvailable });
    await (async () => {
      const first = jobs.start(1, 'd', doc(8));
      answers.shift()?.(true);
      await first;
    })();
    const cost = jobs.get(1)?.usage;
    expect(cost?.input).toBeGreaterThan(0);
    // Two restarts that keep the cost, the first overtaken while it waits.
    const a = jobs.start(1, 'd', doc(8, 120, { style: 'faithful' }), { keepCost: true });
    const b = jobs.start(1, 'd', doc(8, 120, { style: 'faithful' }), { keepCost: true });
    answers.splice(0).forEach((go) => go(true));
    await Promise.all([a, b]);
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('done');
    expect(v.usage.input).toBeGreaterThan(cost?.input ?? 0);
    expect(refinedIds(v)).toHaveLength(8);
  });

  it('two blocks with the same text share an entry: the refined one is kept over its twin left as drafted', async () => {
    const cache = newCache();
    const d = doc(8);
    // s1 repeats s0's text; the reviewer refines only the first item of each call.
    d.segments[1] = { ...(d.segments[0] as Segment), id: 's1', domPath: '/p[2]' };
    const twinReviewer: Reviewer = (draft, n) => (n === 1 ? `rv:${draft}` : undefined);
    const first = jobsWith({ translateClient: ok(client({ reviewer: twinReviewer })), cache });
    await first.start(1, 'd', d);
    await first.cacheIdle();
    expect(first.get(1)?.segs.get('s0')?.refined).toBe(true);
    const again = client({ reviewer: twinReviewer });
    const second = jobsWith({ translateClient: ok(again), cache });
    await second.start(1, 'd2', d);
    expect(again.requests).toEqual([]);
    expect(second.get(1)?.segs.get('s0')?.refined).toBe(true);
    expect(second.get(1)?.segs.get('s1')?.refined).toBe(true);

    // A Retranslate page replaces stored entries: there too the twin left as drafted does not replace the refined one.
    await second.start(1, 'd2', d, { fresh: true });
    await second.cacheIdle();
    const third = client();
    const reload = jobsWith({ translateClient: ok(third), cache });
    await reload.start(1, 'd3', d);
    expect(third.requests).toEqual([]);
    expect(reload.get(1)?.segs.get('s1')?.refined).toBe(true);
  });

  it('a block that failed is not counted as reviewed: once Retry translates it, the next run reviews it', async () => {
    const inner = client();
    let failedOnce = false;
    const c: LLMClient = {
      ...inner,
      async *stream(req) {
        if (!failedOnce && isTranslate(req) && paragraphs(req).includes(5)) {
          failedOnce = true;
          await Promise.resolve();
          yield { type: 'error', error: { kind: 'bad_request', status: 400, message: 'refused' } };
          return;
        }
        yield* inner.stream(req);
      },
    };
    const jobs = jobsWith({ translateClient: ok(c) });
    await jobs.start(1, 'd', doc(8));
    expect(jobs.get(1)?.segs.get('s5')?.status).toBe('failed');
    await jobs.retrySegment(1, 's5');
    expect(jobs.get(1)?.segs.get('s5')).toMatchObject({ status: 'final' });
    expect(jobs.get(1)?.segs.get('s5')?.refined).toBeUndefined();
    const reviews = inner.requests.filter(isReview).length;
    await jobs.resume(1);
    expect(jobs.get(1)?.segs.get('s5')?.refined).toBe(true);
    expect(inner.requests.filter(isReview).length).toBeGreaterThan(reviews);
  });
});
