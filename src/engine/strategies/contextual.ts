// `contextual` (DESIGN.md §5.3, §5.7; plan M2): analyze → chunk → translate(chunk) → check.
// Phase B scope (plan M2 §6 sub-goal B): the analyze stage produces the brief (memory + an
// `artifact` event) and supplies the source language when the shell could not tell it. The
// translate prompt is still `translate@1` with the brief slot "(none)": carrying the brief into
// every chunk is M2-E3 (`translate@2`). `single-pass` is left as it was, so its baseline stays
// reproducible.
//
// Latency (plan §8, user decision M2-D6): the brief call runs alongside the translation instead of
// before it. The first chunk goes ahead without the brief; every later chunk waits until the
// analyze stage is over, with or without a brief, so a failed or slow brief delays later chunks
// at most by the brief call itself and never fails the job. Each chunk's outcome records whether
// the brief was there (ChunkOutcome.briefed). The `artifact` event goes out when the brief lands.
import { ANALYZE_PROMPT_ID } from '../prompts/analyze.ts';
import { TRANSLATE_PROMPT_ID } from '../prompts/translate.ts';
import { multiplex, runStages, type AnyStage } from '../runner.ts';
import { analyzeStage } from '../stages/analyze.ts';
import type { EngineEvent, StageContext, Strategy, TranslationJob } from '../types.ts';
import { checkStage, chunkStage, createTranslateStage, type BriefWait } from './single-pass.ts';

export const CONTEXTUAL_ID = 'contextual';
export const CONTEXTUAL_VERSION = 1;

/** Chunks translated without waiting for the brief: the first one (M2-D6). */
export const BRIEF_FREE_CHUNKS = 1;

/** The translation stages, the translate stage waiting for the brief as `brief` says. */
export function contextualStages(brief: BriefWait): readonly AnyStage[] {
  return [chunkStage, createTranslateStage(CONTEXTUAL_ID, brief), checkStage];
}

export const contextual: Strategy = {
  id: CONTEXTUAL_ID,
  version: CONTEXTUAL_VERSION,
  async *run(job: TranslationJob, ctx: StageContext) {
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => (settle = resolve));
    const concurrency = { concurrency: job.options.maxConcurrency };
    async function* analyze() {
      try {
        yield* runStages([analyzeStage], job, ctx, concurrency);
      } finally {
        // Brief or no brief (the stage degrades by itself), the waiting chunks go on.
        settle();
      }
    }
    const lanes = [analyze(), runStages(contextualStages({ settled, freeChunks: BRIEF_FREE_CHUNKS }), job, ctx, concurrency)];
    // Both lanes run at once; their events pass on as they arrive. Only an abort (or an engine
    // bug) throws, after the other lane has finished.
    for await (const { value } of multiplex(lanes, lanes.length, (lane) => lane, ctx.signal)) yield value as EngineEvent;
  },
};

/** What the translation cache key must include for this strategy (§5.5, M3). */
export const CONTEXTUAL_CACHE_KEY = { strategy: CONTEXTUAL_ID, version: CONTEXTUAL_VERSION, promptIds: [ANALYZE_PROMPT_ID, TRANSLATE_PROMPT_ID] } as const;
