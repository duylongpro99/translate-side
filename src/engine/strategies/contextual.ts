// `contextual` (DESIGN.md §5.3, §5.7; plan M2): analyze → chunk → translate(chunk) → check.
// The analyze stage produces the brief (memory + an `artifact` event) and supplies the source
// language when the shell could not tell it. The translate stage sends `translate@2` (plan M2-E3):
// the context providers (context/, M2-E2) carry the brief, the glossary (personal + the brief's)
// and the context tail into every chunk. `createContextual('translate@1')` is the same strategy
// sending `translate@1` as Phase B did (brief "(none)"), for the harness's @1-vs-@2 A/B.
// `single-pass` is left as it was, so its baseline stays reproducible.
//
// Latency (plan §8, user decision M2-D6): the brief call runs alongside the translation instead of
// before it. The first chunk goes ahead without the brief; every later chunk waits until the
// analyze stage is over (plan M3-E1: "first" is the first chunk to start, which is the one on
// screen when the job has a priority; the revise pass below follows it), with or without a brief, so a failed or slow brief delays later chunks
// at most by the brief call itself and never fails the job. Each chunk's outcome records whether
// the brief was there (ChunkOutcome.briefed). The `artifact` event goes out when the brief lands.
// A one-chunk document skips the analyze stage altogether (user decision M2-D9): no brief, no
// About card.
//
// Chunk 0 again (user decision M2-D17): on a document of two chunks or more, once the brief lands
// the brief-free chunk 0 is translated once more with it (the `revise` stage) and its segments are
// replaced in place as revision 2 (§5.2: a higher revision always wins), so the first chunk follows
// the brief's renderings and first-use glosses like the others. One extra call per such document;
// none without a brief, when the job brought its brief (chunk 0 had it), or under translate@1
// (no brief in the prompt). The pass is all or nothing per segment: its finals go out when the call
// is over, only for segments it translated cleanly; a segment it fails keeps revision 1, and no
// `segment.failed` goes out for it. It is a work item of the translate stage, right after chunk 0,
// so it takes one of the job's maxConcurrency slots like a chunk; it starts once chunk 0's own
// call is over and the analyze stage has settled, so revision 2 never races revision 1 (the slot is
// held while it waits for the brief). A revision 2 that fails a post-check against the source
// (check/checks.ts: markers, code spans, URLs, numbers, length, script) that the revision 1 it
// would replace passes is dropped and revision 1 stays: seen live, a glossary rendered without
// backticks drew code spans out of the text (round 14). The pass then reports the dropped ids
// (the `chunk` event's `revise.kept`). The check stage then checks whichever revision stands.
import { chunkLimits, chunkSegments } from '../chunker.ts';
import { ANALYZE_PROMPT_ID } from '../prompts/analyze.ts';
import { TRANSLATE_V2_PROMPT_ID } from '../prompts/translate.ts';
import { defineStage, multiplex, runStages, type AnyStage } from '../runner.ts';
import { analyzeStage } from '../stages/analyze.ts';
import type { EngineEvent, StageContext, Strategy, TranslationJob } from '../types.ts';
import { checkSegment } from '../check/checks.ts';
import { pickByPriority } from '../priority.ts';
import { chunkJob, createStrategyCheckStage, createTranslateRun, recutChunks, untilSettledOrAborted, type BriefWait, type ChunkOutcome, type ChunkWork, type TranslateRun } from './single-pass.ts';

export const CONTEXTUAL_ID = 'contextual';
/** 2: translate@2 with the context providers (M2-E3). 1 was Phase B's translate@1 with the brief unused. */
export const CONTEXTUAL_VERSION = 2;
/** The translate prompt `contextual` sends by default. */
export const CONTEXTUAL_TRANSLATE_PROMPT_ID = TRANSLATE_V2_PROMPT_ID;

/** Chunks translated without waiting for the brief: the first one (M2-D6). */
export const BRIEF_FREE_CHUNKS = 1;

/** At most this many chunks holding the screen go without the brief (each is revised with it later). */
export const MAX_SCREEN_CHUNKS = 3;

/** The revision chunk 0's second pass marks its finals with (M2-D17). */
export const REVISED_REVISION = 2;

/** M2-D17: the revise pass's work item: the `revise`-th brief-free chunk again, with the brief. */
interface ReviseWork {
  revise: number;
}

type ContextualWork = ChunkWork | ReviseWork;

/**
 * Whether `revised` fails a post-check (check/checks.ts) that `draft` passes, both against the
 * segment's source: a revision 2 that loses a code span, a link, emphasis, a URL or a number the
 * source has, where revision 1 kept it (round 15; compared with the source since Phase D, so a
 * revision 1 that had lost or invented a marker itself is no yardstick).
 */
export function regresses(source: string, draft: string, revised: string, targetLang: string): boolean {
  const before = new Set(checkSegment(source, draft, targetLang).map((f) => f.kind));
  return checkSegment(source, revised, targetLang).some((f) => !before.has(f.kind));
}

