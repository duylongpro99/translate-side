// The engine's prompt assets (DESIGN.md §5.5). Add a new version next to the old one; the eval
// harness compares them before the default moves.

import { createPromptRegistry } from './registry.ts';
import { translateV1 } from './translate.ts';

export const PROMPTS = [translateV1] as const;

export function createDefaultPromptRegistry() {
  return createPromptRegistry(PROMPTS);
}
