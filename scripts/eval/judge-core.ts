// LLM-as-judge (plan M2-E8, M2-D2): a stronger Gemini model scores each passage 1–5 on the four rubric dimensions.
// Human scores stay the source of truth; the report puts the two side by side before the judge is used as a gate.
import { DIMENSIONS, RUBRIC } from './rubric.ts';
import type { OutputItem } from './runs.ts';

/**
 * Pinned judge: a fixed model ID so scores stay comparable between runs (plan §5, M2-D2). Stronger than the
 * translator (gemini-3.5-flash-lite). Probed 2026-10-06 with the project's key: the Pro models answer 429 (the key's
 * tier has no Pro allowance), 3.8/3.6/3.5 Flash answered 503 (overloaded) on every try, 3.7 Flash answered.
 * Change it only together with re-scoring the baseline. `--model` overrides for a trial.
 */
export const JUDGE_MODEL = 'gemini-3.7-flash';
export const JUDGE_PROMPT_ID = 'judge@1';

export function judgeSystemPrompt(targetLang: string): string {
  const rubric = DIMENSIONS.map((d) => `${d}: ${RUBRIC[d].question}\n  1 = ${RUBRIC[d].anchors[1]}\n  3 = ${RUBRIC[d].anchors[3]}\n  5 = ${RUBRIC[d].anchors[5]}`).join('\n');
  return [
    `You are a strict, experienced translation reviewer. You compare English source passages with their translation into ${targetLang} and score the translation.`,
    '',
    'Score each dimension with a whole number from 1 to 5 (2 and 4 sit between the anchors):',
    rubric,
    '',
    'Rules:',
    '- Judge the translation only against the source passage given. Do not reward length or polish that the source does not have.',
    '- Segments are numbered; markers such as *emphasis*, `code` and [link]…[/link] belong to the source markup and should survive in the translation.',
    '- Code blocks are left out of the comparison.',
    '- Use the full range; reserve 5 for a translation you could not improve.',
    '',
    'Answer with one JSON object and nothing else:',
    '{"fidelity": n, "naturalness": n, "tone": n, "terminology": n, "comment": "one or two sentences naming the main weakness"}',
  ].join('\n');
}

export function judgeUserPrompt(title: string, items: OutputItem[]): string {
  const body = items
    .filter((it) => it.translate && it.kind !== 'code')
    .map((it, i) => `[${i + 1}] SOURCE: ${it.source}\n[${i + 1}] TRANSLATION: ${it.text ?? '(missing)'}`)
    .join('\n\n');
  return `Passage: ${title}\n\n${body}`;
}
