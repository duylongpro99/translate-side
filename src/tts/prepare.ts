// Text preparation for cloud voices: one LLM call, `tts-prepare@1`, on
// the page's translation route, turns a block into speakable text plus a short delivery note. It
// only helps: any failure, a refusal, a timeout or an answer that drifts from the block falls back
// to the block as it is (the cloud engine still applies the rule-based speakable.ts). The system
// voice never comes here.
import { ttsPrepareV1 } from '@/engine/prompts/tts-prepare';
import type { LLMClient } from '@/llm/types';
import type { UsageTotals } from '@/shared/cost';
import type { Prepared } from './controller.ts';
import { normalize } from './speakable.ts';

/** The call gets this long for the block the reader is waiting on; then it is read as it is. */
export const PREPARE_TIMEOUT_MS = 1500;
/**
 * And this long for a block prepared ahead, while the one before it plays: it delays nothing, and a
 * real route answers in 2–4 s with thinking off (measured 2026-10-26 on qwen3.8-flash and gpt-oss:20b).
 */
export const AHEAD_TIMEOUT_MS = 8000;
/**
 * The prepared text may be this much longer or shorter than the block's rule-based speakable form
 * (numbers already written out, which alone can triple a Vietnamese block), or it is not used.
 */
export const MAX_DRIFT = 0.3;
export const MAX_NOTE_WORDS = 30;

const languageName = (lang: string) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) ?? lang;
  } catch {
    return lang;
  }
};

/** The block as data: the model is told it is never an instruction (the prompt), and no tag inside it can close ours. */
const fence = (tag: string, text: string) => `<${tag}>${text.replace(/<\/?(block|before|after)>/gi, '')}</${tag}>`;

/** `{text, note}` from the model's answer, or undefined when it is not usable. `baseline`: the block's speakable form. */
export function readAnswer(answer: string, baseline: string): Prepared | undefined {
  const json = answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { text, note } = parsed as { text?: unknown; note?: unknown };
  if (typeof text !== 'string' || text.trim() === '') return undefined;
  const drift = Math.abs(text.length - baseline.length) / Math.max(1, baseline.length);
  if (drift > MAX_DRIFT) return undefined;
  const words = typeof note === 'string' ? note.trim().split(/\s+/).filter(Boolean) : [];
  return words.length > 0 ? { text: text.trim(), note: words.slice(0, MAX_NOTE_WORDS).join(' ') } : { text: text.trim() };
}

export interface PrepareInput {
  text: string;
  lang: string;
  /** Prepared ahead of playback (AHEAD_TIMEOUT_MS), not for a block the reader waits on. */
  ahead?: boolean;
  before?: string | undefined;
  after?: string | undefined;
}

export async function prepare(client: LLMClient, input: PrepareInput, { signal, timeoutMs = input.ahead ? AHEAD_TIMEOUT_MS : PREPARE_TIMEOUT_MS, onUsage }: { signal?: AbortSignal; timeoutMs?: number; onUsage?: (u: UsageTotals) => void } = {}): Promise<Prepared> {
  const fallback: Prepared = { text: input.text };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  const onAbort = () => ac.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const user = [input.before ? fence('before', input.before) : '', fence('block', input.text), input.after ? fence('after', input.after) : ''].filter(Boolean).join('\n');
    let answer = '';
    for await (const event of client.stream({
      model: client.model,
      system: ttsPrepareV1.render({ LANGUAGE: languageName(input.lang) }),
      messages: [{ role: 'user', content: user }],
      maxOutputTokens: Math.ceil(input.text.length / 2) + 200,
      temperature: 0.2,
      jsonMode: true,
      signal: ac.signal,
    })) {
      if (event.type === 'text') answer += event.delta;
      else if (event.type === 'usage') onUsage?.({ input: event.input, cachedInput: event.cachedInput ?? 0, output: event.output });
      else if (event.type === 'error') return fallback;
    }
    return readAnswer(answer, normalize(input.text, input.lang)) ?? fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
