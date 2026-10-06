// `contextual` (DESIGN.md §5.3, §5.7; plan M2): analyze → chunk → translate(chunk) → check.
// Phase B scope (plan M2 §6 sub-goal B): the analyze stage produces the brief (memory + an
// `artifact` event) and supplies the source language when the shell could not tell it. The
// translate prompt is still `translate@1` with the brief slot "(none)": carrying the brief into
// every chunk is M2-E3 (`translate@2`). `single-pass` is left as it was, so its baseline stays
// reproducible.
import { ANALYZE_PROMPT_ID } from '../prompts/analyze.ts';
import { TRANSLATE_PROMPT_ID } from '../prompts/translate.ts';
import { defineStrategy, type AnyStage } from '../runner.ts';
import { analyzeStage } from '../stages/analyze.ts';
import type { Strategy } from '../types.ts';
import { checkStage, chunkStage, createTranslateStage } from './single-pass.ts';

export const CONTEXTUAL_ID = 'contextual';
export const CONTEXTUAL_VERSION = 1;

export const CONTEXTUAL_STAGES: readonly AnyStage[] = [analyzeStage, chunkStage, createTranslateStage(CONTEXTUAL_ID), checkStage];
export const contextual: Strategy = defineStrategy({ id: CONTEXTUAL_ID, version: CONTEXTUAL_VERSION, stages: CONTEXTUAL_STAGES });

/** What the translation cache key must include for this strategy (§5.5, M3). */
export const CONTEXTUAL_CACHE_KEY = { strategy: CONTEXTUAL_ID, version: CONTEXTUAL_VERSION, promptIds: [ANALYZE_PROMPT_ID, TRANSLATE_PROMPT_ID] } as const;
