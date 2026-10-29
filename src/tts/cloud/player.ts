// Plays a cloud voice's audio in the panel with an <audio> element: every provider can answer in a
// format Chrome plays (MP3, or WAV for Gemini). FPT.AI answers with a link whose file appears after
// a while: it is loaded again until it plays (a media load needs no host permission, S11).
import { TtsError } from '../errors.ts';

export type CloudAudio = { blob: Blob } | { url: string };

/** How long FPT.AI's link is retried, and how often. */
export const LINK_RETRY_MS = 120_000;
export const LINK_RETRY_EVERY_MS = 3000;

export interface AudioPort {
  create(src: string): HTMLAudioElement;
  objectUrl(blob: Blob): string;
  revoke(url: string): void;
}

export const browserAudio: AudioPort = {
  create: (src) => new Audio(src),
  objectUrl: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

/** Plays one source to its end: 'ended', 'stopped' on abort, or rejects ('failed' when it can't load). */
function playOnce(port: AudioPort, src: string, signal: AbortSignal): Promise<'ended' | 'stopped' | 'failed'> {
  return new Promise((resolve) => {
    const audio = port.create(src);
    const finish = (r: 'ended' | 'stopped' | 'failed') => {
      signal.removeEventListener('abort', onAbort);
      audio.pause();
      resolve(r);
    };
    const onAbort = () => finish('stopped');
    if (signal.aborted) return finish('stopped');
    signal.addEventListener('abort', onAbort);
    audio.addEventListener('ended', () => finish('ended'));
    audio.addEventListener('error', () => finish('failed'));
    audio.play().catch(() => {
      // play() rejects on a load error too; the error event says which, so only a refusal to play counts here.
      if (!audio.error) finish('failed');
    });
  });
}

export async function playAudio(audio: CloudAudio, signal: AbortSignal, port: AudioPort = browserAudio, now: () => number = Date.now): Promise<'ended' | 'stopped'> {
  if ('blob' in audio) {
    const url = port.objectUrl(audio.blob);
    try {
      const r = await playOnce(port, url, signal);
      if (r === 'failed') throw new TtsError('unknown', 'The audio could not be played');
      return r;
    } finally {
      port.revoke(url);
    }
  }
  const until = now() + LINK_RETRY_MS;
  for (;;) {
    const r = await playOnce(port, audio.url, signal);
    if (r !== 'failed') return r;
    if (now() >= until) throw new TtsError('network', 'The provider’s audio did not arrive in time');
    const waited = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(true), LINK_RETRY_EVERY_MS);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        resolve(false);
      }, { once: true });
    });
    if (!waited) return 'stopped';
  }
}

/** A small least-recently-used map of synthesized audio, so a replay or a prefetched block costs no request. */
export class AudioCache<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max = 24) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }
}
