// `single-pass` (DESIGN.md §5.3 "Planned strategies", plan M1-E5): translate(chunk) + check.
// Stages:
//   chunk      document → ChunkWork[]      the chunker (M1-E2) over the job's segments
//   translate  chunk    → ChunkOutcome     translateChunk (M1-E3) with one repair round; this
//                                          stage builds the prompt and the per-call budget
//   check      document → CheckSummary     every segment sent came back final or failed, and
//                                          the post-checks with one re-request (stages/check.ts)
// The translate stage's `call` (translate-chunk.ts ChunkCall) owns the prompt and maxOutputTokens:
// the system block is `translate@1` rendered once per chunk (identical for every chunk of a
// document, the caching prefix), the user message is the wire chunk, and maxOutputTokens follows
// §5.7 for the segments of THAT call: the whole chunk on attempt 1, only the re-requested segments
// on the repair (a smaller budget, so a repair can't be cut by the first pass's size).

import type { LLMClient, LLMError, NormalizedRequest } from '../../llm/types.ts';
import { BUDGET_MESSAGE, maxOutputTokens } from '../budget.ts';
import { chunkLimits, chunkSegments, type Chunk } from '../chunker.ts';
import { formatWire, toWire, type WireChunk } from '../parsing/wire.ts';
import { translateChunk, type ChunkCall, type ChunkReport, type FollowUp } from '../parsing/translate-chunk.ts';
import { DEFAULT_GLOSS, renderContextBlock, renderSystemPromptV2 } from '../context/assemble.ts';
import { gatherContext } from '../context/budget.ts';
import { segmentsBefore } from '../context/glossary.ts';
import { CONTEXT_TAIL_PARAGRAPHS } from '../context/tail.ts';
import type { Rendered } from '../parsing/duplicate.ts';
import { STYLE_LABELS, TRANSLATE_PROMPT_ID, languageLabel } from '../prompts/translate.ts';
import { defineStage, defineStrategy, type AnyStage } from '../runner.ts';
import { createCheckStage } from '../stages/check.ts';
import type { CheckKind } from '../check/checks.ts';
import { estimateTokens } from '../tokens.ts';
import type { EngineEvent, JobOptions, Segment, StageContext, Strategy, TranslationJob, WorkingMemory } from '../types.ts';

export const SINGLE_PASS_ID = 'single-pass';
export const SINGLE_PASS_VERSION = 1;
/** Finals of this strategy carry this revision (a draft; refine's are 2). */
const REVISION = 1;

/** S2 ran translate@1 at 0.2; carried over until the harness says otherwise. */
export const TRANSLATE_TEMPERATURE = 0.2;

export { BUDGET_MESSAGE } from '../budget.ts';
export { CHECK_MESSAGE, UNCHECKED_MESSAGE } from '../stages/check.ts';

export interface ChunkWork {
  chunk: Chunk;
  doc: TranslationJob['doc'];
  options: JobOptions;
}

/** The translate stage's output per chunk (not an EngineEvent: no `type`). */
export interface ChunkOutcome {
  index: number;
  /** Ids sent in this chunk, in order. */
  ids: string[];
  final: string[];
  failed: string[];
  report?: ChunkReport;
  /** The chunk's work, for the check stage's re-request (absent only in hand-made outcomes). */
  work?: ChunkWork;
  /**
   * Contextual only: whether the brief was in working memory when this chunk's prompt was built.
   * The first chunk does not wait for the brief (plan M2-D6), so it is false there unless the job
   * brought its brief; Phase C's `translate@2` renders the brief for exactly the chunks marked true.
   */
  briefed?: boolean;
}

/** How a translate stage waits for the document brief (contextual, plan M2-D6). */
export interface BriefWait {
  /** Settles when the analyze stage is over, brief or no brief. Never rejects. */
  settled: Promise<void>;
  /** Chunks with an index below this go ahead without waiting (the first chunk). */
  freeChunks: number;
}

