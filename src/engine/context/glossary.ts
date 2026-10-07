// GlossaryProvider (DESIGN.md §5.4, plan M2-E2): the personal glossary (settings, in working memory)
// and the auto glossary (the brief's terms), merged with the user's entries first: on the same
// term (case-insensitive) the user's entry wins and the brief's is dropped (§5.7 "user overrides
// take priority"). Two snippets:
// - document-scoped, the glossary list (translate@2's GLOSSARY slot). It depends only on memory,
//   so it is the same for every briefed chunk; entries that don't fit the budget are cut from the
//   end (the brief's terms go first), the same cut for every chunk;
// - chunk-scoped, the listed terms that already occur in the source before this chunk, so the
//   model glosses a term only at its first occurrence in the document (plan M2 §5, M2-D1). It is
//   computed from the source in page order, so it doesn't depend on which chunk finished first.
import { cyrb53 } from '../hash.ts';
import { estimateTokens } from '../tokens.ts';
import type { ContextProvider, ContextSnippet, GlossaryEntry, Segment } from '../types.ts';
import { GLOSSARY_PROVIDER_ID } from './assemble.ts';

const key = (term: string) => term.trim().toLowerCase();

/** The user's entries first, then the brief's that name another term; blank terms and repeats dropped. */
export function mergeGlossary(personal: readonly GlossaryEntry[], auto: readonly GlossaryEntry[]): GlossaryEntry[] {
  const seen = new Set<string>();
  const out: GlossaryEntry[] = [];
  for (const e of [...personal, ...auto]) {
    const k = key(e.term);
    if (k === '' || seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/** "Keep as is": a rendering equal to the term (or empty). */
export function keepsTerm(e: GlossaryEntry): boolean {
  return e.rendering.trim() === '' || e.rendering.trim() === e.term.trim();
}

/** How a keep-as-is entry is marked in the glossary list: never translated, never glossed. */
export const KEEP_AS_IS_MARK = '(keep as is: write it exactly like this, never translate it, never gloss it)';
/** The head of the chunk snippet listing the terms used before this chunk (no gloss for them). */
export const USED_TERMS_HEAD = 'Terms already used earlier in the document, so already glossed: write each with no gloss and no parentheses after it in every segment below, headings included: ';

export function renderGlossaryEntry(e: GlossaryEntry): string {
  const term = e.term.trim();
  const head = keepsTerm(e) ? `- ${term} → ${term} ${KEEP_AS_IS_MARK}` : `- ${term} → ${e.rendering.trim()}`;
  const note = e.note?.trim();
  return note ? `${head} — ${note}` : head;
}

/** For the translation cache key (DESIGN §7, built in M3): the personal glossary as sent. */
export function glossaryHash(entries: readonly GlossaryEntry[]): string {
  return cyrb53(JSON.stringify(entries.map((e) => [e.term.trim(), e.rendering.trim(), e.note?.trim() ?? '']))).toString(36);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `term` occurs in `text` as a whole word (case-insensitive). */
export function mentions(text: string, term: string): boolean {
  const t = term.trim();
  if (t === '') return false;
  // \b only where the term starts/ends with a word character ("async fn", ".await", "I/O").
  const start = /^\w/.test(t) ? '\\b' : '';
  const end = /\w$/.test(t) ? '\\b' : '';
  return new RegExp(`${start}${escapeRe(t)}${end}`, 'i').test(text);
}

/** The translatable segments before the chunk's first one, in page order. */
export function segmentsBefore(segments: readonly Segment[], chunk: readonly Segment[]): Segment[] {
  const first = chunk[0];
  if (first === undefined) return [];
  const at = segments.findIndex((s) => s.id === first.id);
  return (at < 0 ? [] : segments.slice(0, at)).filter((s) => s.translate);
}

export const glossaryProvider: ContextProvider = {
  id: GLOSSARY_PROVIDER_ID,
  async provide(q) {
    const entries = mergeGlossary(q.memory.glossary, q.memory.brief?.glossary ?? []);
    if (entries.length === 0) return [];
    const lines: string[] = [];
    let left = q.maxTokens;
    const listed: GlossaryEntry[] = [];
    for (const e of entries) {
      const line = renderGlossaryEntry(e);
      const cost = estimateTokens(`${line}\n`);
      if (cost > left) break;
      lines.push(line);
      listed.push(e);
      left -= cost;
    }
    if (lines.length === 0) return [];
    const out: ContextSnippet[] = [{ providerId: GLOSSARY_PROVIDER_ID, scope: 'document', text: lines.join('\n') }];
    const before = segmentsBefore(q.segments, q.chunk);
    const used = listed.filter((e) => before.some((s) => mentions(s.text, e.term))).map((e) => e.term.trim());
    if (used.length) {
      const text = `${USED_TERMS_HEAD}${used.join(', ')}`;
      if (estimateTokens(text) <= left) out.push({ providerId: GLOSSARY_PROVIDER_ID, scope: 'chunk', text });
    }
    return out;
  },
};
