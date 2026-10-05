// Translation engine (DESIGN.md §5). Plain TypeScript: no chrome.*, no wxt, no DOM, and no
// llm/ implementations — only the LLMClient interface. Enforced by eslint.config.js and
// src/engine/tsconfig.json; see tests/boundary.

import type { LLMClient } from '../llm/types.ts';

export const ENGINE_VERSION = 0;

export interface EngineDeps {
  llm: LLMClient;
  now: () => number;
}

/** Placeholder until M1 defines TranslationEngine (§5.2). */
export function describeEngine(deps: EngineDeps): string {
  return `engine v${ENGINE_VERSION} @ ${deps.now()}`;
}
