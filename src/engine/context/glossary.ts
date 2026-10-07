// GlossaryProvider (DESIGN.md §5.4, plan M2-E2): the personal glossary (settings, in working memory)
// and the auto glossary (the brief's terms), merged with the user's entries first: on the same
// term (case-insensitive) the user's entry wins and the brief's is dropped (§5.7 "user overrides
// take priority"). Two snippets:
// - document-scoped, the glossary list (translate@2's GLOSSARY slot). It depends only on memory,
//   so it is the same for every briefed chunk. The user's entries come first, so they get the
//   budget first; entries that don't fit are cut from the end (the brief's terms before any of the
//   user's), the same cut for every chunk, keeping room for the chunk snippet below (fitGlossary). The options page warns when the user's entries alone
//   pass PERSONAL_GLOSSARY_PROMPT_TOKENS (budget.ts);
// - chunk-scoped, the listed terms that already occur in the running text before this chunk, each
//   with its rendering, so the model glosses a term only at its first occurrence in the document
//   (plan M2 §5, M2-D1) and keeps rendering it as listed. It is computed from the source in page
//   order, so it doesn't depend on which chunk finished first. Headings and inline code are not
//   running text: the gloss rule puts no gloss there, so a term seen only there is still unglossed.
// A term (or a keep-as-is rendering) that is the content of a backtick span somewhere in the
// document is shown in backticks in both snippets, so the model keeps it as code (Phase D).
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

/** How the user's keep-as-is entry is marked in the glossary list: never translated, never glossed. */
export const KEEP_AS_IS_MARK = '(keep as is: write it exactly like this, never translate it, never gloss it)';
/**
 * How the brief's keep-in-English entry is marked (round 8, M2-D1 "first occurrence only, for
 * glossary terms and terms with no common equivalent"): kept, and glossed once at its first use.
 */
export const KEEP_ENGLISH_MARK = '(keep it in English, and add a short gloss in parentheses at its first use in the document, once)';

/**
 * How an entry with a rendering is marked (round 12: a briefed chunk wrote "deploy" bare against
 * "deploy → triển khai"): the rendering, every time.
 */
export const RENDER_MARK = '(always write it this way, in every segment)';

/** Where a glossary entry comes from: the user's settings, or the brief's terms. */
export type GlossarySource = 'personal' | 'brief';
/** The head of the chunk snippet listing the terms used before this chunk (no gloss for them). */
export const USED_TERMS_HEAD = 'Glossary terms already used earlier in the document, so already glossed: write each exactly as rendered after its arrow, with no gloss and no parentheses after it, in every segment below, headings included: ';

/**
 * The contents of the document's backtick spans: a glossary term equal to one is code in the
 * source, so the list shows it in backticks (Phase D: the brief listed `Cargo.toml` bare, and the
 * model followed it and dropped the backticks).
 */
export function codeTerms(segments: readonly Segment[]): Set<string> {
  const out = new Set<string>();
  for (const s of segments) for (const m of s.inlineMarkup.matchAll(/`([^`]+)`/g)) out.add((m[1] ?? '').trim());
  return out;
}

/** `text` as the list shows it: in backticks when it is code in the source. */
function shown(text: string, code: ReadonlySet<string>): string {
  const t = text.trim();
  return code.has(t) ? `\`${t}\`` : t;
}

/** One glossary line. Tags are neutralised: the brief's terms are model output over page text (§8). */
export function renderGlossaryEntry(e: GlossaryEntry, from: GlossarySource = 'personal', code: ReadonlySet<string> = new Set()): string {
  const term = neutralizeContextTags(shown(e.term, code));
  const head = keepsTerm(e) ? `- ${term} → ${term} ${from === 'personal' ? KEEP_AS_IS_MARK : KEEP_ENGLISH_MARK}` : `- ${term} → ${neutralizeContextTags(shown(e.rendering, code))} ${RENDER_MARK}`;
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

/**
 * The running text before the chunk, where a first use gets its gloss: no headings, and no inline
 * code (backtick spans). One segment per line ("\n" is a word boundary, so no match spans two).
 */
export function runningTextBefore(segments: readonly Segment[], chunk: readonly Segment[]): string {
  return segmentsBefore(segments, chunk)
    .filter((s) => s.kind !== 'heading' && s.kind !== 'code')
    .map((s) => s.inlineMarkup.replace(/`[^`\n]*`/g, ' '))
    .join('\n');
}

/** The chunk snippet naming the listed terms already used before the chunk, each with its rendering. */
export function usedTermsLine(entries: readonly Pick<GlossaryEntry, 'term' | 'rendering'>[], code: ReadonlySet<string> = new Set()): string {
  const item = (e: Pick<GlossaryEntry, 'term' | 'rendering'>) => {
    const term = neutralizeContextTags(shown(e.term, code));
    return `${term} → ${keepsTerm({ term: e.term, rendering: e.rendering }) ? term : neutralizeContextTags(shown(e.rendering, code))}`;
  };
  return `${USED_TERMS_HEAD}${entries.map(item).join('; ')}`;
}

/**
 * The entries the glossary list keeps within `maxTokens`, in order, cut from the end. Room is kept
 * for the used-terms line naming every listed term (review N1): a big glossary, which fills its
 * share, is where the model most needs that line not to gloss a term again. The reserve is for the
 * worst case, so the cut depends only on the entries, the same for every chunk (byte-stable list).
 */
export function fitGlossary(
  entries: readonly GlossaryEntry[],
  maxTokens: number,
  sourceOf: (e: GlossaryEntry) => GlossarySource = () => 'personal',
  code: ReadonlySet<string> = new Set(),
): { listed: GlossaryEntry[]; lines: string[]; tokens: number } {
  const listed: GlossaryEntry[] = [];
  const lines: string[] = [];
  let list = 0;
  let tokens = 0;
  for (const e of entries) {
    const line = renderGlossaryEntry(e, sourceOf(e), code);
    const withLine = list + estimateTokens(`${line}\n`);
    const total = withLine + estimateTokens(usedTermsLine([...listed, e], code));
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
    const personal = new Set(q.memory.glossary.map((e) => key(e.term)));
    // From every segment of the document, not the chunk: the list stays the same for every chunk.
    const code = codeTerms(q.segments);
    const { listed, lines } = fitGlossary(entries, q.maxTokens, (e) => (personal.has(key(e.term)) ? 'personal' : 'brief'), code);
    if (lines.length === 0) return [];
    const out: ContextSnippet[] = [{ providerId: GLOSSARY_PROVIDER_ID, scope: 'document', text: lines.join('\n') }];
    // One pattern per term over the running text before the chunk. Its room was kept by fitGlossary.
    const before = runningTextBefore(q.segments, q.chunk);
    const used = before === '' ? [] : listed.filter((e) => termPattern(e.term)?.test(before));
    if (used.length) out.push({ providerId: GLOSSARY_PROVIDER_ID, scope: 'chunk', text: usedTermsLine(used, code) });
    return out;
  },
};
