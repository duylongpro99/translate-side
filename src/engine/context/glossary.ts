// GlossaryProvider (DESIGN.md §5.4, plan M2-E2): the personal glossary (settings, in working memory)
// and the auto glossary (the brief's terms), merged with the user's entries first: on the same
// term (case-insensitive) the user's entry wins and the brief's is dropped (§5.7 "user overrides
// take priority"). Two snippets:
// - document-scoped, the glossary list (translate@2's GLOSSARY slot). It depends only on memory,
//   so it is the same for every briefed chunk. The user's entries come first, so they get the
//   budget first; entries that don't fit are cut from the end (the brief's terms before any of the
//   user's), the same cut for every chunk, keeping room for the chunk snippet below (fitGlossary). The options page warns when the user's entries alone
//   pass PERSONAL_GLOSSARY_PROMPT_TOKENS (budget.ts);
// - chunk-scoped, the listed terms that already occur in the source before this chunk, so the
//   model glosses a term only at its first occurrence in the document (plan M2 §5, M2-D1). It is
//   computed from the source in page order, so it doesn't depend on which chunk finished first.
import { cyrb53 } from '../hash.ts';
import { estimateTokens } from '../tokens.ts';
import type { ContextProvider, ContextSnippet, GlossaryEntry, Segment } from '../types.ts';
import { GLOSSARY_PROVIDER_ID, neutralizeContextTags } from './assemble.ts';

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

/** One glossary line. Tags are neutralised: the brief's terms are model output over page text (§8). */
export function renderGlossaryEntry(e: GlossaryEntry): string {
  const term = neutralizeContextTags(e.term.trim());
  const head = keepsTerm(e) ? `- ${term} → ${term} ${KEEP_AS_IS_MARK}` : `- ${term} → ${neutralizeContextTags(e.rendering.trim())}`;
  const note = e.note?.trim();
  return note ? `${head} — ${neutralizeContextTags(note)}` : head;
}

/** For the translation cache key (DESIGN §7, built in M3): the personal glossary as sent. */
export function glossaryHash(entries: readonly GlossaryEntry[]): string {
  return cyrb53(JSON.stringify(entries.map((e) => [e.term.trim(), e.rendering.trim(), e.note?.trim() ?? '']))).toString(36);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The whole-word, case-insensitive pattern for `term`; undefined for a blank term. */
export function termPattern(term: string): RegExp | undefined {
  const t = term.trim();
  if (t === '') return undefined;
  // \b only where the term starts/ends with a word character ("async fn", ".await", "I/O").
  const start = /^\w/.test(t) ? '\\b' : '';
  const end = /\w$/.test(t) ? '\\b' : '';
  return new RegExp(`${start}${escapeRe(t)}${end}`, 'i');
}

/** Whether `term` occurs in `text` as a whole word (case-insensitive). */
export function mentions(text: string, term: string): boolean {
  return termPattern(term)?.test(text) ?? false;
}

/** The translatable segments before the chunk's first one, in page order. */
export function segmentsBefore(segments: readonly Segment[], chunk: readonly Segment[]): Segment[] {
  const first = chunk[0];
  if (first === undefined) return [];
  const at = segments.findIndex((s) => s.id === first.id);
  return (at < 0 ? [] : segments.slice(0, at)).filter((s) => s.translate);
}

/** The chunk snippet naming the listed terms already used before the chunk. */
export function usedTermsLine(terms: readonly string[]): string {
  return `${USED_TERMS_HEAD}${terms.map((t) => neutralizeContextTags(t.trim())).join(', ')}`;
}

/**
 * The entries the glossary list keeps within `maxTokens`, in order, cut from the end. Room is kept
 * for the used-terms line naming every listed term (review N1): a big glossary, which fills its
 * share, is where the model most needs that line not to gloss a term again. The reserve is for the
 * worst case, so the cut depends only on the entries, the same for every chunk (byte-stable list).
 */
export function fitGlossary(entries: readonly GlossaryEntry[], maxTokens: number): { listed: GlossaryEntry[]; lines: string[]; tokens: number } {
  const listed: GlossaryEntry[] = [];
  const lines: string[] = [];
  let list = 0;
  let tokens = 0;
  for (const e of entries) {
    const line = renderGlossaryEntry(e);
    const withLine = list + estimateTokens(`${line}\n`);
    const total = withLine + estimateTokens(usedTermsLine([...listed, e].map((x) => x.term)));
    if (total > maxTokens) break;
    listed.push(e);
    lines.push(line);
    list = withLine;
    tokens = total;
  }
  return { listed, lines, tokens };
}

export const glossaryProvider: ContextProvider = {
  id: GLOSSARY_PROVIDER_ID,
  async provide(q) {
    const entries = mergeGlossary(q.memory.glossary, q.memory.brief?.glossary ?? []);
    const { listed, lines } = fitGlossary(entries, q.maxTokens);
    if (lines.length === 0) return [];
    const out: ContextSnippet[] = [{ providerId: GLOSSARY_PROVIDER_ID, scope: 'document', text: lines.join('\n') }];
    // One pattern per term over the text before the chunk, joined once ("\n" is a word boundary,
    // so no match spans two segments). Its room was kept by fitGlossary.
    const before = segmentsBefore(q.segments, q.chunk).map((s) => s.text).join('\n');
    const used = before === '' ? [] : listed.filter((e) => termPattern(e.term)?.test(before)).map((e) => e.term);
    if (used.length) out.push({ providerId: GLOSSARY_PROVIDER_ID, scope: 'chunk', text: usedTermsLine(used) });
    return out;
  },
};
