// Azure Speech: SSML by key and region (the key header is enough, no token exchange; S11).
import { TtsError } from '../errors.ts';
import { endpointOf } from '../settings.ts';
import { send } from './request.ts';
import { type CloudAdapter, LOCALE } from './adapter.ts';

const VOICES = {
  vi: ['vi-VN-HoaiMyNeural', 'vi-VN-NamMinhNeural'],
  en: ['en-US-AvaMultilingualNeural', 'en-US-AndrewMultilingualNeural', 'en-US-JennyNeural'],
};

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c);

export const azure: CloudAdapter = {
  voices: (lang) => VOICES[lang].map((id) => ({ id, name: id })),
  async synthesize({ text, voice, lang, key, conn, signal, fetcher }) {
    // A region that does not exist has no host: the browser is online but the address does not resolve.
    const res = await send(
      `${endpointOf(conn)}/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' },
        body: `<speak version='1.0' xml:lang='${LOCALE[lang]}'><voice name='${xml(voice)}'>${xml(text)}</voice></speak>`,
      },
      signal,
      fetcher,
    ).catch((e: unknown) => {
      if (e instanceof TtsError && e.kind === 'network' && globalThis.navigator?.onLine !== false) throw new TtsError('bad_request', `Azure Speech could not be reached at region "${conn.region ?? ''}": check the region`);
      throw e;
    });
    return { blob: new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' }) };
  },
};
