// Connection presets (DESIGN.md §4.3.2, plan M4-E3): default values for a new connection and the
// fields its form shows. A preset is never stored: a connection keeps its `presetId`, and every
// value the preset gave it is the connection's own from then on (the user can override any).
// Dependency-free apart from types and constants, so the options page can read it without an SDK.
import { APIBOX_BASE_URL, GEMINI_OPENAI_BASE_URL } from '@/llm/presets';
import type { AuthStyle, Protocol, Quirks } from '@/llm/types';

export type PresetId =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'openrouter'
  | 'ollama'
  | 'ollama-cloud'
  | 'lmstudio'
  | 'apibox'
  | 'custom-openai'
  | 'custom-anthropic'
  | 'custom-auto';

export interface ConnectionPreset {
  id: PresetId;
  label: string;
  /** What the picker says under the name. */
  blurb: string;
  protocol: Protocol | 'auto';
  /** Empty for the Custom presets: the user enters it. */
  baseUrl: string;
  auth: AuthStyle;
  /** Custom presets: the auth styles the form offers (§4.3.3 step 1). */
  authChoices?: readonly AuthStyle[];
  /** "Get a key ↗" (§4.3.3 step 2). */
  keyUrl?: string;
  /** Runs on this machine: no key, CORS setup, one request at a time and smaller chunks (§4.3.6). */
  local?: 'ollama' | 'lmstudio';
  /** Custom presets show the base URL, API format, auth and Advanced fields. */
  custom?: boolean;
  quirks: Quirks;
  /**
   * How Test connection checks the key: `list` = the model listing (S4: success is the status);
   * `chat` = a 1-token chat call, for a provider whose listing is public (Ollama cloud, S4).
   */
  keyCheck: 'list' | 'chat';
  /** The model the form suggests before discovery. */
  defaultModel?: string;
  /** Defaults for a profile created on this connection (§4.3.1, §4.3.6). */
  profile: { maxConcurrency: number; chunkTokens: number };
  /** Shown under the form. */
  note?: string;
}

/** §4.3.1 defaults: 2 requests in flight, 1,200-token chunks. */
const CLOUD = { maxConcurrency: 2, chunkTokens: 1200 } as const;
/** §4.3.6 and plan M4 §5 "Local model chunking": one request at a time, smaller chunks. */
export const LOCAL_PROFILE = { maxConcurrency: 1, chunkTokens: 600 } as const;

