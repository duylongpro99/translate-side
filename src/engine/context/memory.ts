// TranslationMemoryProvider (DESIGN.md §5.4): the user's most similar earlier corrections as a
// chunk-scoped snippet (the user message's <context> block, marked do-not-translate), so the
// model follows their wording where the same phrasing comes up again. Similarity is lexical
// (Dice coefficient over word tokens, character bigrams for scripts written without spaces): no
// embeddings, no network. The examples arrive only through `JobOptions.memory`; what may be sent
// where is the shell's call, the engine ranks what it is given.
//
// Cost: the index (token → entries) is built once per `memory` array; a chunk scores only the
// entries that share a token with it. Without examples the provider returns nothing, so a prompt
// is byte-identical to one built without it.
import { estimateTokens } from '../tokens.ts';
import type { ContextProvider, ContextSnippet, MemoryExample } from '../types.ts';
import { pair } from './assemble.ts';

export const TRANSLATION_MEMORY_PROVIDER_ID = 'translation-memory';
/** The stage event that reports which memory entries a chunk's prompt used (`info: { chunk, memory: refs }`). */
export const CONTEXT_STAGE = 'context';
/** The lowest Dice score an example needs to be offered. */
export const TM_MIN_SIMILARITY = 0.5;
/**
 * The fewest words an example and a chunk segment must share (unless their word sets are equal):
 * a single shared word makes "Sign in" and "Sign out" look alike (0.5), and a lone one is no phrasing to follow.
 */
export const TM_MIN_SHARED = 2;
/** Most examples per chunk. */
export const TM_MAX_EXAMPLES = 3;
/** Most tokens of a chunk's context the examples may take (of the whole context budget). */
export const TM_MAX_TOKENS = 400;

const HEAD = 'Corrections the user made to earlier translations; follow their wording where the same phrasing appears:';

/** The light markers of a link: they come with every link text, and are no words of it. */
const LINK_MARKERS = /\[\/?link\]/g;
const WORD = /[\p{L}\p{N}]+/gu;
/** Scripts written without spaces between words: a "word" there is a whole phrase, so its characters pair up. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}]/u;

/** The word tokens of `text` (NFKC, lower case); an unspaced-script word gives its character bigrams. */
export function tokens(text: string): string[] {
  // Markers are dropped on both sides: `[link]Home[/link]` and `[link]Help[/link]` share no word.
  const folded = text.normalize('NFKC').toLowerCase().replace(LINK_MARKERS, ' ');
  const words = folded.match(WORD) ?? [];
  // Most text has no unspaced script at all: one test for the whole text, not one per word.
  if (!UNSPACED.test(folded)) return words;
  const out: string[] = [];
  for (const word of words) {
    if (!UNSPACED.test(word)) {
      out.push(word);
      continue;
    }
    const chars = [...word];
    if (chars.length === 1) out.push(word);
    else for (let i = 0; i + 1 < chars.length; i++) out.push(`${chars[i]}${chars[i + 1]}`);
  }
  return out;
}

/** Dice coefficient of two texts' token sets: 2·|A∩B| ÷ (|A|+|B|), 0 when either has no tokens. */
export function similarity(a: string, b: string): number {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return (2 * shared) / (x.size + y.size);
}

interface Index {
  /** Distinct tokens of each example's source. */
  sets: Set<string>[];
  postings: Map<string, number[]>;
}

const indexes = new WeakMap<readonly MemoryExample[], Index>();

function indexOf(memory: readonly MemoryExample[]): Index {
  let index = indexes.get(memory);
  if (index === undefined) {
    const postings = new Map<string, number[]>();
    const sets = memory.map((e, i) => {
      const set = new Set(tokens(e.source));
      for (const t of set) {
        const list = postings.get(t);
        if (list) list.push(i);
        else postings.set(t, [i]);
      }
      return set;
    });
    indexes.set(memory, (index = { sets, postings }));
  }
  return index;
}

interface Scored {
  at: number;
  score: number;
}

