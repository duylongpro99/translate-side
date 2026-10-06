// LLMError classifier (DESIGN.md §4.3.5, decision S4 rows 0a–10). Adapter-side: adapters call it
// before the pipeline sees anything. It lives outside src/llm/types.ts (which must stay
// types-only, eslint.config.js) and is never imported by engine/.
//
// Matching runs on status first, then on the message text, never on `content-type` (an Ollama
// 404 is JSON labelled text/html). The message is `error.message` when `error` is an object,
// else `error` when it is a string; both forms occur.

import type { AuthStyle, LLMError } from './types.ts';

/** Anything with `get(name)`, like fetch `Headers`, or a plain lower-case header map. */
export type HeaderSource = { get(name: string): string | null } | Record<string, string | undefined>;

// ---- Checks before fetch (S4 rows 0a, 0b) -----------------------------------------------------

/** Row 0a: `new URL(base)` throws, the scheme is not http(s), or the host is empty. */
export function checkBaseUrl(base: string): LLMError | null {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return { kind: 'bad_request', message: 'Invalid base URL' };
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') {
    return { kind: 'bad_request', message: 'Invalid base URL' };
  }
  return null;
}

/** Keys are trimmed when saved: a pasted newline or tab at the edges would otherwise fail row 0b. */
export function normalizeKey(key: string): string {
  return key.trim();
}

const HEADER_SAFE = /^[\x20-\x7E\x80-\xFF]*$/;

/** Row 0b: the (trimmed) key can't go in an HTTP header. */
export function checkKey(key: string): LLMError | null {
  if (HEADER_SAFE.test(key)) return null;
  return { kind: 'auth', message: "Key has characters that can't be sent" };
}

// ---- After fetch: an HTTP error response (S4 rows 3–10, §4.3.5) ------------------------------

export interface HttpErrorInput {
  status: number;
  /** Parsed JSON, or the raw text (it is parsed here if it holds JSON). */
  body: unknown;
  headers?: HeaderSource;
  auth: AuthStyle;
  baseUrl: string;
  /** Clock for an HTTP-date `Retry-After`. */
  now?: () => number;
}