export const PRESETS: readonly ConnectionPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    blurb: 'Claude models with your Anthropic key',
    protocol: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    auth: 'x-api-key',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    quirks: {},
    keyCheck: 'list',
    defaultModel: 'claude-haiku-4-5',
    profile: CLOUD,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    blurb: 'GPT models with your OpenAI key',
    protocol: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    auth: 'bearer',
    keyUrl: 'https://platform.openai.com/api-keys',
    quirks: { maxTokensParam: 'max_completion_tokens' },
    keyCheck: 'list',
    defaultModel: 'gpt-5-mini',
    profile: CLOUD,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    blurb: 'Gemini Flash and Flash-Lite through its OpenAI-compatible API',
    protocol: 'openai-chat',
    baseUrl: GEMINI_OPENAI_BASE_URL,
    auth: 'bearer',
    keyUrl: 'https://aistudio.google.com/apikey',
    quirks: {},
    keyCheck: 'list',
    defaultModel: 'gemini-3.5-flash-lite',
    profile: CLOUD,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    blurb: 'Many models through one key',
    protocol: 'openai-chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    auth: 'bearer',
    keyUrl: 'https://openrouter.ai/settings/keys',
    quirks: {},
    // Its listing is public too: only a chat call tells a bad key.
    keyCheck: 'chat',
    profile: CLOUD,
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    blurb: 'Models on this computer; free and private',
    protocol: 'openai-chat',
    baseUrl: 'http://localhost:11434/v1',
    auth: 'none',
    local: 'ollama',
    quirks: {},
    keyCheck: 'list',
    defaultModel: 'qwen3:8b',
    profile: LOCAL_PROFILE,
    note: 'Ollama must allow requests from extensions (OLLAMA_ORIGINS). Qwen and Gemma models of 7B and up translate best.',
  },
  {
    id: 'ollama-cloud',
    label: 'Ollama (cloud)',
    blurb: "Ollama's hosted models with an ollama.com key",
    protocol: 'openai-chat',
    baseUrl: 'https://ollama.com/v1',
    auth: 'bearer',
    keyUrl: 'https://ollama.com/settings/keys',
    quirks: {},
    // S4: the listing is public, so only a chat call tells a bad key; success = 200.
    keyCheck: 'chat',
    profile: { maxConcurrency: 4, chunkTokens: 1200 },
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    blurb: 'Models in LM Studio on this computer',
    protocol: 'openai-chat',
    baseUrl: 'http://localhost:1234/v1',
    auth: 'none',
    local: 'lmstudio',
    quirks: {},
    keyCheck: 'list',
    profile: LOCAL_PROFILE,
    note: 'Start the server and turn on CORS in LM Studio (Developer → Server settings).',
  },
  {
    id: 'apibox',
    label: 'APIBOX',
    blurb: 'An OpenAI-compatible gateway (Qwen, DeepSeek)',
    protocol: 'openai-chat',
    baseUrl: APIBOX_BASE_URL,
    auth: 'bearer',
    keyUrl: 'https://api.ai-box.vn/',
    quirks: {},
    keyCheck: 'list',
    defaultModel: 'qwen3.8-flash',
    profile: CLOUD,
  },
  {
    id: 'custom-openai',
    label: 'Custom — OpenAI-compatible',
    blurb: 'vLLM, LiteLLM, a company proxy',
    protocol: 'openai-chat',
    baseUrl: '',
    auth: 'bearer',
    authChoices: ['bearer', 'custom-header', 'none'],
    custom: true,
    quirks: {},
    keyCheck: 'list',
    profile: CLOUD,
  },
  {
    id: 'custom-anthropic',
    label: 'Custom — Anthropic-compatible',
    blurb: 'An Anthropic-format gateway',
    protocol: 'anthropic-messages',
    baseUrl: '',
    auth: 'x-api-key',
    authChoices: ['x-api-key', 'bearer', 'custom-header', 'none'],
    custom: true,
    quirks: {},
    keyCheck: 'list',
    profile: CLOUD,
  },
  {
    id: 'custom-auto',
    label: 'Custom — Auto-detect',
    blurb: 'A gateway that may speak both formats (LiteLLM, OpenRouter-style)',
    protocol: 'auto',
    baseUrl: '',
    auth: 'bearer',
    authChoices: ['bearer', 'x-api-key', 'custom-header', 'none'],
    custom: true,
    quirks: {},
    keyCheck: 'list',
    profile: CLOUD,
  },
];

/**
 * The preset a connection was made from. Connections from M1–M3 (the built-ins) and from a
 * later version may name one this build does not know: they get the Custom preset of their
 * protocol, which shows every field.
 */
export function presetFor(presetId: string, protocol?: Protocol | 'auto'): ConnectionPreset {
  const known = PRESETS.find((p) => p.id === presetId);
  if (known) return known;
  const id: PresetId = protocol === 'anthropic-messages' ? 'custom-anthropic' : protocol === 'auto' ? 'custom-auto' : 'custom-openai';
  return PRESETS.find((p) => p.id === id) as ConnectionPreset;
}

export const AUTH_LABELS: Record<AuthStyle, string> = {
  bearer: 'Bearer token',
  'x-api-key': 'x-api-key',
  'custom-header': 'Custom header',
  none: 'None',
};

export const PROTOCOL_LABELS: Record<Protocol | 'auto', string> = {
  'openai-chat': 'OpenAI-compatible',
  'anthropic-messages': 'Anthropic-compatible',
  'chrome-builtin': 'Chrome built-in',
  auto: 'Auto-detect',
};

/** What the UI calls a routing role (plan M4 §5 "Role naming"). `review` is M7's. */
export const ROLE_LABELS = { translate: 'Translate', analyze: 'Document brief', review: 'Review' } as const;

/** The add-connection picker (§4.3.3 step 1), grouped. */
export const PICKER_GROUPS: readonly { title: string; presets: readonly ConnectionPreset[] }[] = [
  { title: 'Cloud', ids: ['anthropic', 'openai', 'gemini', 'openrouter', 'ollama-cloud', 'apibox'] },
  { title: 'On this computer', ids: ['ollama', 'lmstudio'] },
  { title: 'Custom endpoint', ids: ['custom-openai', 'custom-anthropic', 'custom-auto'] },
].map((g) => ({ title: g.title, presets: g.ids.map((id) => PRESETS.find((p) => p.id === id) as ConnectionPreset) }));
