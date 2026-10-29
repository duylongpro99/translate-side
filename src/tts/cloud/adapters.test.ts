// The cloud adapters against the requests and answers recorded by Spike S11 (spikes/s11/recorded/):
// each sends the request the provider took, reads its audio, and maps its errors to the same kinds
// as a translation's.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanTtsConnection, type TtsConnection } from '../settings';
import { isTtsError } from '../errors';
import { azure } from './azure';
import { elevenlabs } from './elevenlabs';
import { fpt } from './fpt';
import { gcloud } from './gcloud';
import { gemini } from './gemini';
import { classifyStatus, errorMessage } from './request';
import { openai } from './openai-speech';
import type { CloudAdapter, CloudLang } from './adapter';
import { vbee } from './vbee';

interface Recorded {
  request: { url: string; method: string; headerNames: string[]; body: unknown };
  response: { status: number; contentType?: string; body: { json?: unknown; text?: string; base64Head?: string } };
}

const recorded = (file: string, path: string[] = []): Recorded => {
  let v: unknown = JSON.parse(readFileSync(`spikes/s11/recorded/${file}.json`, 'utf8'));
  for (const p of path) v = (v as Record<string, unknown>)[p];
  return v as Recorded;
};

/** A fetch answering with the recorded response, keeping what was sent. */
function replay(r: Recorded) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    const { body, status, contentType } = r.response;
    const payload = body.json !== undefined ? JSON.stringify(body.json) : body.text !== undefined ? body.text : Uint8Array.from(atob(body.base64Head ?? ''), (c) => c.charCodeAt(0));
    return new Response(status === 204 ? null : payload, { status, headers: contentType ? { 'content-type': contentType } : {} });
  }) as unknown as typeof fetch;
  return { sent, fetcher };
}

const conn = (raw: Record<string, unknown>) => cleanTtsConnection(raw) as TtsConnection;
const bodyOf = (init: RequestInit) => {
  const b = init.body as string;
  try {
    return JSON.parse(b) as unknown;
  } catch {
    return b;
  }
};

async function run(adapter: CloudAdapter, r: Recorded, c: TtsConnection, args: { text: string; voice: string; lang: CloudLang; note?: string }) {
  const { sent, fetcher } = replay(r);
  const out = await adapter.synthesize({ ...args, key: 'k', conn: c, signal: new AbortController().signal, fetcher }).then(
    (audio) => ({ audio }),
    (error: unknown) => ({ error }),
  );
  return { ...out, sent: sent[0] };
}

const textOf = (r: Recorded, pick: (b: Record<string, unknown>) => unknown) => pick(r.request.body as Record<string, unknown>) as string;

describe('Gemini', () => {
  const c = conn({ presetId: 'gemini' });

  it('sends the recorded Interactions request, the note as the style, and reads the WAV', async () => {
    const r = recorded('gemini-ok');
    const content = (r.request.body as { input: { content: { text: string; annotations: { style: string }[] }[] }[] }).input[0]?.content[0];
    const out = await run(gemini, r, c, { text: content?.text ?? '', voice: 'Kore', lang: 'vi', note: content?.annotations[0]?.style ?? '' });
    expect(out.sent?.url).toBe(r.request.url);
    expect(Object.keys(out.sent?.init.headers ?? {}).sort()).toEqual([...r.request.headerNames].sort());
    expect(bodyOf(out.sent?.init ?? {})).toEqual(r.request.body);
    expect('audio' in out && 'blob' in out.audio && out.audio.blob.type).toBe('audio/wav');
  });

  it('leaves out the annotation without a note', async () => {
    const out = await run(gemini, recorded('gemini-ok'), c, { text: 'Hi.', voice: 'Kore', lang: 'en' });
    expect(JSON.stringify(bodyOf(out.sent?.init ?? {}))).not.toContain('annotations');
  });

  it('maps an invalid key (an array body) to auth, and the free tier’s daily limit to quota', async () => {
    const auth = await run(gemini, recorded('gemini-error', ['invalidKey']), c, { text: 'x', voice: 'Kore', lang: 'en' });
    expect('error' in auth && isTtsError(auth.error) && auth.error.kind).toBe('auth');
    const quota = await run(gemini, recorded('gemini-rate-limit-error'), c, { text: 'x', voice: 'Kore', lang: 'en' });
    expect('error' in quota && isTtsError(quota.error) && [quota.error.kind, quota.error.message]).toEqual(['quota', expect.stringContaining('10 requests per day')]);
  });
});

