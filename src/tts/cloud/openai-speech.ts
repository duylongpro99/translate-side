// OpenAI's /audio/speech and the servers that copy it (OpenRouter, gateways): raw MP3 back.
// `instructions` (the delivery note) only for models that take it: some gateways refuse unknown fields.
import { send } from './request.ts';
import { anyLang, type CloudAdapter } from './adapter.ts';

const VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

export const openai: CloudAdapter = {
  voices: anyLang(VOICES),
  async synthesize({ text, voice, note, key, conn, signal, fetcher }) {
    const instructions = note && /gpt-4o-mini-tts/.test(conn.model ?? '') ? { instructions: note } : {};
    const res = await send(
      `${conn.baseUrl}/audio/speech`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: conn.model, input: text, voice, response_format: 'mp3', ...instructions }),
      },
      signal,
      fetcher,
    );
    return { blob: new Blob([await res.arrayBuffer()], { type: res.headers.get('content-type') ?? 'audio/mpeg' }) };
  },
};