// A 404 message that names a model: the word "model" directly followed by the name (quoted or
// not), then "not found" / "does not exist"; or Gemini's "models/x is not found"; or Anthropic's
// bare "model: claude-x". Ollama: `model "x" not found`; OpenAI: "The model `x` does not exist or
// you do not have access to it."; a retired Gemini model: "This model models/x is no longer
// available to new users" (a 404 seen live, Phase C). The name must follow "model" at once, so a
// wrong-path 404 whose path merely contains the word (`path "/model/v1/x" not found`) does not
// match (Phase A c2).
const MODEL_NOT_FOUND =
  /^model:\s*\S|\bmodel(?:\s*[:=]\s*|\s+)[`"']?[\w.\-:/]+[`"']?\s+(?:is\s+)?(?:not\s+found|does\s+not\s+exist|no\s+longer\s+available)|\bmodels\/[\w.\-:]+\s+(?:is\s+|was\s+)?(?:not\s+found|no\s+longer\s+available)/i;
const CONTEXT_LENGTH = /context[ _-]?(length|window)|prompt is too long|too many (input )?tokens|maximum context|reduce the length/i;
const CREDIT_BALANCE = /credit balance/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function classifyHttpError(input: HttpErrorInput): LLMError {
  const { status } = input;
  const body = parseBody(input.body);
  const serverMessage = errorMessage(body);
  const { type, code } = errorTypeAndCode(body);
  const base = { status, raw: input.body };
  const msg = (fallback: string): string => serverMessage ?? fallback;

  if (status === 401) return { ...base, kind: 'auth', message: 'Key invalid or missing' };
  if (status === 402) return { ...base, kind: 'quota', message: msg('No allowance for this model') };
  if (status === 403) {
    if (input.auth === 'none' && isLocalhost(input.baseUrl)) {
      return { ...base, kind: 'cors', cause: 'origin', message: 'The local server rejected this origin' };
    }
    return { ...base, kind: 'auth', message: 'Key invalid or missing' };
  }
  if (status === 404) {
    // §4.3.5: model_not_found only when the message names a model. Deliberate deviation from S4
    // row 5 (user decision M1-D7): `type: not_found_error` alone is not enough, because Anthropic
    // sends it with "Not Found" for a wrong path too.
    if (code === 'model_not_found' || (serverMessage !== undefined && MODEL_NOT_FOUND.test(serverMessage))) {
      return { ...base, kind: 'model_not_found', message: msg('Model not found') };
    }
    return { ...base, kind: 'bad_request', message: `Wrong base URL (${serverMessage ?? 'path not found'})` };
  }
  if (status === 408) return { ...base, kind: 'network', message: msg('Request timed out') };
  if (status === 413) return { ...base, kind: 'context_length', message: msg('Request too large') };
  if (status === 429) {
    if (code === 'insufficient_quota' || type === 'insufficient_quota') {
      return { ...base, kind: 'quota', message: msg('No allowance left') };
    }
    return withRetryAfter({ ...base, kind: 'rate_limit', message: msg('Rate limited') }, input);
  }
  if (status >= 500) return withRetryAfter({ ...base, kind: 'overloaded', message: msg('The provider is overloaded') }, input);
  if (status === 400 || status === 422) {
    if (type === 'billing_error' || (serverMessage !== undefined && CREDIT_BALANCE.test(serverMessage))) {
      return { ...base, kind: 'quota', message: msg('No allowance left') };
    }
    if (code === 'context_length_exceeded' || (serverMessage !== undefined && CONTEXT_LENGTH.test(serverMessage))) {
      return { ...base, kind: 'context_length', message: msg('Input too long for the model') };
    }
    return { ...base, kind: 'bad_request', message: msg('Bad request') };
  }
  if (status >= 400) return { ...base, kind: 'bad_request', message: msg(`Request failed (${status})`) };
  return { ...base, kind: 'unknown', message: msg(`Unexpected status ${status}`) };
}

/**
 * S4 row 8: the adapter's quirk flip-and-retry-once (§4.2.4) runs on status 400 only. A 404
 * "wrong base URL" is also `bad_request`, so callers must check this, not the kind.
 */
export function isQuirkFlipCandidate(error: LLMError): boolean {
  return error.kind === 'bad_request' && error.status === 400;
}

// ---- Mid-stream error events (e.g. Anthropic SSE `event: error`) ------------------------------

const STREAM_ERROR_KINDS: Record<string, LLMError['kind']> = {
  authentication_error: 'auth',
  permission_error: 'auth',
  billing_error: 'quota',
  // Decision M1-D7 (404 → model_not_found only when the message names a model) is about the
  // HTTP status, where a 404 is as likely a wrong base URL as a missing model. It does not apply
  // here: an error inside a 200 stream came from the right URL, which already accepted the
  // request, so a not_found_error there can only be about the model (or a resource it needs).
  not_found_error: 'model_not_found',
  rate_limit_error: 'rate_limit',
  overloaded_error: 'overloaded',
  api_error: 'overloaded',
  // OpenAI-format gateways send `{"error":{"type":"server_error"}}` in the stream.
  server_error: 'overloaded',
  request_too_large: 'context_length',
  invalid_request_error: 'bad_request',
};

/** An error that arrives inside a 200 stream: there is no status, so the error type decides. */
export function classifyStreamError(payload: unknown): LLMError {
  const body = parseBody(payload);
  const { type } = errorTypeAndCode(body);
  const message = errorMessage(body) ?? 'The stream failed';
  const kind = (type !== undefined && STREAM_ERROR_KINDS[type]) || 'unknown';
  return { kind, message, raw: payload };
}

// ---- fetch threw (S4 rows 1, 2) ---------------------------------------------------------------

export interface FetchErrorInput {
  error: unknown;
  /** The job's AbortSignal had aborted: this is a cancel. */
  aborted: boolean;
  /** Result of `ResolvedConnection.hasHostPermission`. */
  hasHostPermission: boolean;
  baseUrl: string;
}

/**
 * Returns null for a cancel (the adapter then throws `signal.reason`; a cancel is never
 * `network`). SDKs wrap the fetch `TypeError` (the openai SDK's `APIConnectionError`), so the
 * `cause` chain is searched for it.
 */
export function classifyFetchError(input: FetchErrorInput): LLMError | null {
  if (input.aborted) return null;
  const host = hostOf(input.baseUrl);
  const typeError = findInCauseChain(input.error, (e) => e instanceof TypeError);
  if (typeError instanceof TypeError) {
    // The only TypeError with its own message: a key character fetch can't put in a header.
    if (/ISO-8859-1|headers/i.test(typeError.message)) {
      return { kind: 'auth', message: "Key has characters that can't be sent", raw: input.error };
    }
    if (!input.hasHostPermission) {
      return { kind: 'cors', cause: 'permission', message: `No access to ${host}`, raw: input.error };
    }
    return { kind: 'network', message: `Can't reach ${host}`, raw: input.error };
  }
  const timeout = findInCauseChain(input.error, (e) => e instanceof Error && /Abort|Timeout|Connection/.test(e.name));
  if (timeout !== undefined) return { kind: 'network', message: `Can't reach ${host}`, raw: input.error };
  return { kind: 'unknown', message: input.error instanceof Error ? input.error.message : String(input.error), raw: input.error };
}

// ---- Helpers ----------------------------------------------------------------------------------

/** `Retry-After` in ms: `retry-after-ms`, else `retry-after` as seconds or an HTTP date. */
export function parseRetryAfter(headers: HeaderSource | undefined, now: () => number = Date.now): number | undefined {
  if (headers === undefined) return undefined;
  const ms = readHeader(headers, 'retry-after-ms');
  if (ms !== undefined && /^\d+(\.\d+)?$/.test(ms.trim())) return Math.round(Number(ms));
  const value = readHeader(headers, 'retry-after')?.trim();
  if (value === undefined || value === '') return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now());
}

