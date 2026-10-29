import type { TtsConnection } from '../settings.ts';
import type { CloudAudio } from './player.ts';

export type CloudLang = 'vi' | 'en';

export interface SynthesisRequest {
  text: string;
  voice: string;
  lang: CloudLang;
  /** A delivery note, for providers that take one. */
  note?: string | undefined;
  key: string;
  conn: TtsConnection;
  signal: AbortSignal;
  fetcher?: typeof fetch;
}

export interface CloudAdapter {
  /** The voices offered for a language, the default first; empty when the provider does not read it. */
  voices(lang: CloudLang): readonly { id: string; name: string }[];
  synthesize(req: SynthesisRequest): Promise<CloudAudio>;
}

/** The region a language is read in. */
export const LOCALE: Record<CloudLang, string> = { vi: 'vi-VN', en: 'en-US' };

/** The same voices for both languages (providers whose voices speak any language). */
export const anyLang = (list: readonly string[]) => () => list.map((id) => ({ id, name: id }));
