// Shared adapter plumbing (DESIGN.md §4.2.2–§4.2.4, decision S4). Both SDK adapters run their
// attempts through `streamAttempts`, which gives them the same contract behaviour
// (src/llm/types.ts): pre-fetch checks, one classified `error` event instead of a throw, the
// §4.2.4 quirk flip at most once per `stream()` call, `usage` always before the terminal event,
// and a cancel that throws `signal.reason`.

import { checkBaseUrl, checkKey, classifyFetchError, classifyHttpError, classifyStreamError, isQuirkFlipCandidate } from './errors.ts';
import type { LLMError, NormalizedEvent, NormalizedRequest, Quirks, ResolvedConnection } from './types.ts';

/** What both SDKs' `APIError` classes share. `status` is undefined for connection and mid-stream errors. */
export interface SdkApiError {
  status: number | undefined;
  headers: { get(name: string): string | null } | undefined;
  /** The parsed JSON body; undefined when the body was not JSON (the raw text is then `message`). */
  error: unknown;
  message: string;
}

/** Options every SDK adapter factory takes. */
export interface AdapterOptions {
  /** A `fetch` for the SDK client (tests count requests with it); the global one otherwise. */
  fetch?: typeof globalThis.fetch;
}

/** A quirk the adapter can flip when a 400 names the parameter (§4.2.4). Returns false if it is already flipped. */
export interface QuirkFlip {
  test: RegExp;
  apply: (quirks: Quirks) => boolean;
}

export const FLIP_TEMPERATURE: QuirkFlip = {
  test: /temperature/i,
  apply: (q) => q.supportsTemperature !== false && ((q.supportsTemperature = false), true),
};

/** Rows 0a and 0b, plus a key-style auth with no key (the SDK would throw before any request). */
export function preflight(conn: ResolvedConnection): LLMError | null {
  const url = checkBaseUrl(conn.baseUrl);
  if (url !== null) return url;
  if (conn.auth.style === 'none') return null;
  if (conn.apiKey === undefined || conn.apiKey === '') return { kind: 'auth', message: 'Key invalid or missing' };
  return checkKey(conn.apiKey);
}

/**
 * Turns what an SDK threw into an LLMError. An `APIError` with a status is an HTTP error response
 * (S4 rows 3–10). The SDKs parse the body as JSON when they can; otherwise `error` is undefined
 * and the raw text is the message, so the classifier gets the text (S4 open item). Without a
 * status it is a mid-stream `error` event (the body is in `error`) or a connection failure (the
 * fetch `TypeError` is in the `cause` chain, rows 1–2).
 */
export async function classifySdkError(err: unknown, conn: ResolvedConnection, isApiError: (e: unknown) => e is SdkApiError): Promise<LLMError> {
  if (isApiError(err)) {
    if (err.status !== undefined) {
      // A non-JSON body: the SDK's message is `${status} ${text}`; the classifier wants the text.
      const prefix = `${err.status} `;
      const text = err.message.startsWith(prefix) ? err.message.slice(prefix.length) : err.message;
      return classifyHttpError({
        status: err.status,
        body: err.error ?? text,
        ...(err.headers === undefined ? {} : { headers: err.headers }),
        auth: conn.auth.style,
        baseUrl: conn.baseUrl,
      });
    }
    if (err.error !== undefined) return classifyStreamError(err.error);
  }
  const hasHostPermission = await conn.hasHostPermission();
  return classifyFetchError({ error: err, aborted: false, hasHostPermission, baseUrl: conn.baseUrl }) ?? { kind: 'unknown', message: String(err), raw: err };
}

/** The flip that applies to a 400, applied to `quirks`; null if none does or it is already flipped. */
export function flipQuirk(error: LLMError, quirks: Quirks, flips: readonly QuirkFlip[]): QuirkFlip | null {
  if (!isQuirkFlipCandidate(error)) return null;
  for (const flip of flips) if (flip.test.test(error.message) && flip.apply(quirks)) return flip;
  return null;
}

type Usage = Extract<NormalizedEvent, { type: 'usage' }>;

export interface AttemptOptions {
  isApiError: (e: unknown) => e is SdkApiError;
  flips: readonly QuirkFlip[];
}

/**
 * Runs `attempt` (one SDK request, yielding `text`, at most one `usage` and, if the server
 * finished the stream, one `done`) under the LLMClient contract. An attempt that ends without
 * `done` was cut by the server or by an abort the SDK swallowed: an abort throws `signal.reason`,
 * otherwise it is `done` with `stopReason: other` (every stop other than `end` is a cut, S2).
 */
export async function* streamAttempts(
  conn: ResolvedConnection,
  req: NormalizedRequest,
  attempt: (quirks: Quirks) => AsyncIterable<NormalizedEvent>,
  options: AttemptOptions,
): AsyncGenerator<NormalizedEvent> {
  // An attempt may yield `usage` more than once (a provisional one as soon as the input count is
  // known, the final one at the end): the last one wins, and it is sent before the terminal event.
  const pre = preflight(conn);
  if (pre !== null) {
    yield { type: 'error', error: pre };
    return;
  }
  let flipped = false;
  for (;;) {
    req.signal.throwIfAborted();
    let sawText = false;
    let usage: Usage | undefined;
    try {
      for await (const event of attempt(conn.quirks)) {
        if (event.type === 'usage') {
          usage = event;
          continue;
        }
        if (event.type === 'done') {
          if (usage !== undefined) yield usage;
          yield event;
          return;
        }
        if (event.type === 'text' && event.delta !== '') sawText = true;
        yield event;
      }
      req.signal.throwIfAborted();
      if (usage !== undefined) yield usage;
      yield { type: 'done', stopReason: 'other' };
      return;
    } catch (err) {
      if (req.signal.aborted) throw req.signal.reason;
      const error = await classifySdkError(err, conn, options.isApiError);
      // §4.2.4: flip the named quirk and resend once. Never after text (it can't be taken back),
      // never twice, and only on a status-400 bad_request (never a 429, 5xx or network error).
      if (!sawText && !flipped && flipQuirk(error, conn.quirks, options.flips) !== null) {
        flipped = true;
        continue;
      }
      if (usage !== undefined) yield usage;
      yield { type: 'error', error };
      return;
    }
  }
}

/** Header map for `custom-header` / `none` auth: the SDK's own auth header is removed with `null`. */
export function headerOverrides(conn: ResolvedConnection, sdkAuthHeader: string): Record<string, string | null> {
  const headers: Record<string, string | null> = { ...conn.extraHeaders };
  if (conn.auth.style === 'custom-header' && conn.apiKey !== undefined) {
    headers[sdkAuthHeader] = null;
    headers[conn.auth.headerName ?? 'api-key'] = conn.apiKey;
  } else if (conn.auth.style === 'none') headers[sdkAuthHeader] = null;
  return headers;
}