/**
 * M2-D17: `work` again as revision 2. Holds the call's events until it is over and passes on usage
 * and the last final of each segment the pass translated cleanly, unless it lost markers that the
 * revision 1 in memory had; partials and failures stay inside (the revision-1 text stands). Ends
 * with the `chunk` event naming the segments kept at revision 1 for lost markers.
 */
async function* revise(again: TranslateRun, work: ChunkWork, ctx: StageContext): AsyncGenerator<EngineEvent> {
  const held: EngineEvent[] = [];
  const gen = again(work, ctx);
  let next = await gen.next();
  for (; next.done !== true; next = await gen.next()) held.push(next.value);
  const clean = new Set(next.value.final);
  const last = new Map<string, EngineEvent & { type: 'segment.final' }>();
  for (const e of held) {
    if (e.type === 'usage') yield e;
    else if (e.type === 'segment.final' && clean.has(e.id)) last.set(e.id, e);
  }
  const kept: string[] = [];
  const source = new Map(work.chunk.segments.map((s) => [s.id, s.inlineMarkup]));
  for (const e of last.values()) {
    const draft = ctx.memory.translated.get(e.id);
    if (draft !== undefined && draft.revision < e.revision && regresses(source.get(e.id) ?? '', draft.text, e.text, work.doc.targetLang)) kept.push(e.id);
    else yield e;
  }
  yield { type: 'chunk', index: work.chunk.index, briefed: ctx.memory.brief !== undefined, revise: { kept } };
}

/** Whether the document is a single chunk at the job's chunk size (the chunk stage then cuts it the same way, chunkJob). */
export function isOneChunk(job: TranslationJob): boolean {
  return chunkSegments(job.doc.segments, chunkLimits(job.options.chunkTokens)).length <= 1;
}

/**
 * The translation stages, the translate stage waiting for the brief as `brief` says. With
 * `revises` (M2-D17), the brief-free chunks also go again as revision 2 when it says so, asked
 * once the brief has settled.
 *
 * Viewport first (plan M3-E1): chunks start in the order pickByPriority gives, and the brief-free
 * chunks are the first `brief.freeChunks` to start, so the chunk on screen does not wait for the
 * brief (plan M3 §8). With nothing on screen that is chunk 0, as in M2.
 */
export function contextualStages(brief: BriefWait, translatePrompt: string = CONTEXTUAL_TRANSLATE_PROMPT_ID, revises?: (ctx: StageContext) => boolean): readonly AnyStage[] {
  const check = createStrategyCheckStage(CONTEXTUAL_ID, translatePrompt);
  // The brief-free chunks, in the order they were picked (claimed by `pick` below).
  const claimed: ChunkWork[] = [];
  // Every chunk holding the screen goes without the brief (M3 dogfood B4: a dense screen is more
  // than one chunk, and the part in the second one waited for the brief call), up to a few.
  let freeChunks = brief.freeChunks;
  let briefSettled = false;
  void brief.settled.then(() => (briefSettled = true));
  const wait: BriefWait = {
    settled: brief.settled,
    get freeChunks() {
      return freeChunks;
    },
    free: (index) => claimed.some((w) => w.chunk.index === index),
  };
  const first = createTranslateRun(CONTEXTUAL_ID, wait, translatePrompt);
  const again = createTranslateRun(CONTEXTUAL_ID, undefined, translatePrompt, REVISED_REVISION);
  // Settles when a brief-free chunk's first call is over (by index).
  const over = new Map<number, { done: Promise<void>; settle: () => void }>();
  const firstOver = (index: number) => {
    let entry = over.get(index);
    if (entry === undefined) {
      let settle!: () => void;
      const done = new Promise<void>((resolve) => (settle = resolve));
      entry = { done, settle };
      over.set(index, entry);
    }
    return entry;
  };
  const chunk = defineStage<TranslationJob, ContextualWork[]>({
    id: 'chunk',
    scope: 'document',
    async *run(job, ctx) {
      const priority = ctx.priority?.() ?? [];
      const works: ChunkWork[] = chunkJob(job, priority).map((c) => ({ chunk: c, doc: job.doc, options: job.options }));
      const onScreen = new Set(priority);
      const screenChunks = works.filter((w) => w.chunk.segments.some((s) => onScreen.has(s.id))).length;
      freeChunks = Math.max(brief.freeChunks, Math.min(screenChunks, MAX_SCREEN_CHUNKS));
      const reviseItems: ReviseWork[] = revises === undefined ? [] : Array.from({ length: Math.min(freeChunks, works.length) }, (_, k) => ({ revise: k }));
      yield [...works, ...reviseItems];
    },
  });
  const translate = defineStage<ContextualWork, ChunkOutcome>({
    id: 'translate',
    scope: 'chunk',
    role: 'translate',
    promptId: translatePrompt,
    async *run(work, ctx) {
      if ('revise' in work) {
        const target = claimed[work.revise];
        if (target === undefined || revises === undefined) return;
        await untilSettledOrAborted(firstOver(target.chunk.index).done, ctx.signal);
        await untilSettledOrAborted(brief.settled, ctx.signal);
        if (revises(ctx)) yield* revise(again, target, ctx);
        return;
      }
      try {
        const outcome = yield* first(work, ctx);
        yield outcome;
      } finally {
        firstOver(work.chunk.index).settle();
      }
    },
    pick(items, pending, ctx) {
      const chunks = pending.filter((i) => {
        const item = items[i];
        return item !== undefined && !('revise' in item);
      });
      // A revise item starts right after the chunk it revises (M2-D17): it holds its slot while
      // it waits, so a revision 2 never races its revision 1. But not before every brief-free
      // chunk has started: the screen's other chunks must not wait behind it (M3 dogfood B4).
      const ready = pending.find((i) => {
        const item = items[i];
        return item !== undefined && 'revise' in item && item.revise < claimed.length && (claimed.length >= freeChunks || chunks.length === 0);
      });
      if (ready !== undefined) return ready;
      if (chunks.length === 0) return pending[0] as number;
      const ids = items.map((item) => ('revise' in item ? [] : item.chunk.segments.map((s) => s.id)));
      const next = pickByPriority(ids, chunks, ctx.priority?.() ?? []);
      const work = items[next];
      if (claimed.length < freeChunks && work !== undefined && !('revise' in work)) claimed.push(work);
      return next;
    },
    // Asked again from another screen (M3 dogfood B5): the chunks not started are cut again around
    // it. Before the brief has settled, the new screen's chunks go without it too (each gets its
    // revise item), so the screen the reader asked from does not wait for the analyze call.
    recut(items, pending, ctx) {
      const chunkWorks = items.map((item) => ('revise' in item ? undefined : item));
      const chunks = pending.filter((i) => chunkWorks[i] !== undefined);
      const works = recutChunks(chunkWorks, chunks, ctx);
      if (works === undefined) return undefined;
      const revisesLeft = pending.map((i) => items[i]).filter((item): item is ReviseWork => item !== undefined && 'revise' in item);
      const extra: ReviseWork[] = [];
      if (!briefSettled) {
        const onScreen = new Set(ctx.priority?.() ?? []);
        const screenChunks = works.filter((w) => w.chunk.segments.some((s) => onScreen.has(s.id))).length;
        const wanted = Math.max(freeChunks, claimed.length + Math.min(screenChunks, MAX_SCREEN_CHUNKS));
        if (revises !== undefined) for (let k = freeChunks; k < wanted; k++) extra.push({ revise: k });
        freeChunks = wanted;
      }
      return [...works, ...revisesLeft, ...extra];
    },
  });
  return [chunk, translate, check];
}