export interface CheckSummary {
  segments: number;
  final: number;
  failed: number;
  /** Ids the check stage had to fail itself (should be empty). */
  unaccounted: string[];
  /** Post-check failures that led to a re-request, per check kind (a segment may count under several). */
  rerequested: Partial<Record<CheckKind, number>>;
  /** Re-requested segments that came back passing every check. */
  repaired: number;
  /** Re-requested segments that still failed: `segment.failed` (CHECK_MESSAGE or the call's error). */
  checkFailed: string[];
}

export interface SystemPromptVars {
  sourceLang: string;
  targetLang: string;
  style: JobOptions['style'];
}

/** The `translate@1` system block for a document: brief and glossary are "(none)" in M1 (M2 fills them). */
export function renderSystemPrompt(render: (vars: Readonly<Record<string, string>>) => string, vars: SystemPromptVars): string {
  return render({
    TARGET_LANG: languageLabel(vars.targetLang),
    SOURCE_LANG: languageLabel(vars.sourceLang),
    STYLE: STYLE_LABELS[vars.style],
    BRIEF: '(none)',
    GLOSSARY: '(none)',
  });
}

/** §5.7: 2.0 × estimated source tokens of the segments in this call + 12 × their count + the model's reserve. */
export function callBudget(wire: WireChunk, reasoningReserveTokens: number): number {
  const sourceTokens = wire.segments.reduce((n, e) => n + estimateTokens(e.segment.inlineMarkup), 0);
  return maxOutputTokens({ sourceTokens, segments: wire.segments.length, reasoningReserveTokens });
}

/**
 * The request one translate call sends (the strategy and the harness's nonce probe share it, so
 * they cannot drift). `context` (translate@2) is the `<context>` block, put before the segments.
 * `chunkIndex` lets the client's profile pick its thinking, and so its reserve, for this chunk
 * (M2-D16); `attempt` 2 (the repair) asks for the base setting, so a call cut by its thinking is
 * not resent with the same thinking. The prompt depends on neither.
 */
export function translateRequest(client: Pick<LLMClient, 'model' | 'reasoningReserveTokens'>, system: string, wire: WireChunk, signal: AbortSignal, context = '', chunkIndex?: number, attempt = 1, followUp?: FollowUp): NormalizedRequest {
  const thinking = { ...(chunkIndex === undefined ? {} : { chunkIndex }), ...(attempt > 1 ? { baseReasoning: true } : {}) };
  const first = { role: 'user' as const, content: context === '' ? formatWire(wire) : `${context}\n\n${formatWire(wire)}` };
  return {
    ...thinking,
    model: client.model,
    system,
    // The check stage's re-request: the earlier answer, then what to fix (the prompt is unchanged).
    messages: followUp === undefined ? [first] : [first, { role: 'assistant', content: followUp.answer }, { role: 'user', content: followUp.fixes }],
    maxOutputTokens: callBudget(wire, client.reasoningReserveTokens(thinking)),
    temperature: TRANSLATE_TEMPERATURE,
    cacheHint: 'system',
    signal,
  };
}

export const chunkStage = defineStage<TranslationJob, ChunkWork[]>({
  id: 'chunk',
  scope: 'document',
  async *run(job) {
    const chunks = chunkSegments(job.doc.segments, chunkLimits(job.options.chunkTokens));
    yield chunks.map((chunk) => ({ chunk, doc: job.doc, options: job.options }));
  },
});

/** Resolves when `promise` settles; rejects with the abort reason if `signal` aborts first. */
export function untilSettledOrAborted(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
    );
  });
}

/** One chunk through the translate stage: its events, then its outcome as the return value. */
export type TranslateRun = (work: ChunkWork, ctx: StageContext) => AsyncGenerator<EngineEvent, ChunkOutcome>;

