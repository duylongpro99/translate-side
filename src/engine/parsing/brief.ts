// Lenient parsing of the brief call's answer (plan M2 §5 "Brief JSON parsing", criterion 5):
// bare JSON, a ```json fence, or JSON wrapped in prose are all accepted; `jsonMode` is not relied
// on. Anything else, including an answer with no usable field, is "no brief" (undefined), never
// an error: the job goes on without one (§5.6).
//
// The brief is model output that the panel shows and later prompts carry, so it is normalized
// here: strings only, trimmed, length-capped, and a bounded glossary of well-formed entries.
import type { DocumentBrief, GlossaryEntry } from '../types.ts';

/** Per string field, in characters. */
export const BRIEF_FIELD_MAX = 300;
export const BRIEF_GLOSSARY_MAX = 20;
const TERM_MAX = 120;

export function parseBrief(text: string): DocumentBrief | undefined {
  for (const candidate of jsonCandidates(text)) {
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch {
      continue;
    }
    const brief = normalizeBrief(value);
    if (brief !== undefined) return brief;
  }
  return undefined;
}

/** Normalizes a parsed value into a brief; undefined when it holds no usable field. */
export function normalizeBrief(value: unknown): DocumentBrief | undefined {
  if (!isRecord(value)) return undefined;
  const brief: DocumentBrief = {
    genre: field(value.genre),
    audience: field(value.audience),
    purpose: field(value.purpose),
    tone: field(value.tone),
    glossary: glossary(value.glossary),
  };
  const language = languageTag(value.language);
  if (language !== undefined) brief.language = language;
  const empty = !brief.genre && !brief.audience && !brief.purpose && !brief.tone && brief.glossary.length === 0;
  return empty ? undefined : brief;
}

/**
 * Texts that may be the JSON object, most likely first: the fenced blocks, then each balanced
 * `{…}` span of the whole answer (prose before and after is skipped).
 */
function jsonCandidates(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/```[a-zA-Z]*[^\S\n]*\n?([\s\S]*?)```/g)) if (m[1] !== undefined) out.push(m[1].trim());
  out.push(...objectSpans(text));
  return out;
}

/** Balanced top-level `{…}` spans, skipping braces inside JSON strings. */
function objectSpans(text: string): string[] {
  const spans: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"' && depth > 0) inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0) spans.push(text.slice(start, i + 1));
    }
  }
  return spans;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value: unknown, max = BRIEF_FIELD_MAX): string {
  if (typeof value !== 'string') return '';
  const s = value.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function glossary(value: unknown): GlossaryEntry[] {
  if (!Array.isArray(value)) return [];
  const out: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const term = field(item.term, TERM_MAX);
    const rendering = field(item.rendering, TERM_MAX);
    if (!term || !rendering || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    const note = field(item.note);
    out.push(note ? { term, rendering, note } : { term, rendering });
    if (out.length === BRIEF_GLOSSARY_MAX) break;
  }
  return out;
}

/** A plausible BCP 47 tag ("en", "pt-BR", "zh-Hant"); anything else is dropped. */
function languageTag(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  return /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(s) && s.toLowerCase() !== 'und' ? s : undefined;
}
