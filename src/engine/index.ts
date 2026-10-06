// Translation engine (DESIGN.md §5). Plain TypeScript: no chrome.*, no wxt, no DOM, and no
// llm/ implementations — only the LLMClient interface. Enforced by eslint.config.js and
// src/engine/tsconfig.json; see tests/boundary.

export const ENGINE_VERSION = 1;

export { createEngine, type EngineDeps } from './engine.ts';
export { defineStrategy, isEngineEvent, multiplex, runStages, type AnyStage, type StrategyDefinition } from './runner.ts';
export { DEFAULT_RETRY_POLICY, decideRetry, withRetry, type RetryDecision, type RetryInfo, type RetryOptions, type RetryPolicy } from './retry.ts';
export { createBudget, maxOutputTokens } from './budget.ts';
export { createWorkingMemory } from './memory.ts';
export { createPromptRegistry, definePrompt } from './prompts/registry.ts';
export type * from './types.ts';
