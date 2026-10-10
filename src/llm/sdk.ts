// Shared adapter plumbing (DESIGN.md §4.2.2–§4.2.4, decision S4). Both SDK adapters run their
// attempts through `streamAttempts`, which gives them the same contract behaviour
// (src/llm/types.ts): pre-fetch checks, one classified `error` event instead of a throw, the
// §4.2.4 quirk flip at most once per `stream()` call, `usage` always before the terminal event,
// and a cancel that throws `signal.reason`.

import { checkBaseUrl, checkHeaders, checkKey, classifyFetchError, classifyHttpError, classifyStreamError, isQuirkFlipCandidate } from './errors.ts';
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
  /**
   * Called once when a §4.2.4 quirk flip was confirmed: the resend after it got a response that
   * is not an error. `quirks` is the connection's full quirk set after the flip, `learned` names
   * the flag that changed. The shell saves it on the stored connection (M4 data model); the
   * adapter has already updated `conn.quirks` in memory. A throwing callback is ignored.
   */
  onQuirkLearned?: (conn: ResolvedConnection, learned: keyof Quirks, quirks: Quirks) => void;
  /** The idle limit in ms (IDLE_TIMEOUT_MS by default); tests shorten it. */
  idleMs?: number;
}

/**
 * A quirk the adapter can flip when a 400 names the parameter (§4.2.4). `apply` returns false
 * when the request did not use that parameter or the quirk is already flipped: a generic 400 that
 * happens to contain the word (Gemini's "Invalid JSON payload received. Unknown name …") must not
 * flip a quirk and resend an identical request (review N2).
 */
export interface QuirkFlip {
  /** The `Quirks` flag `apply` changes, reported to `onQuirkLearned`. */
  key: keyof Quirks;
  test: RegExp;
  apply: (quirks: Quirks, req: NormalizedRequest) => boolean;
}

export const FLIP_TEMPERATURE: QuirkFlip = {
  key: 'supportsTemperature',
  test: /temperature/i,
  apply: (q, req) => req.temperature !== undefined && q.supportsTemperature !== false && ((q.supportsTemperature = false), true),
};

/** Rows 0a and 0b, plus a key-style auth with no key (the SDK would throw before any request). */
export function preflight(conn: ResolvedConnection): LLMError | null {
  const url = checkBaseUrl(conn.baseUrl);
  if (url !== null) return url;
  const headers = checkHeaders(conn.extraHeaders, conn.auth.style === 'custom-header' ? (conn.auth.headerName ?? 'api-key') : undefined);
  if (headers !== null) return headers;
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

/** The flip that applies to a 400, applied to `quirks`; null if none does, the request did not use the parameter, or it is already flipped. */
export function flipQuirk(error: LLMError, quirks: Quirks, req: NormalizedRequest, flips: readonly QuirkFlip[]): QuirkFlip | null {
  if (!isQuirkFlipCandidate(error)) return null;
  for (const flip of flips) if (flip.test.test(error.message) && flip.apply(quirks, req)) return flip;
  return null;
}

type Usage = Extract<NormalizedEvent, { type: 'usage' }>;

/**
 * How long one request may be silent, in ms: no response headers, or no bytes of the response
 * body, before it is aborted and reported as a `network` error (§4.3.5: retry with backoff, then
 * the fallback profile). Without it a provider that hangs, rather than refuses, holds its chunk,
 * and the job, for as long as the connection lives. Watched on raw bytes (`watchedFetch`), because
 * the SDKs drop SSE comments and `ping` events before an adapter sees them, so a thinking model
 * that sends only keepalives for a minute is alive, not hung.
 */
export const IDLE_TIMEOUT_MS = 60_000;

/** One attempt's idle watch: `signal` aborts when `touch()` was not called for `ms`, or when the request's own signal aborts (a cancel). */
export interface IdleGuard {
  signal: AbortSignal;
  /** Call when the response arrives and on every chunk of its body (`watchedFetch`). */
  touch(): void;
  /** True once the guard, not the request's signal, aborted. */
  timedOut(): boolean;
  dispose(): void;
}

export function idleGuard(parent: AbortSignal, ms: number = IDLE_TIMEOUT_MS): IdleGuard {
  const controller = new AbortController();
  let fired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onParent = (): void => controller.abort(parent.reason);
  if (parent.aborted) onParent();
  else parent.addEventListener('abort', onParent, { once: true });
  const touch = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      fired = !parent.aborted;
      if (fired) controller.abort(new DOMException('no response', 'TimeoutError'));
    }, ms);
  };
  touch();
  return {
    signal: controller.signal,
    touch,
    timedOut: () => fired,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      parent.removeEventListener('abort', onParent);
    },
  };
}