/** `contextual` sending `translatePrompt` (the harness's `--prompt`); same id, so it replaces the default in an engine. */
export function createContextual(translatePrompt: string = CONTEXTUAL_TRANSLATE_PROMPT_ID): Strategy {
  return {
    id: CONTEXTUAL_ID,
    version: CONTEXTUAL_VERSION,
    async *run(job: TranslationJob, ctx: StageContext) {
      const concurrency = { concurrency: job.options.maxConcurrency };
      // M2-D9: a document that fits one chunk makes no analyze call. Its only chunk is brief-free
      // anyway (M2-D6), so the brief would cost a call for the About card alone.
      if (isOneChunk(job)) {
        yield* runStages(contextualStages({ settled: Promise.resolve(), freeChunks: BRIEF_FREE_CHUNKS }, translatePrompt), job, ctx, concurrency);
        return;
      }
      let settle!: () => void;
      const settled = new Promise<void>((resolve) => (settle = resolve));
      const hadBrief = ctx.memory.brief !== undefined;
      const prompt = ctx.prompts.get(translatePrompt);
      // M2-D17: only a brief that lands after chunk 0 went out, and only a prompt that renders it.
      const revises = !hadBrief && prompt.name === 'translate' && prompt.version >= 2 ? (c: StageContext) => c.memory.brief !== undefined : undefined;
      async function* analyze() {
        try {
          yield* runStages([analyzeStage], job, ctx, concurrency);
        } finally {
          // Brief or no brief (the stage degrades by itself), the waiting chunks go on.
          settle();
        }
      }
      const lanes = [analyze(), runStages(contextualStages({ settled, freeChunks: BRIEF_FREE_CHUNKS }, translatePrompt, revises), job, ctx, concurrency)];
      // Both lanes run at once; their events pass on as they arrive. Only an abort (or an engine
      // bug) throws, after the other lane has finished.
      for await (const { value } of multiplex(lanes, lanes.length, (lane) => lane, ctx.signal)) yield value as EngineEvent;
    },
  };
}

export const contextual: Strategy = createContextual();

/** What the translation cache key must include for this strategy (§5.5, M3). */
export const CONTEXTUAL_CACHE_KEY = { strategy: CONTEXTUAL_ID, version: CONTEXTUAL_VERSION, promptIds: [ANALYZE_PROMPT_ID, CONTEXTUAL_TRANSLATE_PROMPT_ID] } as const;