describe('OpenAI-compatible', () => {
  it('sends the recorded request to the base URL, with instructions only for gpt-4o-mini-tts', async () => {
    const r = recorded('openai-compatible-openrouter-ok');
    const req = r.request.body as { model: string; input: string; instructions: string };
    const openRouter = conn({ presetId: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: req.model });
    const out = await run(openai, r, openRouter, { text: req.input, voice: 'alloy', lang: 'vi', note: req.instructions });
    expect(out.sent?.url).toBe(r.request.url);
    expect(bodyOf(out.sent?.init ?? {})).toEqual({ model: req.model, input: req.input, voice: 'alloy', response_format: 'mp3' });
    expect('audio' in out && 'blob' in out.audio && out.audio.blob.type).toBe('audio/mpeg');
    const mini = await run(openai, r, conn({ presetId: 'openai' }), { text: 'x', voice: 'marin', lang: 'en', note: 'calm' });
    expect(bodyOf(mini.sent?.init ?? {})).toMatchObject({ model: 'gpt-4o-mini-tts', instructions: 'calm' });
  });

  it.each([
    ['openai-error', [], 'auth'],
    ['openai-compatible-openrouter-error', ['noCredits'], 'quota'],
    ['openai-compatible-openrouter-error', ['invalidKey'], 'auth'],
    ['openai-compatible-openrouter-error', ['unknownModel'], 'bad_request'],
    ['openai-compatible-aibox-error', ['modelNotAllowed'], 'auth'],
    ['openai-compatible-aibox-error', ['unknownRoute'], 'bad_request'],
  ] as const)('maps %s %j to %s', async (file, path, kind) => {
    const out = await run(openai, recorded(file, [...path]), conn({ presetId: 'openai' }), { text: 'x', voice: 'alloy', lang: 'en' });
    expect('error' in out && isTtsError(out.error) && out.error.kind).toBe(kind);
  });
});

describe('Azure', () => {
  it('sends escaped SSML to the region’s endpoint with the key header; an empty 401 is auth', async () => {
    const r = recorded('azure-error', ['keyHeader']);
    const out = await run(azure, r, conn({ presetId: 'azure', region: 'eastus' }), { text: 'Xin chào & <tạm biệt>', voice: 'vi-VN-HoaiMyNeural', lang: 'vi' });
    expect(out.sent?.url).toBe(r.request.url);
    expect(Object.keys(out.sent?.init.headers ?? {}).sort()).toEqual([...r.request.headerNames].filter((h) => h !== 'User-Agent').sort());
    expect(out.sent?.init.body).toBe("<speak version='1.0' xml:lang='vi-VN'><voice name='vi-VN-HoaiMyNeural'>Xin chào &amp; &lt;tạm biệt&gt;</voice></speak>");
    expect('error' in out && isTtsError(out.error) && out.error.kind).toBe('auth');
  });
});

describe('ElevenLabs', () => {
  it('sends the recorded request; an invalid key is auth', async () => {
    const r = recorded('elevenlabs-error', ['invalidKey']);
    const out = await run(elevenlabs, r, conn({ presetId: 'elevenlabs' }), { text: textOf(r, (b) => b.text), voice: 'JBFqnCBsd6RMkjVDRZzb', lang: 'vi' });
    expect(out.sent?.url).toBe(r.request.url);
    expect(bodyOf(out.sent?.init ?? {})).toEqual(r.request.body);
    expect('error' in out && isTtsError(out.error) && out.error.kind).toBe('auth');
  });
});

describe('Google Cloud', () => {
  // The key is checked first: the recorded over-5,000-byte request with a bad key is refused for the key.
  it('sends the recorded request; an invalid key is auth, whatever else is wrong', async () => {
    const r = recorded('google-cloud-error', ['synth-vi']);
    const out = await run(gcloud, r, conn({ presetId: 'gcloud' }), { text: textOf(r, (b) => (b.input as { text: string }).text), voice: 'vi-VN-Chirp3-HD-Kore', lang: 'vi' });
    expect(out.sent?.url).toBe(r.request.url);
    expect(bodyOf(out.sent?.init ?? {})).toEqual(r.request.body);
    expect('error' in out && isTtsError(out.error) && out.error.kind).toBe('auth');
    const long = await run(gcloud, recorded('google-cloud-error', ['over5000Bytes']), conn({ presetId: 'gcloud' }), { text: 'x', voice: 'vi-VN-Chirp3-HD-Kore', lang: 'vi' });
    expect('error' in long && isTtsError(long.error) && long.error.kind).toBe('auth');
  });
});

