// Provider layer (DESIGN.md §4.2): protocol adapters on the vendor SDKs. Never imported by
// src/engine/ (the engine sees only ./types.ts).

export { createAnthropicAdapter, toAnthropicParams } from './anthropic.ts';
export { createOpenAIAdapter, toOpenAIParams } from './openai.ts';
export { APIBOX_BASE_URL, APIBOX_DEEPSEEK_QUIRKS, APIBOX_JUDGE_QUIRKS, APIBOX_QWEN_QUIRKS, GEMINI_OPENAI_BASE_URL, QWEN_THINKING_RESERVE_TOKENS } from './presets.ts';
export { reasoningFor, reserveTokensOf } from './reasoning.ts';
export { bindClient, createAdapter, createClient } from './client.ts';
export { preflight, type AdapterOptions } from './sdk.ts';
export * from './errors.ts';
export type * from './types.ts';
