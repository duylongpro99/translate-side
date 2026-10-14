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
/** Most examples per chunk. */
export const TM_MAX_EXAMPLES = 3;
/** Most tokens of a chunk's context the examples may take (of the whole context budget). */
export const TM_MAX_TOKENS = 400;

const HEAD = 'Corrections the user made to earlier translations; follow their wording where the same phrasing appears:';

const WORD = /[\p{L}\p{N}]+/gu;
/** Scripts written without spaces between words: a "word" there is a whole phrase, so its characters pair up. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}]/u;

/** The word tokens of `text` (NFKC, lower case); an unspaced-script word gives its character bigrams. */
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const [word] of text.normalize('NFKC').toLowerCase().matchAll(WORD)) {
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
  /** Distinct token count of each example's source. */
  sizes: number[];
  postings: Map<string, number[]>;
}

const indexes = new WeakMap<readonly MemoryExample[], Index>();

function indexOf(memory: readonly MemoryExample[]): Index {
  let index = indexes.get(memory);
  if (index === undefined) {
    const postings = new Map<string, number[]>();
    const sizes = memory.map((e, i) => {
      const set = new Set(tokens(e.source));
      for (const t of set) {
        const list = postings.get(t);
        if (list) list.push(i);
        else postings.set(t, [i]);
      }
      return set.size;
    });
    indexes.set(memory, (index = { sizes, postings }));
  }
  return index;
}

interface Scored {
  at: number;
  score: number;
}

/** The examples of `memory` scoring at least `min` against `text`, best first (ties in memory order). */
function rank(index: Index, text: string, min: number): Scored[] {
  const query = new Set(tokens(text));
  if (query.size === 0) return [];
  // Shared-token counts by entry, in a flat array: common words have long posting lists.
  const shared = new Uint32Array(index.sizes.length);
  const touched: number[] = [];
  for (const t of query) {
    for (const at of index.postings.get(t) ?? []) {
      const n = shared[at] as number;
      if (n === 0) touched.push(at);
      shared[at] = n + 1;
    }
  }
  const out: Scored[] = [];
  for (const at of touched) {
    const score = (2 * (shared[at] as number)) / (query.size + (index.sizes[at] as number));
    if (score >= min) out.push({ at, score });
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
