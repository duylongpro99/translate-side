// Connection presets (DESIGN.md §4.3.2, plan M4-E3): default values for a new connection and the
// fields its form shows. A preset is never stored: a connection keeps its `presetId`, and every
// value the preset gave it is the connection's own from then on (the user can override any).
// Dependency-free apart from types and constants, so the options page can read it without an SDK.
import { i18n } from '#i18n';
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
}

/** §4.3.1 defaults: 2 requests in flight, 1,200-token chunks. */
const CLOUD = { maxConcurrency: 2, chunkTokens: 1200 } as const;
/** §4.3.6 and plan M4 §5 "Local model chunking": one request at a time, smaller chunks. */
export const LOCAL_PROFILE = { maxConcurrency: 1, chunkTokens: 600 } as const;

export const PRESETS: readonly ConnectionPreset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
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
    protocol: 'openai-chat',
    baseUrl: GEMINI_OPENAI_BASE_URL,
    auth: 'bearer',
    keyUrl: 'https://aistudio.google.com/apikey',
    // Its list says models/<id>; chat takes the bare id too (checked against the live API).
    quirks: { modelIdPrefix: 'models/' },
    keyCheck: 'list',
    defaultModel: 'gemini-3.5-flash-lite',
    profile: CLOUD,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
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
    protocol: 'openai-chat',
    baseUrl: 'http://localhost:11434/v1',
    auth: 'none',
    local: 'ollama',
    quirks: {},
    keyCheck: 'list',
    defaultModel: 'qwen3:8b',
    profile: LOCAL_PROFILE,
  },
  {
    id: 'ollama-cloud',
    label: 'Ollama (cloud)',
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
    protocol: 'openai-chat',
    baseUrl: 'http://localhost:1234/v1',
    auth: 'none',
    local: 'lmstudio',
    quirks: {},
    keyCheck: 'list',
    profile: LOCAL_PROFILE,
  },
  {
    id: 'apibox',
    label: 'APIBOX',
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

/** What the picker says under a preset's name, in the reader's language. */
export function presetBlurb(preset: ConnectionPreset): string {
  switch (preset.id) {
    case 'anthropic':
      return i18n.t('options.presets.blurbAnthropic');
    case 'openai':
      return i18n.t('options.presets.blurbOpenai');
    case 'gemini':
      return i18n.t('options.presets.blurbGemini');
    case 'openrouter':
      return i18n.t('options.presets.blurbOpenrouter');
    case 'ollama':
      return i18n.t('options.presets.blurbOllama');
    case 'ollama-cloud':
      return i18n.t('options.presets.blurbOllamaCloud');
    case 'lmstudio':
      return i18n.t('options.presets.blurbLmstudio');
    case 'apibox':
      return i18n.t('options.presets.blurbApibox');
    case 'custom-openai':
      return i18n.t('options.presets.blurbCustomOpenai');
    case 'custom-anthropic':
      return i18n.t('options.presets.blurbCustomAnthropic');
    case 'custom-auto':
      return i18n.t('options.presets.blurbCustomAuto');
  }
}

/** Shown under the form: what the preset's server needs (the local ones only). */
export function presetNote(preset: ConnectionPreset): string | undefined {
  if (preset.id === 'ollama') return i18n.t('options.presets.noteOllama');
  if (preset.id === 'lmstudio') return i18n.t('options.presets.noteLmstudio');
  return undefined;
}

/**
 * The preset's name in the picker and the form's title. A connection's own label (what is saved) stays
 * `preset.label`: it is a name, not interface text, so it does not change with the browser's language.
 */
export function presetTitle(preset: ConnectionPreset): string {
  switch (preset.id) {
    case 'ollama':
      return i18n.t('options.presets.titleOllama');
    case 'ollama-cloud':
      return i18n.t('options.presets.titleOllamaCloud');
    case 'lmstudio':
      return i18n.t('options.presets.titleLmstudio');
    case 'custom-openai':
      return i18n.t('options.presets.titleCustomOpenai');
    case 'custom-anthropic':
      return i18n.t('options.presets.titleCustomAnthropic');
    case 'custom-auto':
      return i18n.t('options.presets.titleCustomAuto');
    default:
      return preset.label;
  }
}

export function authLabel(style: AuthStyle): string {
  switch (style) {
    case 'bearer':
      return i18n.t('options.presets.authBearer');
    case 'x-api-key':
      return 'x-api-key';
    case 'custom-header':
      return i18n.t('options.presets.authCustomHeader');
    case 'none':
      return i18n.t('options.presets.authNone');
  }
}

export function protocolLabel(protocol: Protocol | 'auto'): string {
  switch (protocol) {
    case 'openai-chat':
      return i18n.t('options.presets.protocolOpenai');
    case 'anthropic-messages':
      return i18n.t('options.presets.protocolAnthropic');
    case 'chrome-builtin':
      return i18n.t('options.presets.protocolChrome');
    case 'auto':
      return i18n.t('options.presets.protocolAuto');
  }
}

const PICKER_IDS: readonly { title: () => string; ids: readonly PresetId[] }[] = [
  { title: () => i18n.t('options.presets.groupCloud'), ids: ['anthropic', 'openai', 'gemini', 'openrouter', 'ollama-cloud', 'apibox'] },
  { title: () => i18n.t('options.presets.groupLocal'), ids: ['ollama', 'lmstudio'] },
  { title: () => i18n.t('options.presets.groupCustom'), ids: ['custom-openai', 'custom-anthropic', 'custom-auto'] },
];

/** The add-connection picker (§4.3.3 step 1), grouped. */
export const pickerGroups = (): readonly { title: string; presets: readonly ConnectionPreset[] }[] => PICKER_IDS.map((g) => ({ title: g.title(), presets: g.ids.map((id) => PRESETS.find((p) => p.id === id) as ConnectionPreset) }));
