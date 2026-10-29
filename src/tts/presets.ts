// The cloud TTS providers a reader can bring a key for (BYOK), one preset each. Endpoints, auth,
// limits and voices are the ones Spike S11 checked (docs/decisions/S11-cloud-tts-direct.md).

export type TtsPresetId = 'gemini' | 'openai' | 'azure' | 'elevenlabs' | 'gcloud' | 'vbee' | 'fpt';

export interface TtsPreset {
  id: TtsPresetId;
  label: string;
  /** Where requests go; `{region}` is filled in for Azure. */
  baseUrl: string;
  /** The host permission asked for when the provider is saved (a custom OpenAI-compatible base asks for its own). */
  origin: string;
  /** The model when the provider has several; the reader may change it. */
  model?: string;
  /** Azure: the resource's region ("southeastasia"). */
  needsRegion?: boolean;
  /** Vbee: the console app's id, sent with the token. */
  needsAppId?: boolean;
  /** The base URL can be changed (OpenAI-compatible servers). */
  editableBaseUrl?: boolean;
  /** Takes a delivery note (Gemini's `style`, OpenAI's `instructions`). */
  instructions: boolean;
  /** Characters per request; longer text is split at clause boundaries. */
  maxChars: number;
  /** The languages it reads; absent: Vietnamese and English. */
  langs?: readonly ('vi' | 'en')[];
  /** Where the key is made. */
  keyUrl: string;
}

export const TTS_PRESETS: readonly TtsPreset[] = [
  // 8,192 input tokens per request; the free tier allows 10 requests a day per model (S11).
  { id: 'gemini', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com', origin: 'https://generativelanguage.googleapis.com/*', model: 'gemini-3.8-flash-tts', instructions: true, maxChars: 3000, keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'openai', label: 'OpenAI-compatible', baseUrl: 'https://api.openai.com/v1', origin: 'https://api.openai.com/*', model: 'gpt-4o-mini-tts', editableBaseUrl: true, instructions: true, maxChars: 4000, keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'azure', label: 'Azure Speech', baseUrl: 'https://{region}.tts.speech.microsoft.com', origin: 'https://*.tts.speech.microsoft.com/*', needsRegion: true, instructions: false, maxChars: 3000, keyUrl: 'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices' },
  { id: 'elevenlabs', label: 'ElevenLabs', baseUrl: 'https://api.elevenlabs.io', origin: 'https://api.elevenlabs.io/*', model: 'eleven_flash_v2_5', instructions: false, maxChars: 4000, keyUrl: 'https://elevenlabs.io/app/settings/api-keys' },
  // 5,000 bytes of text per request: Vietnamese letters take up to 3 bytes each.
  { id: 'gcloud', label: 'Google Cloud TTS', baseUrl: 'https://texttospeech.googleapis.com', origin: 'https://texttospeech.googleapis.com/*', instructions: false, maxChars: 1500, keyUrl: 'https://console.cloud.google.com/apis/credentials' },
  // Realtime mode: 300 characters per request, Vietnamese voices only (English needs a webhook).
  { id: 'vbee', label: 'Vbee', baseUrl: 'https://api.vbee.vn', origin: 'https://api.vbee.vn/*', needsAppId: true, instructions: false, maxChars: 300, langs: ['vi'], keyUrl: 'https://vbee.vn' },
  { id: 'fpt', label: 'FPT.AI', baseUrl: 'https://api.fpt.ai', origin: 'https://api.fpt.ai/*', instructions: false, maxChars: 2000, langs: ['vi'], keyUrl: 'https://console.fpt.ai' },
];

export const TTS_PRESET_IDS: readonly TtsPresetId[] = TTS_PRESETS.map((p) => p.id);

export const ttsPreset = (id: string): TtsPreset | undefined => TTS_PRESETS.find((p) => p.id === id);
