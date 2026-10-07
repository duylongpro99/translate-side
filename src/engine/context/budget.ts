// Token budgeting across context providers (plan M2-E2, §5 "Token budget split"): providers run in
// order and each gets what the earlier ones left, capped by its own `maxTokens`. The default order
// puts the brief and the glossary first (fixed: their size depends only on the document) and the
// context tail last (what remains, at most ~300). A provider's snippets past its share are dropped,
// and a provider that throws is skipped: context is optional (§5.6), it never fails a chunk.
import { estimateTokens } from '../tokens.ts';
import type { ContextProvider, ContextQuery, ContextSnippet, GlossaryEntry } from '../types.ts';
import { BRIEF_MAX_TOKENS, documentBriefProvider } from './brief.ts';
import { glossaryProvider, renderGlossaryEntry, usedTermsLine } from './glossary.ts';
import { contextTailProvider } from './tail.ts';

/** Context tokens per chunk, all providers together (DESIGN §6: system ~1k, context ~300). */
export const CONTEXT_BUDGET_TOKENS = 1500;

/**
 * The glossary's share is at least what the largest brief leaves; the user's entries come first in
 * it. The options page warns when the personal glossary alone is larger (review, plan M2-E6).
 */
export const PERSONAL_GLOSSARY_PROMPT_TOKENS = CONTEXT_BUDGET_TOKENS - BRIEF_MAX_TOKENS;

/**
 * What the personal glossary takes in a prompt, as the glossary provider lists it, with the room
 * it keeps for the used-terms line (fitGlossary): over PERSONAL_GLOSSARY_PROMPT_TOKENS, entries
 * are cut.
 */
export function personalGlossaryTokens(entries: readonly GlossaryEntry[]): number {
  if (entries.length === 0) return 0;
  const list = entries.reduce((n, e) => n + estimateTokens(`${renderGlossaryEntry(e)}\n`), 0);
  return list + estimateTokens(usedTermsLine(entries.map((e) => e.term)));
}

/** v1 providers (§5.4), document-scoped ones first so the system block can't depend on the chunk. */
export const DEFAULT_CONTEXT_PROVIDERS: readonly ContextProvider[] = [documentBriefProvider, glossaryProvider, contextTailProvider];

export async function gatherContext(providers: readonly ContextProvider[], q: Omit<ContextQuery, 'maxTokens'>, total = CONTEXT_BUDGET_TOKENS): Promise<ContextSnippet[]> {
  const out: ContextSnippet[] = [];
  let left = total;
  for (const p of providers) {
    const share = Math.min(left, p.maxTokens ?? Infinity);
    if (share <= 0) continue;
    let snippets: ContextSnippet[];
    try {
      snippets = await p.provide({ ...q, maxTokens: share });
    } catch {
      continue;
    }
    let used = 0;
    for (const s of snippets) {
      const cost = estimateTokens(s.text);
      if (used + cost > share) break;
      used += cost;
      out.push({ ...s, providerId: p.id });
    }
    left -= used;
  }
  return out;
}