/**
 * The translate stage, its finals marked as `strategyId`'s (strategies that extend this one,
 * like `contextual`, reuse it). The source language is the job's, or, when the shell could not
 * tell it, the one the brief read (plan M2 §5: the last link of the detection chain).
 *
 * With `brief` (contextual), a chunk from index `brief.freeChunks` on waits until the analyze
 * stage is over before it builds its prompt; the outcome records whether the brief was there.
 *
 * `revision` marks the finals (1, a draft; contextual's chunk-0 revise pass sends 2, M2-D17).
 *
 * `promptId` picks the prompt: `translate@1` (default) is sent exactly as in M1, brief and
 * glossary "(none)"; `translate@2` gathers the context providers' snippets (ctx.context) for the
 * chunk and assembles the byte-stable system block and the `<context>` block (context/assemble.ts).
 * Only `translate@2` turns on the copy guard (translate-chunk.ts `neighbours`): `translate@1`
 * runs as in M1, so single-pass and its baseline are unchanged.
 */
export function createTranslateStage(strategyId: string, brief?: BriefWait, promptId: string = TRANSLATE_PROMPT_ID, revision: number = REVISION): AnyStage {
  const translate = createTranslateRun(strategyId, brief, promptId, revision);
  return defineStage<ChunkWork, ChunkOutcome>({
    id: 'translate',
    scope: 'chunk',
    role: 'translate',
    promptId,
    async *run(work, ctx) {
      const outcome = yield* translate(work, ctx);
      yield outcome;
    },
  });
}

/** What one chunk's translate calls go through: the first pass, its repair, the check stage's re-request. */
export interface PreparedChunk {
  model: string;
  call: ChunkCall;
  /** translate@2 only: the context tail's translated paragraphs, for the copy guard (translate-chunk.ts). */
  neighbours?: Rendered[];
}

/**
 * Builds a chunk's prompt from `memory` (one snapshot, so a brief landing meanwhile reaches all of
 * it or none) and returns the call that sends it. The source language is the job's, or, when the
 * shell could not tell it, the one the brief read (plan M2 §5).
 */
export async function prepareChunk(work: ChunkWork, ctx: StageContext, memory: Readonly<WorkingMemory>, promptId: string): Promise<PreparedChunk> {
  const client = ctx.llm('translate');
  const prompt = ctx.prompts.get(promptId);
  const sourceLang = work.doc.sourceLang.trim() || (memory.brief?.language ?? '');
  const render = (vars: Readonly<Record<string, string>>) => prompt.render(vars);
  let system: string;
  let context = '';
  let neighbours: Rendered[] | undefined;
  if (prompt.name === 'translate' && prompt.version >= 2) {
    // The tail's translated paragraphs: no segment of this chunk may come back as one of them.
    neighbours = segmentsBefore(work.doc.segments, work.chunk.segments)
      .slice(-CONTEXT_TAIL_PARAGRAPHS)
      .flatMap((s) => {
        const t = memory.translated.get(s.id)?.text;
        return t === undefined ? [] : [{ source: s.inlineMarkup, translation: t }];
      });
    const { segments, ...doc } = work.doc;
    const snippets = await gatherContext(ctx.context, { doc, chunk: work.chunk.segments, targetLang: work.doc.targetLang, segments, memory, options: work.options });
    system = renderSystemPromptV2(render, { sourceLang, targetLang: work.doc.targetLang, style: work.options.style, gloss: work.options.gloss ?? DEFAULT_GLOSS, snippets });
    context = renderContextBlock(snippets);
  } else {
    system = renderSystemPrompt(render, { sourceLang, targetLang: work.doc.targetLang, style: work.options.style });
  }
  const call: ChunkCall = (wire, attempt, followUp) => client.stream(translateRequest(client, system, wire, ctx.signal, context, work.chunk.index, attempt, followUp));
  return { model: client.model, call, ...(neighbours === undefined ? {} : { neighbours }) };
}

