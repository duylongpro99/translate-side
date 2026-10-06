import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkBaseUrl,
  checkKey,
  classifyFetchError,
  classifyHttpError,
  classifyStreamError,
  errorMessage,
  isQuirkFlipCandidate,
  normalizeKey,
  parseRetryAfter,
} from './errors.ts';

const CLOUD = 'https://ollama.com/v1';
const http = (status: number, body: unknown, extra: Partial<Parameters<typeof classifyHttpError>[0]> = {}) =>
  classifyHttpError({ status, body, auth: 'bearer', baseUrl: CLOUD, ...extra });

// One case per row of the S4 classifier table (docs/decisions/S4-ollama-error-classifier.md),
// with bodies copied from spikes/s4/results/*.json.
describe('404 model regex (Phase A carry-over c2)', () => {
  it('matches only a message that names the model right after the word "model"', () => {
    for (const m of ['model "no-such-model:1b" not found', "model 'x:1b' not found", 'The model `gpt-5-nano` does not exist or you do not have access to it.', 'model: claude-nope', 'models/gemini-nope is not found for API version v1beta, or is not supported for generateContent.']) {
      expect(http(404, { error: { message: m } }).kind, m).toBe('model_not_found');
    }
    for (const m of ['path "/model/v1/x" not found', 'path "/api/v1/chat/completions" not found', 'Not Found', 'The model configuration was not found']) {
      expect(http(404, { error: { message: m } }), m).toMatchObject({ kind: 'bad_request', message: `Wrong base URL (${m})` });
    }
  });

  it('Gemini OpenAI-compatible 404 as seen live: a one-element array body and a retired model', () => {
    const message = 'This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-3.5-flash-lite for the latest features and improvements.';
    const body = [{ error: { code: 404, message, status: 'NOT_FOUND' } }];
    expect(http(404, body)).toMatchObject({ kind: 'model_not_found', status: 404 });
    expect(http(404, JSON.stringify(body))).toMatchObject({ kind: 'model_not_found' });
    expect(http(404, [{ error: { message: 'Not Found' } }])).toMatchObject({ kind: 'bad_request', message: 'Wrong base URL (Not Found)' });
    // Other array bodies are not unwrapped.
    expect(http(404, [{ error: { message } }, { error: { message } }])).toMatchObject({ kind: 'bad_request', message: 'Wrong base URL (path not found)' });
  });
});

