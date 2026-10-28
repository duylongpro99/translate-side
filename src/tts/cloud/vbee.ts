// Vbee realtime: Vietnamese only, 300 characters per request, MP3 streamed back. The token goes
// with the console app's id.
import { send } from './request.ts';
import type { CloudAdapter } from './adapter.ts';

const VOICES = [{ id: 'hn_female_ngochuyen_full_48k-fhg', name: 'Ngọc Huyền (Hà Nội)' }];

export const vbee: CloudAdapter = {
  voices: (lang) => (lang === 'vi' ? VOICES : []),
  async synthesize({ text, voice, key, conn, signal, fetcher }) {
    const res = await send(
      `${conn.baseUrl}/v1/tts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'App-Id': conn.appId ?? '' },
        body: JSON.stringify({ text, mode: 'sync', voiceCode: voice, outputFormat: 'mp3' }),
      },
      signal,
      fetcher,
    );
    return { blob: new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' }) };
  },
};