/**
 * The examples of `memory` scoring at least `min` against `text`, best first (ties in memory order).
 * A Dice score of `min` needs at least ⌈min·|q| ÷ (2 − min)⌉ shared tokens (and never fewer than TM_MIN_SHARED), so a candidate must hold
 * one of any |q| − that + 1 of the query's tokens: only the rarest ones are looked up (the common
 * words of a long passage have the longest lists), and each candidate is then scored exactly.
 */
function rank(index: Index, text: string, min: number): Scored[] {
  const query = new Set(tokens(text));
  if (query.size === 0) return [];
  // A one-word query can only match an example of that one word; any other needs TM_MIN_SHARED words.
  const need = query.size === 1 ? 1 : Math.max(TM_MIN_SHARED, Math.ceil((min * query.size) / (2 - min) - 1e-9));
  const lists = [...query].map((t) => index.postings.get(t)).filter((l): l is number[] => l !== undefined);
  lists.sort((p, q) => p.length - q.length);
  const seen = new Set<number>();
  const out: Scored[] = [];
  // Tokens no example has count among the rarest: fewer lists remain to look through.
  const absent = query.size - lists.length;
  for (const list of lists.slice(0, Math.max(0, query.size - need + 1 - absent))) {
    for (const at of list) {
      if (seen.has(at)) continue;
      seen.add(at);
      const set = index.sets[at] as Set<string>;
      let shared = 0;
      for (const t of set) if (query.has(t)) shared++;
      if (shared < TM_MIN_SHARED && !(shared === query.size && shared === set.size)) continue;
      const score = (2 * shared) / (query.size + set.size);
      if (score >= min) out.push({ at, score });
    }
  }
  return out.sort((p, q) => q.score - p.score || p.at - q.at);
}

export const translationMemoryProvider: ContextProvider = {
  id: TRANSLATION_MEMORY_PROVIDER_ID,
  maxTokens: TM_MAX_TOKENS,
  async provide(q): Promise<ContextSnippet[]> {
    const memory = q.options.memory;
    if (memory === undefined || memory.length === 0) return [];
    const index = indexOf(memory);
    // Each segment's candidates; an example's score is its best over the chunk's segments.
    const perSegment = q.chunk.filter((s) => s.translate).map((s) => rank(index, s.inlineMarkup || s.text, TM_MIN_SIMILARITY));
    const best = new Map<number, number>();
    for (const list of perSegment) for (const { at, score } of list) if (score > (best.get(at) ?? 0)) best.set(at, score);
    if (best.size === 0) return [];
    // The best example of every segment first, then the rest by score; at most TM_MAX_EXAMPLES.
    const chosen: number[] = [];
    const firsts = perSegment.flatMap((list) => (list[0] ? [list[0]] : [])).sort((p, r) => r.score - p.score || p.at - r.at);
    for (const { at } of firsts) if (!chosen.includes(at)) chosen.push(at);
    const rest = [...best].map(([at, score]) => ({ at, score })).sort((p, r) => r.score - p.score || p.at - r.at);
    for (const { at } of rest) if (!chosen.includes(at)) chosen.push(at);

    let left = Math.min(q.maxTokens, TM_MAX_TOKENS) - estimateTokens(`${HEAD}\n`);
    const parts: string[] = [];
    const refs: { id: string; score: number }[] = [];
    for (const at of chosen) {
      if (parts.length === TM_MAX_EXAMPLES) break;
      const example = memory[at] as MemoryExample;
      const text = pair(example.source, example.target);
      const cost = estimateTokens(`${text}\n`);
      if (cost > left) continue;
      left -= cost;
      parts.push(text);
      refs.push({ id: example.id, score: Math.round((best.get(at) as number) * 1000) / 1000 });
    }
    if (parts.length === 0) return [];
    return [{ providerId: TRANSLATION_MEMORY_PROVIDER_ID, scope: 'chunk', text: [HEAD, ...parts].join('\n'), refs }];
  },
};
