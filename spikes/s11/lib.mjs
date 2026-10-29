// Shared helpers for the S11 probes: read keys from the repo's .env (never printed), send one
// request, save the audio under .cache/s11/, check it decodes (afinfo), and record a small fixture.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const CACHE = path.join(ROOT, '.cache/s11');
export const RECORDED = path.join(import.meta.dirname, 'recorded');

/** The same passages for every provider. */
export const PASSAGES = {
  vi: 'Xin chào. Đây là đoạn thử giọng đọc tiếng Việt cho tiện ích dịch trang. Hôm nay trời đẹp, chúng ta cùng đọc sách nhé.',
  en: "Hello. This is a short test of the English voice for the page translator. The weather is lovely today, so let's read a book.",
};

/** An obviously invalid key, for the keyless providers' error probes. */
export const BAD_KEY = 'sk-s11-invalid-key-0000000000000000';

export function loadEnv() {
  const file = path.join(ROOT, '.env');
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i < 1 || line.trimStart().startsWith('#')) continue;
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const AUDIO_KEEP_BYTES = 300; // of real audio, in fixtures
const SECRET_PARAMS = ['key', 'api_key', 'apikey', 'token', 'access_token'];

/** The URL with key-bearing query parameters replaced by a placeholder. */
export function redactUrl(url) {
  const u = new URL(url);
  for (const p of SECRET_PARAMS) if (u.searchParams.has(p)) u.searchParams.set(p, '<KEY>');
  return u.toString().replace(/%3CKEY%3E/g, '<KEY>');
}

/** Long base64 strings (audio) cut to AUDIO_KEEP_BYTES of real data, recursively. */
export function truncateAudioStrings(value) {
  if (typeof value === 'string') {
    if (value.length > 600 && /^[A-Za-z0-9+/=\r\n]+$/.test(value)) {
      const keep = Math.ceil((AUDIO_KEEP_BYTES * 4) / 3 / 4) * 4;
      return `${value.slice(0, keep)}`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(truncateAudioStrings);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncateAudioStrings(v)]));
  return value;
}

const KEPT_RESPONSE_HEADERS = ['content-type', 'content-length', 'transfer-encoding', 'x-request-id', 'request-id', 'retry-after', 'www-authenticate', 'access-control-allow-origin', 'apim-request-id', 'x-ms-request-id', 'openai-processing-ms', 'history-item-id', 'character-cost'];

/**
 * Send one request and return { res, bytes, json, text, record }. `record` holds header NAMES only
 * for the request, and the body with audio truncated.
 */
export async function send({ url, method = 'POST', headers = {}, body }) {
  const t0 = Date.now();
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const bytes = Buffer.from(await res.arrayBuffer());
  const ms = Date.now() - t0;
  const contentType = res.headers.get('content-type') ?? '';
  let json;
  let text;
  if (/json/.test(contentType) || /^[\s]*[{[]/.test(bytes.subarray(0, 4).toString('utf8'))) {
    try { json = JSON.parse(bytes.toString('utf8')); } catch { /* not JSON */ }
  }
  if (json === undefined && /^(text\/|application\/(xml|ssml))/.test(contentType)) text = bytes.toString('utf8');
  const responseBody = json !== undefined
    ? { json: truncateAudioStrings(json) }
    : text !== undefined
      ? { text: text.slice(0, 4000) }
      : { base64Head: bytes.subarray(0, AUDIO_KEEP_BYTES).toString('base64'), totalBytes: bytes.length, note: `first ${AUDIO_KEEP_BYTES} bytes of the real audio` };
  const record = {
    recordedAt: new Date().toISOString(),
    request: {
      url: redactUrl(url),
      method,
      headerNames: Object.keys(headers),
      contentType: headers['Content-Type'] ?? headers['content-type'],
      body: body === undefined ? undefined : typeof body === 'string' ? body : body,
    },
    response: {
      status: res.status,
      contentType,
      headers: Object.fromEntries(KEPT_RESPONSE_HEADERS.filter((h) => res.headers.has(h)).map((h) => [h, res.headers.get(h)])),
      ms,
      body: responseBody,
    },
  };
  return { res, bytes, json, text, record, ms };
}

/** Write recorded/<name>.json. Refuses if a key value from .env appears in it. */
export function writeRecord(name, data) {
  const out = JSON.stringify(data, null, 2);
  for (const v of Object.values(loadEnv())) if (v && v.length > 8 && out.includes(v)) throw new Error(`refusing to write ${name}: a key value would leak`);
  fs.mkdirSync(RECORDED, { recursive: true });
  fs.writeFileSync(path.join(RECORDED, `${name}.json`), out + '\n');
  console.log(`recorded ${path.relative(ROOT, path.join(RECORDED, `${name}.json`))}`);
}

/** Wrap headerless PCM s16le mono in a WAV header. */
export function pcmToWav(pcm, sampleRate = 24000, channels = 1) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Save audio under .cache/s11/ and return afinfo's summary line (format, rate, duration). */
export function saveAudio(name, buf) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, name);
  fs.writeFileSync(file, buf);
  let info = '';
  try {
    const out = execFileSync('afinfo', [file], { encoding: 'utf8' });
    const fmt = /Data format:\s*(.*)/.exec(out)?.[1]?.trim();
    const dur = /estimated duration:\s*([\d.]+)/.exec(out)?.[1];
    info = `${fmt} · ${dur}s`;
  } catch (e) {
    info = `afinfo failed: ${String(e.message).split('\n')[0]}`;
  }
  console.log(`saved .cache/s11/${name} (${buf.length} bytes) → ${info}`);
  return info;
}
