// The reader's own TTS provider as a TtsEngine. The text is made speakable, cut into pieces the
// provider accepts (at clause boundaries), and each piece is synthesized and played in turn while
// the next one is fetched. The controller's prefetch asks for the next block's first piece the same
// way, with at most one request of its own in flight; stop cancels both. Synthesized audio is kept in
// a small LRU, so replaying a block costs no request. Each provider's adapter loads when first used.
import type { browser } from 'wxt/browser';
import { TtsError } from '../errors.ts';
import { ttsPreset, type TtsPresetId } from '../presets.ts';
import { readTtsKey, type TtsConnection } from '../settings.ts';
import { normalize, splitClauses } from '../speakable.ts';
import type { Playback, PlaybackEnd, SpeakOptions, TtsEngine, Voice } from '../types.ts';
import { AudioCache, type AudioPort, browserAudio, type CloudAudio, playAudio } from './player.ts';
import type { CloudAdapter, CloudLang } from './adapter.ts';

type Browser = typeof browser;

const ADAPTERS: Record<TtsPresetId, () => Promise<CloudAdapter>> = {
  gemini: () => import('./gemini.ts').then((m) => m.gemini),
  openai: () => import('./openai-speech.ts').then((m) => m.openai),
  azure: () => import('./azure.ts').then((m) => m.azure),
  elevenlabs: () => import('./elevenlabs.ts').then((m) => m.elevenlabs),
  gcloud: () => import('./gcloud.ts').then((m) => m.gcloud),
  vbee: () => import('./vbee.ts').then((m) => m.vbee),
  fpt: () => import('./fpt.ts').then((m) => m.fpt),
};

const cloudLang = (lang: string): CloudLang | undefined => {
  const p = lang.trim().toLowerCase().split(/[-_]/)[0];
  return p === 'vi' || p === 'en' ? p : undefined;
};

/** Whether the provider reads `lang` (its presets' languages, vi and en at most). */
export function cloudReads(conn: TtsConnection, lang: string): boolean {
  const l = cloudLang(lang);
  return l !== undefined && (ttsPreset(conn.presetId)?.langs ?? ['vi', 'en']).includes(l);
}

/**
 * The cloud engine for the languages the provider reads, the system voice for the rest: a block
 * in another language is read, not refused.
 */
export function withSystemVoice(cloud: TtsEngine, conn: TtsConnection, system: TtsEngine): TtsEngine {
  return {
    id: 'cloud',
    voices: (lang) => (cloudReads(conn, lang) ? cloud.voices(lang) : system.voices(lang)),
    // The reader's voice and note are the provider's: the system voice picks its own for the language.
    speak: (text, opts) => (cloudReads(conn, opts.lang) ? cloud.speak(text, opts) : system.speak(text, { lang: opts.lang, ...(opts.rate === undefined ? {} : { rate: opts.rate }) })),
    prefetch(text, opts) {
      if (cloudReads(conn, opts.lang)) cloud.prefetch?.(text, opts);
    },
  };
}

/** Clauses joined back into pieces of at most `max` characters. */
export function pieces(text: string, max: number): string[] {
  const out: string[] = [];
  for (const clause of splitClauses(text, max)) {
    const last = out.at(-1);
    if (last !== undefined && last.length + 1 + clause.length <= max) out[out.length - 1] = `${last} ${clause}`;
    else out.push(clause);
  }
  return out;
}

export interface CloudDeps {
  adapter?: CloudAdapter;
  readKey?: () => Promise<string | undefined>;
  audio?: AudioPort;
  fetcher?: typeof fetch;
}

export function cloudEngine(api: Browser, conn: TtsConnection, deps: CloudDeps = {}): TtsEngine {
  const preset = ttsPreset(conn.presetId);
  const max = preset?.maxChars ?? 1000;
  const langs = preset?.langs ?? ['vi', 'en'];
  const adapter = deps.adapter ? Promise.resolve(deps.adapter) : ADAPTERS[conn.presetId]();
  const readKey = deps.readKey ?? (() => readTtsKey(api, conn));
  const cache = new AudioCache<Promise<CloudAudio>>();
  /** The prefetch's own request: at most one, cancelled by any stop. */
  let prefetching: AbortController | undefined;

  const voicesFor = async (lang: string): Promise<Voice[]> => {
    const l = cloudLang(lang);
    if (!l || !langs.includes(l)) return [];
    return (await adapter).voices(l).map((v) => ({ id: v.id, name: v.name, lang: l === 'vi' ? 'vi-VN' : 'en-US', engine: 'cloud', remote: true }));
  };

  /** What a request needs, or a TtsError: a language and voice the provider reads, and a key. */
  const resolve = async (opts: SpeakOptions) => {
    const l = cloudLang(opts.lang);
    const voices = await voicesFor(opts.lang);
    const voice = voices.find((v) => v.id === opts.voice) ?? voices[0];
    if (!l || !voice) throw new TtsError('no-voice', `${preset?.label ?? 'This provider'} does not read ${opts.lang || 'this language'}`);
    const key = await readKey();
    if (!key) throw new TtsError('auth', `No key is saved for ${preset?.label ?? 'this provider'}`);
    return { lang: l, voice: voice.id, key };
  };

  const audioFor = (piece: string, r: { lang: CloudLang; voice: string; key: string }, note: string | undefined, signal: AbortSignal): Promise<CloudAudio> => {
    const id = JSON.stringify([conn.model, r.voice, r.lang, note ?? '', piece]);
    const hit = cache.get(id);
    if (hit) return hit;
    const p = adapter.then((a) => a.synthesize({ text: piece, voice: r.voice, lang: r.lang, note, key: r.key, conn, signal, ...(deps.fetcher ? { fetcher: deps.fetcher } : {}) }));
    cache.set(id, p);
    p.catch(() => cache.delete(id));
    return p;
  };

  const notePart = (opts: SpeakOptions) => (preset?.instructions ? opts.note : undefined);

  return {
    id: 'cloud',
    voices: voicesFor,

    prefetch(text, opts) {
      if (prefetching) return;
      const ac = new AbortController();
      prefetching = ac;
      void (async () => {
        const r = await resolve(opts);
        const first = pieces(normalize(text, opts.lang), max)[0];
        if (first !== undefined) await audioFor(first, r, notePart(opts), ac.signal);
      })()
        .catch(() => {})
        .finally(() => {
          if (prefetching === ac) prefetching = undefined;
        });
    },

    speak(text, opts): Playback {
      const ac = new AbortController();
      const playback: { -readonly [K in keyof Playback]: Playback[K] } = {
        done: Promise.resolve('ended'),
        stop() {
          ac.abort();
          prefetching?.abort();
        },
      };
      playback.done = (async (): Promise<PlaybackEnd> => {
        const r = await resolve(opts);
        const list = pieces(normalize(text, opts.lang), max);
        const note = notePart(opts);
        for (const [i, piece] of list.entries()) {
          if (ac.signal.aborted) return 'stopped';
          playback.onProgress?.({ clause: i, clauses: list.length });
          const audio = audioFor(piece, r, note, ac.signal);
          // The next piece is fetched while this one plays.
          const next = list[i + 1];
          if (next !== undefined) audioFor(next, r, note, ac.signal).catch(() => {});
          if ((await playAudio(await audio, ac.signal, deps.audio ?? browserAudio)) === 'stopped') return 'stopped';
        }
        return 'ended';
      })().catch((e: unknown) => {
        if (ac.signal.aborted) return 'stopped';
        throw e;
      });
      return playback;
    },
  };
}
