// The engine's prompt assets (DESIGN.md §5.5). Add a new version next to the old one; the eval
// harness compares them before the default moves.

import { analyzeV1 } from './analyze.ts';
import { createPromptRegistry } from './registry.ts';
import { translateV1, translateV2 } from './translate.ts';

export const PROMPTS = [translateV1, translateV2, analyzeV1] as const;

export function createDefaultPromptRegistry() {
  return createPromptRegistry(PROMPTS);
}