describe('S4 classifier table', () => {
  it('row 0a: invalid base URL → bad_request', () => {
    for (const base of ['https://ollama .com/v1', 'ollama.com/v1', 'ftp://ollama.com', 'file:///etc', '']) {
      expect(checkBaseUrl(base)?.kind, base).toBe('bad_request');
    }
    expect(checkBaseUrl(CLOUD)).toBeNull();
    expect(checkBaseUrl('http://localhost:11434/v1')).toBeNull();
  });

  it('row 0b: key that cannot go in a header → auth; trimmed first', () => {
    expect(checkKey('sk-ab\u2014cd')?.kind).toBe('auth');
    expect(checkKey('sk-ab\ncd')?.kind).toBe('auth');
    expect(checkKey('sk-abé')).toBeNull(); // Latin-1 is header-safe (it reached the server: 401)
    expect(normalizeKey('  sk-abc\n')).toBe('sk-abc');
    expect(checkKey(normalizeKey('\tsk-abc\r\n'))).toBeNull();
  });

  it('row 1: fetch TypeError without the host permission → cors/permission', () => {
    const e = classifyFetchError({ error: new TypeError('Failed to fetch'), aborted: false, hasHostPermission: false, baseUrl: CLOUD });
    expect(e).toMatchObject({ kind: 'cors', cause: 'permission', message: 'No access to ollama.com' });
  });

  it('row 2: fetch TypeError with the permission held → network', () => {
    const e = classifyFetchError({ error: new TypeError('Failed to fetch'), aborted: false, hasHostPermission: true, baseUrl: CLOUD });
    expect(e).toMatchObject({ kind: 'network', message: "Can't reach ollama.com" });
  });

  it('row 3: 401 → auth', () => {
    expect(http(401, '{"error":{"message":"Unauthorized","type":"api_error","param":null,"code":null}}').kind).toBe('auth');
    expect(http(401, { error: 'Unauthorized' }).kind).toBe('auth');
  });

  it('row 4: 402 → quota with the server message', () => {
    const body = '{"error":"This model is not in the Free plan. Pro is $20/month for $60 of usage, with no 5-hour or weekly caps: https://ollama.com/upgrade (ref: x)"}\n';
    expect(http(402, body)).toMatchObject({ kind: 'quota', status: 402, message: expect.stringContaining('https://ollama.com/upgrade') });
  });

  it('row 5: 404 whose message names a model → model_not_found (content-type is ignored)', () => {
    expect(http(404, '{"error":{"message":"model \\"no-such-model:1b\\" not found","type":"not_found_error","param":null,"code":null}}').kind).toBe('model_not_found');
    expect(http(404, '{"error": "model \'no-such-model:1b\' not found"}').kind).toBe('model_not_found');
    expect(http(404, { type: 'error', error: { type: 'not_found_error', message: 'model: claude-x' } }).kind).toBe('model_not_found');
    // OpenAI's unknown-model 404 (written from the API docs, not a recorded response).
    const openai = http(404, '{"error":{"message":"The model `gpt-9` does not exist or you do not have access to it.","type":"invalid_request_error","param":null,"code":"model_not_found"}}');
    expect(openai).toMatchObject({ kind: 'model_not_found', message: 'The model `gpt-9` does not exist or you do not have access to it.' });
    expect(http(404, { error: { message: 'gone', code: 'model_not_found' } }).kind).toBe('model_not_found');
    expect(http(404, { error: { message: 'The model `gpt-9` does not exist' } }).kind).toBe('model_not_found');
  });

  it('row 6: 404 otherwise → bad_request "wrong base URL", not a quirk flip', () => {
    const e = http(404, '{"error":"path \\"/api/v1/chat/completions\\" not found"}');
    expect(e.kind).toBe('bad_request');
    expect(e.message).toMatch(/^Wrong base URL/);
    expect(isQuirkFlipCandidate(e)).toBe(false);
    // M1-D7 (deviation from S4 row 5): Anthropic's wrong-path 404 has `type: not_found_error`
    // but names no model, so it is the wrong-base-URL case.
    const anthropicPath = http(404, { type: 'error', error: { type: 'not_found_error', message: 'Not Found' } });
    expect(anthropicPath).toMatchObject({ kind: 'bad_request', message: 'Wrong base URL (Not Found)' });
  });

  it('row 7: 429 → rate_limit with Retry-After in ms', () => {
    const e = http(429, '{"error":"too many concurrent requests"}', { headers: { 'retry-after': '14' } });
    expect(e).toMatchObject({ kind: 'rate_limit', retryAfterMs: 14_000 });
  });

  it('row 8: 400 → bad_request, quirk flip candidate', () => {
    const e = http(400, '{"error":{"message":"[] is too short - \'messages\' (ref: x)","type":"invalid_request_error"}}');
    expect(e.kind).toBe('bad_request');
    expect(isQuirkFlipCandidate(e)).toBe(true);
  });

  it('row 9: 403 + auth none + localhost → cors/origin', () => {
    for (const baseUrl of ['http://localhost:11434/v1', 'http://127.0.0.1:11434', 'http://[::1]:11434']) {
      expect(http(403, '', { auth: 'none', baseUrl })).toMatchObject({ kind: 'cors', cause: 'origin' });
    }
  });

  it('row 10: 403 otherwise → auth', () => {
    expect(http(403, '', { auth: 'bearer', baseUrl: 'http://localhost:11434/v1' }).kind).toBe('auth');
    expect(http(403, '', { auth: 'none', baseUrl: 'https://gateway.example.com' }).kind).toBe('auth');
  });
});

