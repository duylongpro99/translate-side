// Per-job working memory (DESIGN.md §5.3).

import type { GlossaryEntry, WorkingMemory } from './types.ts';

export function createWorkingMemory(glossary: readonly GlossaryEntry[] = []): WorkingMemory {
  return { glossary: [...glossary], translated: new Map(), termUsage: new Map() };
}
