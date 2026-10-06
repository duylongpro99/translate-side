// `single-pass` (DESIGN.md §5.3 "Planned strategies", plan M1-E5): translate(chunk) + check
// (count only). Stages:
//   chunk      document → ChunkWork[]      the chunker (M1-E2) over the job's segments
//   translate  chunk    → ChunkOutcome     translateChunk (M1-E3) with one repair round; this
//                                          stage builds the prompt and the per-call budget
//   check      document → CheckSummary     every segment sent came back final or failed
// The translate stage's `call` (translate-chunk.ts ChunkCall) owns the prompt and maxOutputTokens:
// the system block is `translate@1` rendered once per chunk (identical for every chunk of a
// document, the caching prefix), the user message is the wire chunk, and maxOutputTokens follows
// §5.7 for the segments of THAT call: the whole chunk on attempt 1, only the re-requested segments
// on the repair (a smaller budget, so a repair can't be cut by the first pass's size).

import type { LLMClient, LLMError, NormalizedRequest } from '../../llm/types.ts';
import { maxOutputTokens } from '../budget.ts';
import { chunkLimits, chunkSegments, type Chunk } from '../chunker.ts';
import { formatWire, toWire, type WireChunk } from '../parsing/wire.ts';
import { translateChunk, type ChunkCall, type ChunkReport } from '../parsing/translate-chunk.ts';
import { STYLE_LABELS, TRANSLATE_PROMPT_ID, languageLabel } from '../prompts/translate.ts';
import { defineStage, defineStrategy, type AnyStage } from '../runner.ts';
import { estimateTokens } from '../tokens.ts';
import type { EngineEvent, JobOptions, Segment, Strategy, TranslationJob } from '../types.ts';

export const SINGLE_PASS_ID = 'single-pass';
export const SINGLE_PASS_VERSION = 1;
/** Finals of this strategy carry this revision (a draft; refine's are 2). */
const REVISION = 1;

/** S2 ran translate@1 at 0.2; carried over until the harness says otherwise. */
export const TRANSLATE_TEMPERATURE = 0.2;

export const BUDGET_MESSAGE = 'The job budget was exhausted before this segment was translated';
export const UNCHECKED_MESSAGE = 'The segment was neither translated nor reported failed';

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
}

export interface CheckSummary {
  segments: number;
  final: number;
  failed: number;
  /** Ids the check stage had to fail itself (should be empty). */
  unaccounted: string[];
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

/** The request one translate call sends (the strategy and the harness's nonce probe share it, so they cannot drift). */
export function translateRequest(client: Pick<LLMClient, 'model' | 'reasoningReserveTokens'>, system: string, wire: WireChunk, signal: AbortSignal): NormalizedRequest {
  return {
    model: client.model,
    system,
    messages: [{ role: 'user', content: formatWire(wire) }],
    maxOutputTokens: callBudget(wire, client.reasoningReserveTokens),
    temperature: TRANSLATE_TEMPERATURE,
    cacheHint: 'system',
    signal,
  };
}

const chunkStage = defineStage<TranslationJob, ChunkWork[]>({
  id: 'chunk',
  scope: 'document',
  async *run(job) {
    const chunks = chunkSegments(job.doc.segments, chunkLimits(job.options.chunkTokens));
    yield chunks.map((chunk) => ({ chunk, doc: job.doc, options: job.options }));
  },
});

const translateStage = defineStage<ChunkWork, ChunkOutcome>({
  id: 'translate',
  scope: 'chunk',
  role: 'translate',
  promptId: TRANSLATE_PROMPT_ID,
  async *run(work, ctx) {
    const outcome: ChunkOutcome = { index: work.chunk.index, ids: work.chunk.segments.map((s) => s.id), final: [], failed: [] };
    if (ctx.budget.exhausted()) {
      const error: LLMError = { kind: 'unknown', message: BUDGET_MESSAGE };
      for (const id of outcome.ids) {
        outcome.failed.push(id);
        yield { type: 'segment.failed', id, error };
      }
      yield outcome;
      return;
    }
    const client = ctx.llm('translate');
    const prompt = ctx.prompts.get(TRANSLATE_PROMPT_ID);
    const system = renderSystemPrompt((vars) => prompt.render(vars), { sourceLang: work.doc.sourceLang, targetLang: work.doc.targetLang, style: work.options.style });
    const call: ChunkCall = (wire) => client.stream(translateRequest(client, system, wire, ctx.signal));
    const gen = translateChunk(toWire(work.chunk.segments), call, {
      producedBy: { strategy: SINGLE_PASS_ID, stage: 'translate', model: client.model },
      revision: REVISION,
      role: 'translate',
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
        if (shown.has(event.id) && ctx.memory.translated.get(event.id)?.revision === REVISION) ctx.memory.translated.delete(event.id);
      }
      yield event;
    }
    outcome.final = outcome.ids.filter((id) => shown.has(id) && !outcome.failed.includes(id));
    yield outcome;
  },
});

const checkStage = defineStage<ChunkOutcome[], CheckSummary>({
  id: 'check',
  scope: 'document',
  async *run(outcomes) {
    // Count only (plan M1-E5): every segment sent is final or failed. Marker, code and length
    // checks are M2 (§5.7 Step 4).
    const summary: CheckSummary = { segments: 0, final: 0, failed: 0, unaccounted: [] };
    for (const o of outcomes) {
      const done = new Set([...o.final, ...o.failed]);
      summary.segments += o.ids.length;
      summary.final += o.final.length;
      summary.failed += o.failed.length;
      for (const id of o.ids) {
        if (done.has(id)) continue;
        summary.unaccounted.push(id);
        summary.failed++;
        yield { type: 'segment.failed', id, error: { kind: 'unknown', message: UNCHECKED_MESSAGE } };
      }
    }
    yield summary;
  },
});

/** Ids of the translate-able segments of a job, as the chunker sends them (for tests and the harness). */
export function translatable(segments: readonly Segment[]): string[] {
  return segments.filter((s) => s.translate).map((s) => s.id);
}

/** The stages in order, for tests and strategies that extend this one (refine, later). */
export const SINGLE_PASS_STAGES: readonly AnyStage[] = [chunkStage, translateStage, checkStage];

export const singlePass: Strategy = defineStrategy({ id: SINGLE_PASS_ID, version: SINGLE_PASS_VERSION, stages: SINGLE_PASS_STAGES });

/** What the translation cache key must include for this strategy (§5.5, M3): strategy id + version, and the prompt id. */
export const SINGLE_PASS_CACHE_KEY = { strategy: SINGLE_PASS_ID, version: SINGLE_PASS_VERSION, promptId: TRANSLATE_PROMPT_ID } as const;
