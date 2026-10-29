// FPT.AI: Vietnamese only. The answer is a link where the MP3 appears after a few seconds; the
// player loads it again until it plays (no callback server needed, S11).
import { classifyStatus, send } from './request.ts';
import type { CloudAdapter } from './adapter.ts';

const VOICES = [
  { id: 'banmai', name: 'Ban Mai (miền Bắc)' },
  { id: 'thuminh', name: 'Thu Minh (miền Bắc)' },
  { id: 'leminh', name: 'Lê Minh (miền Bắc)' },
  { id: 'myan', name: 'Mỹ An (miền Trung)' },
  { id: 'giahuy', name: 'Gia Huy (miền Trung)' },
  { id: 'lannhi', name: 'Lan Nhi (miền Nam)' },
  { id: 'linhsan', name: 'Linh San (miền Nam)' },
];

export const fpt: CloudAdapter = {
  voices: (lang) => (lang === 'vi' ? VOICES : []),
  async synthesize({ text, voice, key, conn, signal, fetcher }) {
    const res = await send(
      `${conn.baseUrl}/hmi/tts/v5`,
      { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8', api_key: key, voice, speed: '0', format: 'mp3' }, body: text },
      signal,
      fetcher,
    );
    const body = (await res.json()) as { async?: string; error?: number; message?: string };
    if (body.error !== 0 || !body.async) throw classifyStatus(400, body.message ?? 'FPT.AI answered without audio');
    return { url: body.async };
  },
};
