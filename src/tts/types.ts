// Text-to-speech engines. One interface for the system voice (chrome.tts) and the user's own
// cloud provider, so the read-aloud controller and the
// Voice settings never care which one is playing.
import type { LLMErrorKind } from '@/llm/types';

export type TtsEngineId = 'system' | 'cloud';

export interface Voice {
  /** Unique within its engine: chrome.tts's voiceName, a provider's voice name. */
  id: string;
  /** What the picker shows. */
  name: string;
  /** BCP 47 ("vi-VN", "en-US"). */
  lang: string;
  engine: TtsEngineId;
  /** The text leaves the computer (a provider, or one of Chrome's network voices). */
  remote: boolean;
}

export interface SpeakOptions {
  /** The text's language, BCP 47. A voice in another language is never used. */
  lang: string;
  /** A Voice.id; when absent or not found, the engine picks one for `lang`. */
  voice?: string | undefined;
  /** 0.5–2, 1 is normal. */
  rate?: number;
  /** A delivery note (genre, tone, stress) for providers that take instructions. */
  note?: string | undefined;
}

export interface Progress {
  /** The clause being read, from 0, and how many there are. */
  clause: number;
  clauses: number;
}

/** How a playback ended: it read to the end, or stop() (or another playback) cut it short. */
export type PlaybackEnd = 'ended' | 'stopped';

export interface Playback {
  /** Settles once: resolves when reading ends or is stopped, rejects with a TtsError. */
  readonly done: Promise<PlaybackEnd>;
  /** Idempotent; `done` then resolves 'stopped'. */
  stop(): void;
  onProgress?: (p: Progress) => void;
}

export interface TtsEngine {
  readonly id: TtsEngineId;
  /** The voices for `lang` (any region of its primary language), best first. */
  voices(lang: string): Promise<Voice[]>;
  speak(text: string, opts: SpeakOptions): Playback;
  /** Fetches audio ahead of time (cloud engines), so the next block starts without a wait. */
  prefetch?(text: string, opts: SpeakOptions): void;
}

/** `no-voice`: nothing can read this language (the UI suggests a system voice or a provider). */
export type TtsErrorKind = 'no-voice' | LLMErrorKind;
