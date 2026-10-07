// DocumentBriefProvider (DESIGN.md §5.4, plan M2-E2): the analyze stage's brief (genre, audience,
// purpose, tone) as one document-scoped snippet, for translate@2's BRIEF slot. The brief's terms
// are the glossary provider's. No brief in memory: no snippet ("(none)" in the prompt).
import type { ContextProvider, DocumentBrief } from '../types.ts';
import { estimateTokens } from '../tokens.ts';
import { BRIEF_PROVIDER_ID } from './assemble.ts';

export function renderBrief(brief: DocumentBrief): string {
  const lines: string[] = [];
  if (brief.genre) lines.push(`Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`Audience: ${brief.audience}`);
  if (brief.purpose) lines.push(`Purpose: ${brief.purpose}`);
  if (brief.tone) lines.push(`Tone: ${brief.tone}`);
  return lines.join('\n');
}

export const documentBriefProvider: ContextProvider = {
  id: BRIEF_PROVIDER_ID,
  async provide(q) {
    const brief = q.memory.brief;
    if (brief === undefined) return [];
    const text = renderBrief(brief);
    // A brief is a few short fields (parsing/brief.ts caps them); one that doesn't fit is left out whole.
    if (text === '' || estimateTokens(text) > q.maxTokens) return [];
    return [{ providerId: BRIEF_PROVIDER_ID, scope: 'document', text }];
  },
};
