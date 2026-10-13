// `refine` (DESIGN.md §5.3, §5.6; the "Best" quality mode): the `contextual` draft, then a review pass.
//   1. Drafts the job brings (TranslationJob.drafts, e.g. cache hits below the review revision)
//      seed working memory at their revision; those segments are not drafted again.
//   2. `contextual` runs over the rest exactly as Balanced does (analyze beside the chunks, the
//      chunk-0 revise pass as revision 2, the check stage), so every draft is the Balanced output
//      and Best is never worse than Balanced when the review is skipped.
//   3. A `stage` event `drafts` (status `done`) says the drafts are over: the shell need not wait
//      for the reviews (lazy rounds).
//   4. Only then the review stage (stages/review.ts), one call per chunk of drafted segments: its
//      accepted texts arrive as REVIEWED_REVISION, so they never race revision 2. Reviews start
//      after the screen first and the screen last, a review not started is dropped when the reader
//      leaves its chunk (TranslationJob.within) or the job stops wanting reviews (reviewWanted),
//      and none starts once the budget cannot cover it. A review never emits `segment.failed`.
// With the budget exhausted after the drafts there is no review call: each chunk is reported
// skipped (`budget`) and the drafts stand.
import { chunkJob } from './single-pass.ts';
import { CONTEXTUAL_TRANSLATE_PROMPT_ID, createContextual } from './contextual.ts';
import { ANALYZE_PROMPT_ID } from '../prompts/analyze.ts';
import { REVIEW_PROMPT_ID } from '../prompts/review.ts';
import { runStages } from '../runner.ts';
import { createReviewStage, type ReviewWork } from '../stages/review.ts';
import type { EngineEvent, StageContext, Strategy, TranslationJob } from '../types.ts';

export { REVIEWED_REVISION } from '../stages/review.ts';

export const REFINE_ID = 'refine';
export const REFINE_VERSION = 1;

/** The `stage` event (status `done` only) that ends the draft part of a refine run. */
export const DRAFTS_STAGE = 'drafts';

/** Seeds working memory with the job's drafts of segments it translates; returns their ids. */
function seedDrafts(job: TranslationJob, ctx: StageContext): Set<string> {
  const seeded = new Set<string>();
  if (job.drafts === undefined) return seeded;
  for (const segment of job.doc.segments) {
    const draft = job.drafts.get(segment.id);
    if (!segment.translate || draft === undefined) continue;
    ctx.memory.translated.set(segment.id, { text: draft.text, revision: draft.revision });
    seeded.add(segment.id);
  }
  return seeded;
}

/** The review pass's chunks: the job's chunks (cut around the screen now), each with only its segments that have a draft. */
function reviewWorks(job: TranslationJob, ctx: StageContext): ReviewWork[] {
  return chunkJob(job, ctx.priority?.() ?? []).flatMap((chunk) => {
    const segments = chunk.segments.filter((s) => ctx.memory.translated.has(s.id));
    if (segments.length === 0) return [];
    return [{ chunk: { ...chunk, segments }, doc: job.doc, options: job.options, ...(job.reviewWanted === undefined ? {} : { reviewWanted: job.reviewWanted }) }];
  });
}

/** `refine` drafting with `translatePrompt` and reviewing with `reviewPrompt` (the harness's prompt A/B). */
export function createRefine(prompts: { translatePrompt?: string; reviewPrompt?: string } = {}): Strategy {
  const { translatePrompt = CONTEXTUAL_TRANSLATE_PROMPT_ID, reviewPrompt = REVIEW_PROMPT_ID } = prompts;
  const draft = createContextual(translatePrompt);
  return {
    id: REFINE_ID,
    version: REFINE_VERSION,
    async *run(job: TranslationJob, ctx: StageContext) {
      const seeded = seedDrafts(job, ctx);
      const draftJob: TranslationJob = seeded.size === 0 ? job : { ...job, doc: { ...job.doc, segments: job.doc.segments.map((s) => (seeded.has(s.id) ? { ...s, translate: false } : s)) } };
      yield* draft.run(draftJob, ctx);
      yield { type: 'stage', stage: DRAFTS_STAGE, status: 'done' };
      const works = reviewWorks(job, ctx);
      if (ctx.budget.exhausted()) {
        const briefed = ctx.memory.brief !== undefined;
        for (const w of works) {
          const event: EngineEvent = { type: 'chunk', index: w.chunk.index, briefed, review: { ids: w.chunk.segments.map((s) => s.id), accepted: [], unchanged: [], rejected: [], skipped: 'budget' } };
          yield event;
        }
        return;
      }
      if (works.length === 0) return;
      // A stage per run: it holds the run's token reservation for the reviews in flight.
      yield* runStages([createReviewStage(reviewPrompt, REFINE_ID)], works, ctx, { concurrency: job.options.maxConcurrency });
    },
  };
}

export const refine: Strategy = createRefine();

/** What the translation cache key must include for this strategy (§5.5): a `review@N` bump changes it. */
export const REFINE_CACHE_KEY = { strategy: REFINE_ID, version: REFINE_VERSION, promptIds: [ANALYZE_PROMPT_ID, CONTEXTUAL_TRANSLATE_PROMPT_ID, REVIEW_PROMPT_ID] } as const;
