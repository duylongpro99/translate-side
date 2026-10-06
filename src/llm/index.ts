// Provider layer (DESIGN.md §4.2): protocol adapters on the vendor SDKs. Never imported by
// src/engine/ (the engine sees only ./types.ts).

export { createAnthropicAdapter, toAnthropicParams } from './anthropic.ts';
export { GEMINI_OPENAI_BASE_URL, createOpenAIAdapter, toOpenAIParams } from './openai.ts';
export { bindClient, createAdapter, createClient } from './client.ts';
export { preflight, type AdapterOptions } from './sdk.ts';
export * from './errors.ts';
export type * from './types.ts';
