// The `explain` stage (plan M5-E8): one call that writes a short note on a block's idioms and
// cultural references (`explain@1`). It runs on the snippet path (`translateSnippet` with the
// `explain` strategy) for one block. The note comes back as the `segment.final`'s `notes`; its
// `text` repeats it, so the event stays a well-formed final. Nothing is cached, nothing is
// retried beyond what the client's own policy does, and a failure is a `segment.failed` for the
// block (§5.6): the translation the reader has stays.
import type { LLMClient, NormalizedRequest } from '../../llm/types.ts';
import { servedOf } from '../served.ts';
import { EXPLAIN_PROMPT_ID } from '../prompts/explain.ts';
import { languageLabel } from '../prompts/translate.ts';
import { defineStage } from '../runner.ts';
import type { Segment, TranslationJob } from '../types.ts';

/** Room for four short sentences in any script. The model's reasoning reserve is added. */
export const EXPLAIN_MAX_OUTPUT_TOKENS = 400;
export const EXPLAIN_TEMPERATURE = 0.3;
/** A note is cut here, whatever the model wrote. */
export const EXPLAIN_NOTE_MAX_CHARS = 800;
export const EXPLAIN_EMPTY_MESSAGE = 'The model returned no explanation';
export const EXPLAIN_CUT_MESSAGE = 'The explanation was cut short';

/** The `<passage>` block the call sends: the block's text as data, its own tags made harmless. */
export function explainInput(segment: Pick<Segment, 'text'>): string {
  const text = segment.text.replace(/<(\/?)passage/gi, '<​$1passage');
  return `<passage>\n${text}\n</passage>`;
}

export function explainRequest(client: Pick<LLMClient, 'model' | 'reasoningReserveTokens'>, system: string, segment: Pick<Segment, 'text'>, signal: AbortSignal): NormalizedRequest {
  return {
    model: client.model,
    system,
    messages: [{ role: 'user', content: explainInput(segment) }],
    maxOutputTokens: EXPLAIN_MAX_OUTPUT_TOKENS + client.reasoningReserveTokens({}),
    temperature: EXPLAIN_TEMPERATURE,
    cacheHint: 'system',
    signal,
  };
}

/** The note as shown: whitespace tidied, cut at the limit. */
export function tidyNote(text: string): string {
  const flat = text.trim().replace(/\n{3,}/g, '\n\n');
  return flat.length > EXPLAIN_NOTE_MAX_CHARS ? `${flat.slice(0, EXPLAIN_NOTE_MAX_CHARS).trimEnd()}…` : flat;
}

export const explainStage = defineStage<TranslationJob, never>({
  id: 'explain',
  scope: 'document',
  role: 'translate',
  promptId: EXPLAIN_PROMPT_ID,
  async *run(job, ctx) {
    const segment = job.doc.segments.find((s) => s.translate);
    if (segment === undefined) return;
    const client = ctx.llm('translate');
    const system = ctx.prompts.get(EXPLAIN_PROMPT_ID).render({ TARGET_LANG: languageLabel(job.doc.targetLang), SOURCE_LANG: languageLabel(job.doc.sourceLang) });
    const req = explainRequest(client, system, segment, ctx.signal);
    let text = '';
    let stopReason: string | undefined;
    for await (const event of client.stream(req)) {
      if (event.type === 'text') {
        text += event.delta;
        yield { type: 'segment.partial', id: segment.id, text: tidyNote(text) };
      } else if (event.type === 'usage') {
        const by = servedOf(client, req);
        yield { type: 'usage', role: 'translate', model: by.model, ...(by.id === undefined ? {} : { client: by.id }), input: event.input, output: event.output, ...(event.cachedInput === undefined ? {} : { cachedInput: event.cachedInput }) };
      } else if (event.type === 'done') stopReason = event.stopReason;
      else if (event.type === 'error') {
        yield { type: 'segment.failed', id: segment.id, error: event.error };
        return;
      }
    }
    const note = tidyNote(text);
    if (note === '') {
      yield { type: 'segment.failed', id: segment.id, error: { kind: 'unknown', message: EXPLAIN_EMPTY_MESSAGE } };
      return;
    }
    if (stopReason === 'max_tokens') {
      yield { type: 'segment.failed', id: segment.id, error: { kind: 'unknown', message: EXPLAIN_CUT_MESSAGE } };
      return;
    }
    const by = servedOf(client, req);
    yield { type: 'segment.final', id: segment.id, text: note, revision: 1, producedBy: { strategy: 'explain', stage: 'explain', model: by.model }, notes: [note] };
  },
});
