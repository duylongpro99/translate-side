// Gemini TTS through the Interactions API (S11): base64 WAV in a JSON answer. The delivery note goes
// in the text's `speech_metadata` style, never in the text, which is read word for word.
import { TtsError } from '../errors.ts';
import { decodeBase64, send } from './request.ts';
import { anyLang, type CloudAdapter } from './adapter.ts';

const VOICES = ['Kore', 'Puck', 'Charon', 'Aoede', 'Leda', 'Orus', 'Zephyr', 'Fenrir'];

interface Interaction {
  steps?: { type?: string; content?: { type?: string; mime_type?: string; data?: string }[] }[];
}

export const gemini: CloudAdapter = {
  voices: anyLang(VOICES),
  async synthesize({ text, voice, note, key, conn, signal, fetcher }) {
    const res = await send(
      `${conn.baseUrl}/v1beta/interactions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          model: conn.model,
          input: [{ type: 'user_input', content: [{ type: 'text', text, ...(note ? { annotations: [{ type: 'speech_metadata', style: note }] } : {}) }] }],
          response_format: { type: 'audio' },
          generation_config: { speech_config: [{ voice }] },
        }),
      },
      signal,
      fetcher,
    );
    const body = (await res.json()) as Interaction;
    const audio = (body.steps ?? [])
      .filter((s) => s.type === 'model_output')
      .flatMap((s) => s.content ?? [])
      .filter((c) => c.type === 'audio' && c.data)
      .at(-1);
    if (!audio?.data) throw new TtsError('unknown', 'Gemini answered without audio');
    return { blob: new Blob([decodeBase64(audio.data)], { type: audio.mime_type ?? 'audio/wav' }) };
  },
};
