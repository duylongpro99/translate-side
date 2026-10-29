import type { TtsErrorKind } from './types.ts';

/** Why a voice could not read: the same kinds as src/llm/errors.ts, plus `no-voice`. */
export class TtsError extends Error {
  constructor(
    readonly kind: TtsErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TtsError';
  }
}

export const isTtsError = (e: unknown): e is TtsError => e instanceof TtsError;
