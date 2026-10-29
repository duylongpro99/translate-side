// The system voice: chrome.tts, the zero-setup default. Text is made speakable (speakable.ts) and
// read one clause at a time with a short pause between them. A voice is picked per block language
// and never borrowed from another language: when none matches, `done` rejects with `no-voice` so
// the panel can suggest a system voice or a provider. Chrome's network voices ("Google …")
// send the text to Google, so they are used only when the reader picked one by name.
import { browser } from 'wxt/browser';
import { TtsError } from './errors.ts';
import { speakable } from './speakable.ts';
import type { Playback, PlaybackEnd, Progress, SpeakOptions, TtsEngine, Voice } from './types.ts';

/** A chrome.tts voice, the fields this module reads. */
export interface SystemVoice {
  voiceName?: string;
  lang?: string;
  remote?: boolean;
}

export interface SystemTtsEvent {
  type: string;
  errorMessage?: string;
}

export interface SystemSpeakOptions {
  voiceName: string;
  lang: string;
  rate: number;
  onEvent: (e: SystemTtsEvent) => void;
}

/** chrome.tts as this module uses it (a port, so tests pass a fake). */
export interface ChromeTtsPort {
  getVoices(): Promise<SystemVoice[]>;
  speak(utterance: string, options: SystemSpeakOptions): Promise<void> | void;
  stop(): void;
}

export const chromeTts = (): ChromeTtsPort => ({
  getVoices: () => browser.tts.getVoices(),
  speak: (utterance, options) => browser.tts.speak(utterance, options),
  stop: () => browser.tts.stop(),
});

/** Silence after a clause: longer after a sentence than after a comma. */
export const SENTENCE_PAUSE_MS = 220;
export const CLAUSE_PAUSE_MS = 90;

/** Each language's own region first when a reader says only "vi" or "en". */
const HOME_REGION: Record<string, string> = { vi: 'vi-VN', en: 'en-US' };

const primaryOf = (lang: string) => lang.trim().toLowerCase().split(/[-_]/)[0] ?? '';

/** The voices for `lang`'s primary language: local before network, the exact (or home) region first. */
export function rankVoices(all: readonly SystemVoice[], lang: string): Voice[] {
  const want = primaryOf(lang);
  if (!want) return [];
  const exact = (lang.includes('-') ? lang : (HOME_REGION[want] ?? lang)).toLowerCase();
  const score = (v: SystemVoice) => (v.remote ? 2 : 0) + ((v.lang ?? '').toLowerCase().replace('_', '-') === exact ? 0 : 1);
  return all
    .flatMap((v, i) => (v.voiceName && primaryOf(v.lang ?? '') === want ? [{ v, name: v.voiceName, i }] : []))
    .sort((a, b) => score(a.v) - score(b.v) || a.i - b.i)
    .map(({ v, name }) => ({ id: name, name, lang: v.lang ?? lang, engine: 'system' as const, remote: v.remote === true }));
}

/** The voice to read `lang` with: the named one if it reads that language, else the best local voice. */
export function pickVoice(voices: readonly Voice[], wanted?: string): Voice | undefined {
  return (wanted ? voices.find((v) => v.id === wanted) : undefined) ?? voices.find((v) => !v.remote);
}

export function systemEngine(tts: ChromeTtsPort = chromeTts()): TtsEngine {
  const voices = async (lang: string) => rankVoices(await tts.getVoices(), lang);

  return {
    id: 'system',
    voices,
    speak(text: string, opts: SpeakOptions): Playback {
      let stopped = false;
      let release: () => void = () => {};
      const stopping = new Promise<'stopped'>((resolve) => {
        release = () => resolve('stopped');
      });

      /** One clause: 'end' when Chrome says so, 'stopped' on stop() or when another utterance cut it off. */
      const say = (clause: string, voice: Voice) =>
        new Promise<'end' | 'stopped'>((resolve, reject) => {
          const sent = tts.speak(clause, {
            voiceName: voice.id,
            lang: voice.lang,
            rate: opts.rate ?? 1,
            onEvent: (e) => {
              if (e.type === 'end') resolve('end');
              else if (e.type === 'interrupted' || e.type === 'cancelled') resolve('stopped');
              else if (e.type === 'error') reject(new TtsError('unknown', e.errorMessage || 'The system voice failed'));
            },
          });
          if (sent instanceof Promise) sent.catch((e: unknown) => reject(new TtsError('unknown', e instanceof Error ? e.message : String(e))));
        });

      const pause = (ms: number) => Promise.race([new Promise<void>((r) => setTimeout(r, ms)), stopping]);

      // Built before `done` so the reading loop sees an onProgress the caller sets after speak() returns.
      const playback: { -readonly [K in keyof Playback]: Playback[K] } = {
        done: Promise.resolve('ended'),
        stop() {
          if (stopped) return;
          stopped = true;
          release();
          tts.stop();
        },
      };

      playback.done = (async (): Promise<PlaybackEnd> => {
        const voice = pickVoice(await voices(opts.lang), opts.voice);
        if (stopped) return 'stopped';
        if (!voice) throw new TtsError('no-voice', `No system voice reads ${opts.lang || 'this language'}`);
        const clauses = speakable(text, opts.lang);
        for (const [i, clause] of clauses.entries()) {
          if (stopped) return 'stopped';
          const progress: Progress = { clause: i, clauses: clauses.length };
          playback.onProgress?.(progress);
          if ((await Promise.race([say(clause, voice), stopping])) === 'stopped') {
            stopped = true;
            return 'stopped';
          }
          if (i < clauses.length - 1 && (await pause(/[.!?…。！？]["'”’»)\]]*$/.test(clause) ? SENTENCE_PAUSE_MS : CLAUSE_PAUSE_MS)) === 'stopped') return 'stopped';
        }
        return 'ended';
      })();
      return playback;
    },
  };
}