/** The server's message: `error.message`, a string `error`, or a top-level `message`. */
export function errorMessage(body: unknown): string | undefined {
  if (typeof body === 'string') return body.trim() === '' ? undefined : body.trim().slice(0, 500);
  if (!isRecord(body)) return undefined;
  const { error } = body;
  if (typeof error === 'string') return error;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  if (typeof body.message === 'string') return body.message;
  return undefined;
}

function withRetryAfter(error: LLMError, input: HttpErrorInput): LLMError {
  const retryAfterMs = parseRetryAfter(input.headers, input.now);
  return retryAfterMs === undefined ? error : { ...error, retryAfterMs };
}

function parseBody(body: unknown): unknown {
  let parsed = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }
  // Gemini's OpenAI-compatible endpoint wraps an error in a one-element array:
  // `[{"error":{"code":404,"message":"…","status":"NOT_FOUND"}}]` (seen live, Phase C).
  return Array.isArray(parsed) && parsed.length === 1 && isRecord(parsed[0]) ? parsed[0] : parsed;
}

function errorTypeAndCode(body: unknown): { type?: string; code?: string } {
  if (!isRecord(body)) return {};
  const inner = isRecord(body.error) ? body.error : body;
  const out: { type?: string; code?: string } = {};
  if (typeof inner.type === 'string') out.type = inner.type;
  if (typeof inner.code === 'string') out.code = inner.code;
  return out;
}

function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (typeof headers.get === 'function') return (headers as { get(n: string): string | null }).get(name) ?? undefined;
  const map = headers as Record<string, string | undefined>;
  return map[name] ?? Object.entries(map).find(([k]) => k.toLowerCase() === name)?.[1];
}

function findInCauseChain(error: unknown, match: (e: unknown) => boolean): unknown {
  let current = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth++) {
    if (match(current)) return current;
    current = isRecord(current) ? current.cause : undefined;
  }
  return undefined;
}

function isLocalhost(base: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(base).hostname);
  } catch {
    return false;
  }
}

function hostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
