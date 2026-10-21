// Provider layer (DESIGN.md §4.2): protocol adapters on the vendor SDKs. Never imported by
// src/engine/ (the engine sees only ./types.ts).

export { createAnthropicAdapter, toAnthropicParams } from './anthropic.ts';
export { createOpenAIAdapter, toOpenAIParams } from './openai.ts';
export { APIBOX_BASE_URL, APIBOX_DEEPSEEK_QUIRKS, APIBOX_JUDGE_QUIRKS, APIBOX_QWEN_QUIRKS, GEMINI_OPENAI_BASE_URL, QWEN_THINKING_RESERVE_TOKENS } from './presets.ts';
export { reasoningFor, reserveTokensOf } from './reasoning.ts';
export { bindClient, createAdapter, createClient } from './client.ts';
export { NANO_MODEL, classifyNanoError, createChromeBuiltinAdapter, nanoLanguages } from './chrome-builtin.ts';
export { CHROME_TRANSLATOR_MODEL, chromeTranslator, needsActivation, unavailableMessage, type ChromeMTClient, type NeedsActivationRaw } from './chrome-translator.ts';
export { ON_DEVICE_SETTINGS, nanoClient, pickEngine, prepareOnDevice, translatorRouteClient, type EngineChoice, type OnDeviceEngine, type OnDeviceSetting } from './on-device.ts';
export { preflight, type AdapterOptions } from './sdk.ts';
export * from './errors.ts';
export type * from './types.ts';
