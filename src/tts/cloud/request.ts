// One request to a TTS provider, its failures mapped to the error kinds of src/llm/errors.ts so the
// panel and the settings say the same thing for a voice as for a translation (S11 "Error status →
// kind"). A cancel is never an error: it throws the signal's reason.
import { TtsError } from '../errors.ts';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The provider's own message: Gemini wraps its error in an array on Interactions, ElevenLabs uses `detail`. */
export function errorMessage(body: unknown, text: string): string {
  const root = Array.isArray(body) ? body[0] : body;
  if (isRecord(root)) {
    const { error, detail, message } = root;
    if (isRecord(error) && typeof error.message === 'string') return error.message;
    if (typeof error === 'string') return error;
    if (isRecord(detail) && typeof detail.message === 'string') return detail.message;
    if (typeof detail === 'string') return detail;
    if (typeof message === 'string') return message;
  }
  // An HTML error page (Vbee's gateway) says nothing useful.
  return /^\s*</.test(text) ? '' : text.trim().slice(0, 200);
}

/** An allowance used up (not a per-minute limit): a daily cap, credits, a balance, ElevenLabs' `quota_exceeded`. */
const SPENT = /per day|insufficient_quota|quota_exceeded|exceeds your quota|credit|balance/i;

/**
 * The kind of a failed response, from its status and then its message (`detail`: any more of the
 * body, such as ElevenLabs' `detail.status`).
 */
export function classifyStatus(status: number, message: string, detail = ''): TtsError {
  const say = (fallback: string) => message || fallback;
  const text = `${message} ${detail}`;
  if (status === 429) return /per minute/i.test(text) || !SPENT.test(text) ? new TtsError('rate_limit', say('Too many requests'), status) : new TtsError('quota', say('The provider’s allowance is used up'), status);
  if (SPENT.test(text) && (status === 400 || status === 401 || status === 402 || status === 403 || status >= 500)) return new TtsError('quota', say('The provider’s allowance is used up'), status);
  if (status === 401 || status === 403 || (status === 400 && /API_KEY_INVALID|API key not valid/i.test(message))) return new TtsError('auth', say('The key was refused'), status);
  if (status === 402) return new TtsError('quota', say('The provider’s allowance is used up'), status);
  if (status >= 500) return new TtsError('overloaded', say('The provider is unavailable'), status);
  if (status >= 400) return new TtsError('bad_request', say(`The provider refused the request (${status})`), status);
  return new TtsError('unknown', say(`Unexpected answer (${status})`), status);
}

/** fetch, with a failed response or a network failure as a TtsError. */
export async function send(url: string, init: RequestInit, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Response> {
  let res: Response;
  try {
    res = await fetcher(url, { ...init, signal });
  } catch (e) {
    if (signal.aborted) throw signal.reason;
    throw new TtsError('network', e instanceof Error ? e.message : 'The provider could not be reached');
  }
  if (res.ok) return res;
  const text = await res.text().catch(() => '');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  throw classifyStatus(res.status, errorMessage(body, text), /^\s*</.test(text) ? '' : text.slice(0, 500));
}

/** Base64 to bytes. */
export function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