/** The guard of the attempt now running, for the `fetch` the SDK client was built with. */
export interface GuardHolder {
  guard?: IdleGuard;
}

/**
 * `base` with its response body read through the holder's guard: every chunk read resets the idle
 * timer. A reader is pulled only when the consumer asks for more, so a consumer that stops
 * reading for longer than the limit (a stalled UI thread) is indistinguishable from a silent
 * provider and aborts a healthy stream (accepted; the pipeline retries it).
 */
// The returned Response loses `url` and `redirected`; the SDKs' streaming path does not use them.
export function watchedFetch(base: typeof globalThis.fetch, holder: GuardHolder): typeof globalThis.fetch {
  return async (input, init) => {
    const res = await base(input, init);
    const guard = holder.guard;
    if (guard === undefined || res.body === null) return res;
    guard.touch();
    const reader = res.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else {
          guard.touch();
          controller.enqueue(value);
        }
      },
      cancel: (reason) => reader.cancel(reason),
    });
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}

function idleError(conn: ResolvedConnection, cause?: unknown): LLMError {
  let host = conn.baseUrl;
  try {
    host = new URL(conn.baseUrl).host;
  } catch {
    // Keep the base URL as written.
  }
  return { kind: 'network', message: `No response from ${host} for ${IDLE_TIMEOUT_MS / 1000} s`, raw: cause };
}

export interface AttemptOptions {
  isApiError: (e: unknown) => e is SdkApiError;
  flips: readonly QuirkFlip[];
  onQuirkLearned?: AdapterOptions['onQuirkLearned'];
  /** The idle limit in ms; IDLE_TIMEOUT_MS when left out (tests shorten it). */
  idleMs?: number;
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
  attempt: (quirks: Quirks, guard: IdleGuard) => AsyncIterable<NormalizedEvent>,
  options: AttemptOptions,
): AsyncGenerator<NormalizedEvent> {
  // An attempt may yield `usage` more than once (a provisional one as soon as the input count is
  // known, the final one at the end): the last one wins, and it is sent before the terminal event.
  const pre = preflight(conn);
  if (pre !== null) {
    yield { type: 'error', error: pre };
    return;
  }
  let flipped: QuirkFlip | null = null;
  let flippedOnce = false;
  const confirm = (): void => {
    if (flipped === null || options.onQuirkLearned === undefined) return;
    const learned = flipped.key;
    flipped = null;
    try {
      options.onQuirkLearned(conn, learned, { ...conn.quirks });
    } catch {
      // Persisting is the shell's business; it must not fail the translation.
    }
  };
  for (;;) {
    req.signal.throwIfAborted();
    let sawText = false;
    let usage: Usage | undefined;
    const guard = idleGuard(req.signal, options.idleMs);
    try {
      for await (const event of attempt(conn.quirks, guard)) {
        if (event.type === 'usage') {
          usage = event;
          continue;
        }
        if (event.type === 'done') {
          confirm();
          if (usage !== undefined) yield usage;
          yield event;
          return;
        }
        if (event.type === 'text' && event.delta !== '') {
          sawText = true;
          confirm();
        }
        yield event;
      }
      req.signal.throwIfAborted();
      // An SDK that swallowed the idle abort ends the stream quietly: still a network error, not a cut.
      if (guard.timedOut()) throw guard.signal.reason;
      confirm();
      if (usage !== undefined) yield usage;
      yield { type: 'done', stopReason: 'other' };
      return;
    } catch (err) {
      if (req.signal.aborted) throw req.signal.reason;
      const error = guard.timedOut() ? idleError(conn, err) : await classifySdkError(err, conn, options.isApiError);
      // §4.2.4: flip the named quirk and resend once. Never after text (it can't be taken back),
      // never twice, and only on a status-400 bad_request (never a 429, 5xx or network error).
      if (!sawText && flipped === null && !flippedOnce) {
        const flip = flipQuirk(error, conn.quirks, req, options.flips);
        if (flip !== null) {
          flipped = flip;
          flippedOnce = true;
          continue;
        }
      }
      if (usage !== undefined) yield usage;
      yield { type: 'error', error };
      return;
    } finally {
      guard.dispose();
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