describe('Vbee', () => {
  it('sends the token with the app id; the gateway’s HTML 401 is auth with no HTML in the message', async () => {
    const r = recorded('vbee-error', ['realtime']);
    const out = await run(vbee, r, conn({ presetId: 'vbee', appId: 'app-1' }), { text: textOf(r, (b) => b.text), voice: 'hn_female_ngochuyen_full_48k-fhg', lang: 'vi' });
    expect(out.sent?.url).toBe(r.request.url);
    expect((out.sent?.init.headers as Record<string, string>)['App-Id']).toBe('app-1');
    expect(bodyOf(out.sent?.init ?? {})).toEqual(r.request.body);
    expect('error' in out && isTtsError(out.error) && [out.error.kind, out.error.message]).toEqual(['auth', 'The key was refused']);
  });

  it('offers no English voice', () => {
    expect(vbee.voices('en')).toEqual([]);
  });
});

describe('FPT.AI', () => {
  it('sends the raw text with its options in headers; an invalid key is auth', async () => {
    const r = recorded('fpt-error', ['synthesize']);
    const out = await run(fpt, r, conn({ presetId: 'fpt' }), { text: r.request.body as string, voice: 'banmai', lang: 'vi' });
    expect(out.sent?.url).toBe(r.request.url);
    expect(Object.keys(out.sent?.init.headers ?? {}).sort()).toEqual([...r.request.headerNames].sort());
    expect(out.sent?.init.body).toBe(r.request.body);
    expect('error' in out && isTtsError(out.error) && out.error.kind).toBe('auth');
  });

  it('answers with the link to poll', async () => {
    const ok: Recorded = { request: { url: '', method: 'POST', headerNames: [], body: '' }, response: { status: 200, contentType: 'application/json', body: { json: { async: 'https://file.example/a.mp3', error: 0 } } } };
    const out = await run(fpt, ok, conn({ presetId: 'fpt' }), { text: 'xin chào', voice: 'banmai', lang: 'vi' });
    expect('audio' in out && out.audio).toEqual({ url: 'https://file.example/a.mp3' });
  });
});

describe('error mapping', () => {
  it('reads each provider’s message shape', () => {
    expect(errorMessage([{ error: { message: 'arr' } }], '')).toBe('arr');
    expect(errorMessage({ detail: { message: 'el' } }, '')).toBe('el');
    expect(errorMessage({ message: 'fpt' }, '')).toBe('fpt');
    expect(errorMessage(undefined, '<html>401</html>')).toBe('');
    expect(errorMessage(undefined, 'plain')).toBe('plain');
  });

  it.each([
    [429, 'Rate limit exceeded (limit: 10 requests per day on Free Tier)', 'quota'],
    [429, 'slow down', 'rate_limit'],
    [429, 'Quota exceeded for quota metric requests per minute', 'rate_limit'],
    [429, 'RESOURCE_EXHAUSTED: quota', 'rate_limit'],
    [500, 'TTS_SPEND_CREDITS_FAILED: not enough credit', 'quota'],
    [503, '', 'overloaded'],
    [422, '', 'bad_request'],
    [302, '', 'unknown'],
  ])('%i %s → %s', (status, message, kind) => {
    expect(classifyStatus(status, message).kind).toBe(kind);
  });

  it('tells ElevenLabs’ out-of-credit 401 from a refused key by its detail status', () => {
    expect(classifyStatus(401, 'This request exceeds your quota of 10000.', '{"detail":{"status":"quota_exceeded"}}').kind).toBe('quota');
    expect(classifyStatus(401, 'Invalid API key', '{"detail":{"status":"invalid_api_key"}}').kind).toBe('auth');
  });

  it('says to check the region when Azure’s host does not resolve', async () => {
    const fetcher = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const out = await azure.synthesize({ text: 'x', voice: 'vi-VN-HoaiMyNeural', lang: 'vi', key: 'k', conn: conn({ presetId: 'azure', region: 'nowhere' }), signal: new AbortController().signal, fetcher }).catch((e: unknown) => e);
    expect(isTtsError(out) && [out.kind, out.message]).toEqual(['bad_request', expect.stringContaining('check the region')]);
  });
});