describe('§4.3.5 rows outside the S4 table', () => {
  it('5xx and 529 → overloaded, keeping Retry-After', () => {
    expect(http(500, 'oops').kind).toBe('overloaded');
    expect(http(503, '', { headers: { 'Retry-After': '2' } })).toMatchObject({ kind: 'overloaded', retryAfterMs: 2000 });
    expect(http(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })).toMatchObject({ kind: 'overloaded', message: 'Overloaded' });
  });

  it('context length → context_length, never a quirk flip', () => {
    const anthropic = http(400, { type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long: 210000 tokens > 200000 maximum' } });
    const openai = http(400, { error: { message: "This model's maximum context length is 8192 tokens.", code: 'context_length_exceeded' } });
    for (const e of [anthropic, openai, http(413, 'too large')]) {
      expect(e.kind).toBe('context_length');
      expect(isQuirkFlipCandidate(e)).toBe(false);
    }
  });

  it('other "no allowance" forms → quota (S4 deviation e)', () => {
    expect(http(429, { error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' } }).kind).toBe('quota');
    expect(http(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }).kind).toBe('quota');
  });

  it('mid-stream error events are classified by their type', () => {
    expect(classifyStreamError({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })).toMatchObject({ kind: 'overloaded', message: 'Overloaded' });
    expect(classifyStreamError('{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}').kind).toBe('rate_limit');
    expect(classifyStreamError({ nope: true }).kind).toBe('unknown');
  });

  it('a cancel is never an error, and never network', () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    expect(classifyFetchError({ error: abort, aborted: true, hasHostPermission: true, baseUrl: CLOUD })).toBeNull();
    expect(classifyFetchError({ error: new TypeError('Failed to fetch'), aborted: true, hasHostPermission: false, baseUrl: CLOUD })).toBeNull();
  });

  it('SDK-wrapped TypeError (openai APIConnectionError) is unwrapped through `cause`', () => {
    const wrapped = Object.assign(new Error('Connection error.'), { name: 'APIConnectionError', cause: new TypeError('Failed to fetch') });
    expect(classifyFetchError({ error: wrapped, aborted: false, hasHostPermission: false, baseUrl: CLOUD })).toMatchObject({ kind: 'cors', cause: 'permission' });
    const header = new TypeError("Failed to execute 'fetch' on 'WorkerGlobalScope': Failed to read the 'headers' property from 'RequestInit': String contains non ISO-8859-1 code point.");
    expect(classifyFetchError({ error: header, aborted: false, hasHostPermission: false, baseUrl: CLOUD })?.kind).toBe('auth');
  });

  it('Retry-After forms', () => {
    expect(parseRetryAfter({ 'retry-after-ms': '1500', 'retry-after': '9' })).toBe(1500);
    expect(parseRetryAfter(new Headers({ 'Retry-After': '3' }))).toBe(3000);
    expect(parseRetryAfter({ 'retry-after': 'Thu, 01 Jan 2026 00:00:10 GMT' }, () => Date.parse('Thu, 01 Jan 2026 00:00:00 GMT'))).toBe(10_000);
    expect(parseRetryAfter({ 'retry-after': 'soon' })).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });

  it('message extraction: object or string `error`, top-level message, raw text', () => {
    expect(errorMessage({ error: { message: 'a' } })).toBe('a');
    expect(errorMessage({ error: 'b' })).toBe('b');
    expect(errorMessage({ message: 'c' })).toBe('c');
    expect(errorMessage('  <html>bad gateway</html> ')).toBe('<html>bad gateway</html>');
    expect(errorMessage({})).toBeUndefined();
  });
});

// Every non-200 response and every thrown error recorded by the S4 spike, classified.
describe('S4 recorded corpus (spikes/s4/results)', () => {
  interface Row { name: string; status?: number; headers?: Record<string, string>; body?: string; errorName?: string; errorMessage?: string }
  const dir = path.join(import.meta.dirname, '../../spikes/s4/results');
  const load = (file: string): Row[] => (JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as { rows: Row[] }).rows;

  it('HTTP errors (clean run and run under load)', () => {
    const rows = [...load('granted.json'), ...load('granted-under-load.json')].filter((r) => r.status !== undefined && r.status !== 200);
    expect(rows.length).toBeGreaterThan(10);
    const seen = new Set<string>();
    for (const row of rows) {
      const e = http(row.status ?? 0, row.body, { headers: row.headers ?? {} });
      seen.add(`${row.status}:${e.kind}`);
      const expected =
        row.status === 401 ? 'auth'
        : row.status === 400 ? 'bad_request'
        : row.status === 429 ? 'rate_limit'
        : row.status === 404 ? (/path/.test(row.body ?? '') ? 'bad_request' : 'model_not_found')
        : 'unexpected';
      expect(e.kind, `${row.name} (${row.status})`).toBe(expected);
      if (row.status === 429) expect(e.retryAfterMs).toBe(Number(row.headers?.['retry-after']) * 1000);
    }
    expect([...seen].sort()).toEqual(['400:bad_request', '401:auth', '404:bad_request', '404:model_not_found', '429:rate_limit']);
  });

  it('402 plan limit, 9 of 9', () => {
    const rows = load('plan-402.json');
    expect(rows).toHaveLength(9);
    for (const row of rows) expect(http(row.status ?? 0, row.body).kind).toBe('quota');
  });

  it('thrown TypeErrors: no permission → cors; held → network; header chars → auth', () => {
    for (const [file, held] of [['typeerrors-none.json', false], ['typeerrors-granted.json', true], ['none.json', false]] as const) {
      for (const row of load(file).filter((r) => r.errorName === 'TypeError')) {
        const e = classifyFetchError({ error: new TypeError(row.errorMessage), aborted: false, hasHostPermission: held, baseUrl: CLOUD });
        const expected = /ISO-8859-1/.test(row.errorMessage ?? '') ? 'auth' : held ? 'network' : 'cors';
        expect(e?.kind, `${file}: ${row.name}`).toBe(expected);
      }
    }
  });
});