/** The translate stage's work for one chunk, typed (createTranslateStage wraps it; contextual's revise pass calls it). */
export function createTranslateRun(strategyId: string, brief?: BriefWait, promptId: string = TRANSLATE_PROMPT_ID, revision: number = REVISION): TranslateRun {
  return async function* (work, ctx) {
    const outcome: ChunkOutcome = { index: work.chunk.index, ids: work.chunk.segments.map((s) => s.id), final: [], failed: [], work };
    if (brief !== undefined && work.chunk.index >= brief.freeChunks) await untilSettledOrAborted(brief.settled, ctx.signal);
    // One snapshot for the whole prompt: a brief landing while this chunk's prompt is being built
    // must not reach part of it (the language, the providers) and miss `briefed`.
    const memory: Readonly<WorkingMemory> = { ...ctx.memory };
    if (brief !== undefined) {
      outcome.briefed = memory.brief !== undefined;
      yield { type: 'chunk', index: outcome.index, briefed: outcome.briefed };
    }
    if (ctx.budget.exhausted()) {
      const error: LLMError = { kind: 'unknown', message: BUDGET_MESSAGE };
      for (const id of outcome.ids) {
        outcome.failed.push(id);
        yield { type: 'segment.failed', id, error };
      }
      return outcome;
    }
    const { model, call, neighbours } = await prepareChunk(work, ctx, memory, promptId);
    const gen = translateChunk(toWire(work.chunk.segments), call, {
      producedBy: { strategy: strategyId, stage: 'translate', model },
      revision,
      role: 'translate',
      ...(neighbours === undefined ? {} : { neighbours }),
      exhausted: () => ctx.budget.exhausted(),
    });
    const shown = new Set<string>();
    for (;;) {
      const next = await gen.next();
      if (next.done) {
        outcome.report = next.value;
        break;
      }
      const event: EngineEvent = next.value;
      if (event.type === 'segment.final') shown.add(event.id);
      else if (event.type === 'segment.failed') {
        outcome.failed.push(event.id);
        // A segment failed after an earlier attempt was shown: the repair plan re-requested it,
        // so that text could not be trusted (translate-chunk.ts). It is not a "last good
        // revision" (§5.6): drop it from memory, where the engine recorded the final before this
        // event (it never records a `failed`). Only this strategy's revision: a later stage's
        // failure must keep the draft.
        if (shown.has(event.id) && ctx.memory.translated.get(event.id)?.revision === revision) ctx.memory.translated.delete(event.id);
      }
      yield event;
    }
    outcome.final = outcome.ids.filter((id) => shown.has(id) && !outcome.failed.includes(id));
    return outcome;
  };
}

/** The check stage of a strategy whose chunks go through `promptId` (stages/check.ts). */
export function createStrategyCheckStage(strategyId: string, promptId: string = TRANSLATE_PROMPT_ID): AnyStage {
  return createCheckStage(strategyId, (work, ctx) => prepareChunk(work, ctx, { ...ctx.memory }, promptId));
}

export const checkStage = createStrategyCheckStage(SINGLE_PASS_ID);

/** Ids of the translate-able segments of a job, as the chunker sends them (for tests and the harness). */
export function translatable(segments: readonly Segment[]): string[] {
  return segments.filter((s) => s.translate).map((s) => s.id);
}

/** The stages in order, for tests and strategies that extend this one (refine, later). */
export const SINGLE_PASS_STAGES: readonly AnyStage[] = [chunkStage, createTranslateStage(SINGLE_PASS_ID), checkStage];

export const singlePass: Strategy = defineStrategy({ id: SINGLE_PASS_ID, version: SINGLE_PASS_VERSION, stages: SINGLE_PASS_STAGES });

/** What the translation cache key must include for this strategy (§5.5, M3): strategy id + version, and the prompt id. */
export const SINGLE_PASS_CACHE_KEY = { strategy: SINGLE_PASS_ID, version: SINGLE_PASS_VERSION, promptId: TRANSLATE_PROMPT_ID } as const;
