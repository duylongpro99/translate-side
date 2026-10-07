// Token budgeting across context providers (plan M2-E2, §5 "Token budget split"): providers run in
// order and each gets what the earlier ones left, capped by its own `maxTokens`. The default order
// puts the brief and the glossary first (fixed: their size depends only on the document) and the
// context tail last (what remains, at most ~300). A provider's snippets past its share are dropped,
// and a provider that throws is skipped: context is optional (§5.6), it never fails a chunk.
import { estimateTokens } from '../tokens.ts';
import type { ContextProvider, ContextQuery, ContextSnippet } from '../types.ts';
import { documentBriefProvider } from './brief.ts';
import { glossaryProvider } from './glossary.ts';
import { contextTailProvider } from './tail.ts';

/** Context tokens per chunk, all providers together (DESIGN §6: system ~1k, context ~300). */
export const CONTEXT_BUDGET_TOKENS = 1500;

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
