// The harness's live providers (run.ts): where the key is read, the connection and the default model.
// APIBOX is the default gateway; its qwen3.8-flash entry carries the app's per-chunk thinking quirks.
// Shared with the regression gate, which checks them against the shipped default.
import { APIBOX_BASE_URL, APIBOX_DEEPSEEK_QUIRKS, APIBOX_QWEN_QUIRKS, GEMINI_OPENAI_BASE_URL } from '@/llm/presets';
import type { Quirks, ResolvedConnection } from '@/llm/types';

export interface HarnessProvider {
  keyName: string;
  conn: Pick<ResolvedConnection, 'protocol' | 'baseUrl' | 'auth' | 'quirks'>;
  model: string;
  modelQuirks?: Record<string, Quirks>;
}

export const PROVIDERS: Record<string, HarnessProvider> = {
  apibox: { keyName: 'AIBOX_API_KEY', conn: { protocol: 'openai-chat', baseUrl: APIBOX_BASE_URL, auth: { style: 'bearer' }, quirks: APIBOX_DEEPSEEK_QUIRKS }, model: 'qwen3.8-flash', modelQuirks: { 'qwen3.8-flash': APIBOX_QWEN_QUIRKS } },
  gemini: { keyName: 'GEMINI_API_KEY', conn: { protocol: 'openai-chat', baseUrl: GEMINI_OPENAI_BASE_URL, auth: { style: 'bearer' }, quirks: {} }, model: 'gemini-3.5-flash-lite' },
  // Ollama cloud stands in for local Ollama runs; it hosts no Qwen, so gemma4:31b is the multilingual pick.
  'ollama-cloud': { keyName: 'OLLAMA_API_KEY', conn: { protocol: 'openai-chat', baseUrl: 'https://ollama.com/v1', auth: { style: 'bearer' }, quirks: {} }, model: 'gemma4:31b' },
  openrouter: { keyName: 'OPENROUTER_API_KEY', conn: { protocol: 'openai-chat', baseUrl: 'https://openrouter.ai/api/v1', auth: { style: 'bearer' }, quirks: {} }, model: 'anthropic/claude-haiku-4.5' },
  'openrouter-anthropic': { keyName: 'OPENROUTER_API_KEY', conn: { protocol: 'anthropic-messages', baseUrl: 'https://openrouter.ai/api', auth: { style: 'bearer' }, quirks: {} }, model: 'anthropic/claude-haiku-4.5' },
  anthropic: { keyName: 'ANTHROPIC_API_KEY', conn: { protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', auth: { style: 'x-api-key' }, quirks: {} }, model: 'claude-haiku-4-5-20251001' },
};

/** The quirks a harness run with `provider` and `model` sends: the model's over the connection's, as the app's profile does (settings.ts withProfileQuirks). */
export function harnessQuirks(provider: HarnessProvider, model: string): Quirks {
  return { ...provider.conn.quirks, ...provider.modelQuirks?.[model] };
}
