// The engine's prompt assets (DESIGN.md §5.5). Add a new version next to the old one; the eval
// harness compares them before the default moves.

import { analyzeV1 } from './analyze.ts';
import { explainV1 } from './explain.ts';
import { createPromptRegistry } from './registry.ts';
import { reviewV1, reviewV2 } from './review.ts';
import { translateV1, translateV2 } from './translate.ts';

export const PROMPTS = [translateV1, translateV2, analyzeV1, explainV1, reviewV1, reviewV2] as const;

export function createDefaultPromptRegistry() {
  return createPromptRegistry(PROMPTS);
}
