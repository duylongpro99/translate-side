// ElevenLabs: a premade voice by id, the language named so a multilingual voice reads Vietnamese.
import { send } from './request.ts';
import type { CloudAdapter } from './adapter.ts';

const VOICES = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },
];

export const elevenlabs: CloudAdapter = {
  voices: () => VOICES,
  async synthesize({ text, voice, lang, key, conn, signal, fetcher }) {
    const res = await send(
      `${conn.baseUrl}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
        body: JSON.stringify({ text, model_id: conn.model, language_code: lang }),
      },
      signal,
      fetcher,
    );
    return { blob: new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' }) };
  },
};
