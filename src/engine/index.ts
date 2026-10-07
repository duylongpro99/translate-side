// Translation engine (DESIGN.md §5). Plain TypeScript: no chrome.*, no wxt, no DOM, and no
// llm/ implementations — only the LLMClient interface. Enforced by eslint.config.js and
// src/engine/tsconfig.json; see tests/boundary.

export const ENGINE_VERSION = 1;

export { DEGRADED_MESSAGE, createEngine, type EngineDeps } from './engine.ts';
export { defineStage, defineStrategy, isEngineEvent, multiplex, runStages, type AnyStage, type StrategyDefinition } from './runner.ts';
export { DEFAULT_RETRY_POLICY, decideRetry, withRetry, type RetryDecision, type RetryInfo, type RetryOptions, type RetryPolicy } from './retry.ts';
export { BUDGET_MESSAGE, createBudget, maxOutputTokens } from './budget.ts';
export { createWorkingMemory } from './memory.ts';
export { createPromptRegistry, definePrompt } from './prompts/registry.ts';
export { PROMPTS, createDefaultPromptRegistry } from './prompts/index.ts';
export { GLOSS_RULES, STYLE_LABELS, STYLE_RULES, TRANSLATE_PROMPT_ID, TRANSLATE_V2_PROMPT_ID, languageLabel, translateV1, translateV2 } from './prompts/translate.ts';
export { BRIEF_PROVIDER_ID, DEFAULT_GLOSS, GLOSSARY_PROVIDER_ID, neutralizeContextTags, renderContextBlock, renderSystemPromptV2, type SystemPromptV2Vars } from './context/assemble.ts';
export { CONTEXT_BUDGET_TOKENS, DEFAULT_CONTEXT_PROVIDERS, PERSONAL_GLOSSARY_PROMPT_TOKENS, gatherContext, personalGlossaryTokens } from './context/budget.ts';
export { documentBriefProvider, renderBrief } from './context/brief.ts';
export { codeTerms, fitGlossary, glossaryHash, glossaryProvider, keepsTerm, mentions, mergeGlossary, renderGlossaryEntry, termPattern, usedTermsLine } from './context/glossary.ts';
export { CONTEXT_TAIL_MAX_TOKENS, CONTEXT_TAIL_PARAGRAPHS, CONTEXT_TAIL_PROVIDER_ID, contextTailProvider } from './context/tail.ts';
export { ANALYZE_EXCERPT_TOKENS, ANALYZE_OUTLINE_MAX, ANALYZE_PROMPT_ID, analyzeExcerpt, analyzeInput, analyzeV1, neutralizeDelimiters } from './prompts/analyze.ts';
export { ANALYZE_MAX_OUTPUT_TOKENS, ANALYZE_TEMPERATURE, analyzeRequest, analyzeStage, briefCacheKey } from './stages/analyze.ts';
export { BRIEF_FIELD_MAX, BRIEF_GLOSSARY_MAX, normalizeBrief, parseBrief } from './parsing/brief.ts';
export { BRIEF_FREE_CHUNKS, CONTEXTUAL_CACHE_KEY, CONTEXTUAL_ID, CONTEXTUAL_TRANSLATE_PROMPT_ID, CONTEXTUAL_VERSION, contextual, contextualStages, createContextual } from './strategies/contextual.ts';
export {
  SINGLE_PASS_CACHE_KEY,
  SINGLE_PASS_ID,
  SINGLE_PASS_STAGES,
  SINGLE_PASS_VERSION,
  TRANSLATE_TEMPERATURE,
  callBudget,
  checkStage,
  chunkStage,
  createStrategyCheckStage,
  prepareChunk,
  createTranslateStage,
  renderSystemPrompt,
  singlePass,
  translateRequest,
  translatable,
  type CheckSummary,
  type PreparedChunk,
  type ChunkOutcome,
  type ChunkWork,
  type SystemPromptVars,
} from './strategies/single-pass.ts';
export { CHECK_MESSAGE, UNCHECKED_MESSAGE, checkFailure, createCheckStage, type CheckFailedRaw, type PrepareCall } from './stages/check.ts';
export {
  DUPLICATE_WINDOW,
  DENSE_SHARE,
  LENGTH_BOUNDS,
  LENGTH_SLACK_CHARS,
  checkDuplicates,
  checkScript,
  checkSegment,
  codeSpans,
  crossings,
  lengthBounds,
  markerCounts,
  numberValues,
  numbers,
  urls,
  TARGET_SCRIPTS,
  type CheckFailure,
  type CheckKind,
  type CheckedSegment,
  type LengthBounds,
} from './check/checks.ts';
export type * from './types.ts';
export { estimateTokens, CHARS_PER_TOKEN } from './tokens.ts';
export { DEFAULT_CHUNK_TOKENS, chunkLimits, chunkSegments, type Chunk, type ChunkLimits } from './chunker.ts';
export { MAX_TAG, SegParser, literalTagCount, parseOutput, type Fix, type FixKind, type Grammar, type ParseResult, type SegParserOptions } from './parsing/seg-parser.ts';
export { formatWire, nonceFor, toWire, type WireChunk, type WireSegment } from './parsing/wire.ts';
export { MERGE_FACTOR, planRepair, type RepairPlan } from './parsing/repair.ts';
export { UNREADABLE_MESSAGE, rerequestSegments, translateChunk, type RerequestResult, type CallReport, type ChunkCall, type ChunkReport, type TranslateChunkOptions } from './parsing/translate-chunk.ts';
