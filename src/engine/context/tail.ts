// ContextTailProvider (DESIGN.md §5.4, §5.7 Step 2, plan M2-E2): the last 1–2 source paragraphs
// before the chunk, each with its translation when it is already done, as a chunk-scoped snippet
// (the user message's <context> block, marked do-not-translate). It keeps pronouns, connectives
// and tone continuous across chunk boundaries. Chunks run in parallel, so the previous chunk may
// still be in flight: a paragraph without a translation yet is sent as source only.
//
// Budget: what the brief and glossary left, at most CONTEXT_TAIL_MAX_TOKENS (plan M2 §5). The
// nearest paragraph goes first; if even it doesn't fit, its end is sent, cut at a word.
import { CHARS_PER_TOKEN, estimateTokens } from '../tokens.ts';
import type { ContextProvider } from '../types.ts';
import { neutralizeContextTags } from './assemble.ts';
import { segmentsBefore } from './glossary.ts';

export const CONTEXT_TAIL_PROVIDER_ID = 'context-tail';
/** Plan M2 §5: the tail gets what remains, capped at ~300 tokens. */
export const CONTEXT_TAIL_MAX_TOKENS = 300;
/** DESIGN §5.7 Step 2: the last 1–2 paragraphs. */
export const CONTEXT_TAIL_PARAGRAPHS = 2;

const HEAD = 'The text just before these segments, for continuity:';

function pair(source: string, translation: string | undefined): string {
  const src = `<source>${neutralizeContextTags(source)}</source>`;
  return translation === undefined ? src : `${src}\n<translation>${neutralizeContextTags(translation)}</translation>`;
}

/** The end of `text` in at most `maxChars` characters, cut at a word, with "…" in front. */
function endOf(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(text.length - maxChars + 1);
  const space = cut.indexOf(' ');
  return `…${space >= 0 && space < cut.length - 1 ? cut.slice(space + 1) : cut}`;
}

export const contextTailProvider: ContextProvider = {
  id: CONTEXT_TAIL_PROVIDER_ID,
  maxTokens: CONTEXT_TAIL_MAX_TOKENS,
  async provide(q) {
    const before = segmentsBefore(q.segments, q.chunk).slice(-CONTEXT_TAIL_PARAGRAPHS);
    if (before.length === 0) return [];
    let left = q.maxTokens - estimateTokens(`${HEAD}\n`);
    const parts: string[] = [];
    for (const s of [...before].reverse()) {
      const text = pair(s.inlineMarkup, q.memory.translated.get(s.id)?.text);
      const cost = estimateTokens(`${text}\n`);
      if (cost <= left) {
        parts.unshift(text);
        left -= cost;
        continue;
      }
      if (parts.length === 0) {
        // `<source></source>` and the line break take ~6 tokens.
        const chars = Math.floor((left - 6) * CHARS_PER_TOKEN);
        if (chars >= 40) parts.unshift(pair(endOf(s.inlineMarkup, chars), undefined));
      }
      break;
    }
    if (parts.length === 0) return [];
    return [{ providerId: CONTEXT_TAIL_PROVIDER_ID, scope: 'chunk', text: [HEAD, ...parts].join('\n') }];
  },
};
