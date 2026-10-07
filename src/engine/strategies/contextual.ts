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
// analyze stage is over, with or without a brief, so a failed or slow brief delays later chunks
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
// `segment.failed` goes out for it.
import { chunkLimits, chunkSegments } from '../chunker.ts';
import { ANALYZE_PROMPT_ID } from '../prompts/analyze.ts';
import { TRANSLATE_V2_PROMPT_ID } from '../prompts/translate.ts';
import { defineStage, multiplex, runStages, type AnyStage } from '../runner.ts';
import { analyzeStage } from '../stages/analyze.ts';
import type { EngineEvent, StageContext, Strategy, TranslationJob } from '../types.ts';
import { checkStage, chunkStage, createTranslateStage, untilSettledOrAborted, type BriefWait, type ChunkOutcome } from './single-pass.ts';

export const CONTEXTUAL_ID = 'contextual';
/** 2: translate@2 with the context providers (M2-E3). 1 was Phase B's translate@1 with the brief unused. */
export const CONTEXTUAL_VERSION = 2;
/** The translate prompt `contextual` sends by default. */
export const CONTEXTUAL_TRANSLATE_PROMPT_ID = TRANSLATE_V2_PROMPT_ID;

/** Chunks translated without waiting for the brief: the first one (M2-D6). */
export const BRIEF_FREE_CHUNKS = 1;

/** The revision chunk 0's second pass marks its finals with (M2-D17). */
export const REVISED_REVISION = 2;

/**
 * M2-D17: the brief-free chunks again, now with the brief, as revision 2. A document stage: it
 * holds each chunk's events until the call is over and passes on usage and the last final of each
 * segment the pass translated cleanly; partials and failures stay inside (the revision-1 text stands).
 */
export function createReviseStage(translatePrompt: string = CONTEXTUAL_TRANSLATE_PROMPT_ID): AnyStage {
  const translate = createTranslateStage(CONTEXTUAL_ID, undefined, translatePrompt, REVISED_REVISION);
  return defineStage<TranslationJob, never>({
    id: 'revise',
    scope: 'document',
    role: 'translate',
    promptId: translatePrompt,
    async *run(job, ctx) {
      const chunks = chunkSegments(job.doc.segments, chunkLimits(job.options.chunkTokens)).slice(0, BRIEF_FREE_CHUNKS);
      for (const chunk of chunks) {
        const held: EngineEvent[] = [];
        let outcome: ChunkOutcome | undefined;
        for await (const item of translate.run({ chunk, doc: job.doc, options: job.options } as never, ctx)) {
          if (isEvent(item)) held.push(item);
          else outcome = item as ChunkOutcome;
        }
        const clean = new Set(outcome?.final ?? []);
        const last = new Map<string, EngineEvent>();
        for (const e of held) {
          if (e.type === 'usage') yield e;
          else if (e.type === 'segment.final' && clean.has(e.id)) last.set(e.id, e);
        }
        yield* last.values();
      }
    },
  });
}

const isEvent = (item: unknown): item is EngineEvent => typeof item === 'object' && item !== null && 'type' in item;

/** Whether the revise pass runs: the brief landed after chunk 0 went out, and the prompt renders it. */
function revises(ctx: StageContext, translatePrompt: string, hadBrief: boolean): boolean {
  const prompt = ctx.prompts.get(translatePrompt);
  return !hadBrief && ctx.memory.brief !== undefined && prompt.name === 'translate' && prompt.version >= 2;
}

/** Whether the document is a single chunk at the job's chunk size (the chunk stage cuts it the same way). */
export function isOneChunk(job: TranslationJob): boolean {
  return chunkSegments(job.doc.segments, chunkLimits(job.options.chunkTokens)).length <= 1;
}

/** The translation stages, the translate stage waiting for the brief as `brief` says. */
export function contextualStages(brief: BriefWait, translatePrompt: string = CONTEXTUAL_TRANSLATE_PROMPT_ID): readonly AnyStage[] {
  return [chunkStage, createTranslateStage(CONTEXTUAL_ID, brief, translatePrompt), checkStage];
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
      async function* analyze() {
        try {
          yield* runStages([analyzeStage], job, ctx, concurrency);
        } finally {
          // Brief or no brief (the stage degrades by itself), the waiting chunks go on.
          settle();
        }
      }
      async function* revise() {
        await untilSettledOrAborted(settled, ctx.signal);
        if (revises(ctx, translatePrompt, hadBrief)) yield* runStages([createReviseStage(translatePrompt)], job, ctx, concurrency);
      }
      const lanes = [analyze(), runStages(contextualStages({ settled, freeChunks: BRIEF_FREE_CHUNKS }, translatePrompt), job, ctx, concurrency), revise()];
      // Both lanes run at once; their events pass on as they arrive. Only an abort (or an engine
      // bug) throws, after the other lane has finished.
      for await (const { value } of multiplex(lanes, lanes.length, (lane) => lane, ctx.signal)) yield value as EngineEvent;
    },
  };
}

export const contextual: Strategy = createContextual();

/** What the translation cache key must include for this strategy (§5.5, M3). */
export const CONTEXTUAL_CACHE_KEY = { strategy: CONTEXTUAL_ID, version: CONTEXTUAL_VERSION, promptIds: [ANALYZE_PROMPT_ID, CONTEXTUAL_TRANSLATE_PROMPT_ID] } as const;
