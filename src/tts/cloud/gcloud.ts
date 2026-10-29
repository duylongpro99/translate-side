// Google Cloud Text-to-Speech with a standard API key (S11: an AI Studio key is refused).
import { TtsError } from '../errors.ts';
import { decodeBase64, send } from './request.ts';
import { type CloudAdapter, LOCALE } from './adapter.ts';

const VOICES = {
  vi: ['vi-VN-Chirp3-HD-Kore', 'vi-VN-Chirp3-HD-Puck', 'vi-VN-Neural2-A', 'vi-VN-Neural2-D', 'vi-VN-Wavenet-A'],
  en: ['en-US-Chirp3-HD-Kore', 'en-US-Chirp3-HD-Puck', 'en-US-Neural2-F', 'en-US-Neural2-D'],
};

export const gcloud: CloudAdapter = {
  voices: (lang) => VOICES[lang].map((id) => ({ id, name: id })),
  async synthesize({ text, voice, lang, key, conn, signal, fetcher }) {
    const res = await send(
      `${conn.baseUrl}/v1/text:synthesize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ input: { text }, voice: { languageCode: LOCALE[lang], name: voice }, audioConfig: { audioEncoding: 'MP3' } }),
      },
      signal,
      fetcher,
    );
    const { audioContent } = (await res.json()) as { audioContent?: string };
    if (!audioContent) throw new TtsError('unknown', 'Google Cloud answered without audio');
    return { blob: new Blob([decodeBase64(audioContent)], { type: 'audio/mpeg' }) };
  },
};
