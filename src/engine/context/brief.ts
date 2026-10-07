// DocumentBriefProvider (DESIGN.md §5.4, plan M2-E2): the analyze stage's brief (genre, audience,
// purpose, tone) as one document-scoped snippet, for translate@2's BRIEF slot. The brief's terms
// are the glossary provider's. No brief in memory: no snippet ("(none)" in the prompt).
import type { ContextProvider, DocumentBrief } from '../types.ts';
import { estimateTokens } from '../tokens.ts';
import { BRIEF_PROVIDER_ID, neutralizeContextTags } from './assemble.ts';

/** The brief's fields, one per line; tags neutralised, since the brief is model output over page text (§8). */
export function renderBrief(brief: DocumentBrief): string {
  const lines: string[] = [];
  const field = (label: string, value: string) => {
    if (value) lines.push(`${label}: ${neutralizeContextTags(value)}`);
  };
  field('Genre', brief.genre);
  field('Audience', brief.audience);
  field('Purpose', brief.purpose);
  field('Tone', brief.tone);
  return lines.join('\n');
}

/**
 * The most a brief takes: four fields of at most BRIEF_FIELD_MAX characters with their labels
 * (~360 tokens). It caps the brief's share, so the glossary is sure of the rest (budget.ts).
 */
export const BRIEF_MAX_TOKENS = 400;

export const documentBriefProvider: ContextProvider = {
  id: BRIEF_PROVIDER_ID,
  maxTokens: BRIEF_MAX_TOKENS,
  async provide(q) {
    const brief = q.memory.brief;
    if (brief === undefined) return [];
    const text = renderBrief(brief);
    // A brief is a few short fields (parsing/brief.ts caps them); one that doesn't fit is left out whole.
    if (text === '' || estimateTokens(text) > q.maxTokens) return [];
    return [{ providerId: BRIEF_PROVIDER_ID, scope: 'document', text }];
  },
};
