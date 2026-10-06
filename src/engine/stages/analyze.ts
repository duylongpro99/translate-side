// The `analyze` stage (DESIGN.md §5.3, §5.7 Step 1, plan M2-E1): one call per document, by the
// `analyze` role, that asks for the document brief (`analyze@1`). A brief that parses is put in
// working memory and emitted as an `artifact` event (the panel shows it). Anything else, a
// failed call, a cut answer, invalid JSON, an exhausted budget, is "no brief": the stage yields
// nothing more and the job goes on (plan M2 criterion 5, §5.6). Only an abort stops it.
//
// The stage only fills memory: it yields no output value, so the job passes through to the
// next stage unchanged (runner.ts).
import type { NormalizedRequest } from '../../llm/types.ts';
import { cyrb53 } from '../hash.ts';
import { parseBrief } from '../parsing/brief.ts';
import { ANALYZE_PROMPT_ID, analyzeInput } from '../prompts/analyze.ts';
import { languageLabel } from '../prompts/translate.ts';
import { defineStage } from '../runner.ts';
import type { DocMeta, Segment, TranslationJob } from '../types.ts';

/** Room for the JSON (12 terms with notes fit in ~700 tokens). The model's reasoning reserve is added. */
export const ANALYZE_MAX_OUTPUT_TOKENS = 1024;
export const ANALYZE_TEMPERATURE = 0.2;

/** The brief request for a document (the stage and the harness share it). */
export function analyzeRequest(
  client: { model: string; reasoningReserveTokens: number },
  system: string,
  doc: Pick<DocMeta, 'title' | 'outline'>,
  segments: readonly Segment[],
  signal: AbortSignal,
): NormalizedRequest {
  return {
    model: client.model,
    system,
    messages: [{ role: 'user', content: analyzeInput(doc, segments) }],
    maxOutputTokens: ANALYZE_MAX_OUTPUT_TOKENS + client.reasoningReserveTokens,
    temperature: ANALYZE_TEMPERATURE,
    signal,
  };
}

/**
 * The brief cache key (plan M2 §5, built in M3): `url + contentHash + targetLang + analyze prompt
 * version`. The content hash covers exactly what the brief call sends (title, outline, excerpt),
 * so a page whose opening is unchanged reuses its brief.
 */
export function briefCacheKey(doc: Pick<DocMeta, 'url' | 'title' | 'outline' | 'targetLang'>, segments: readonly Segment[], promptId = ANALYZE_PROMPT_ID): string {
  const contentHash = cyrb53(analyzeInput(doc, segments)).toString(36);
  return JSON.stringify([doc.url, contentHash, doc.targetLang, promptId]);
}

export const analyzeStage = defineStage<TranslationJob, never>({
  id: 'analyze',
  scope: 'document',
  role: 'analyze',
  promptId: ANALYZE_PROMPT_ID,
  async *run(job, ctx) {
    if (ctx.budget.exhausted()) return;
    let text = '';
    let ok = false;
    try {
      const client = ctx.llm('analyze');
      const system = ctx.prompts.get(ANALYZE_PROMPT_ID).render({ TARGET_LANG: languageLabel(job.doc.targetLang) });
      for await (const event of client.stream(analyzeRequest(client, system, job.doc, job.doc.segments, ctx.signal))) {
        if (event.type === 'text') text += event.delta;
        else if (event.type === 'usage') {
          yield { type: 'usage', role: 'analyze', model: client.model, input: event.input, output: event.output, ...(event.cachedInput === undefined ? {} : { cachedInput: event.cachedInput }) };
        } else if (event.type === 'done') ok = event.stopReason === 'end';
      }
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      // No brief: the job goes on (§5.6).
      return;
    }
    // A cut answer (max_tokens, refusal) or a stream error is no brief, even if a prefix parses.
    if (!ok) return;
    const brief = parseBrief(text);
    if (brief === undefined) return;
    ctx.memory.brief = brief;
    yield { type: 'artifact', kind: 'brief', data: brief };
  },
});
