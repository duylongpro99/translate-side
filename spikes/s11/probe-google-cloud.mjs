// Google Cloud Text-to-Speech with an API key (no Cloud TTS key): the documented v1 text:synthesize
// request with an invalid key in the x-goog-api-key header and in ?key=, and voices:list.
// GOOGLE_CLOUD_TTS_API_KEY from .env, if set, synthesizes for real.
// It also tries the Gemini API key. Ours is a new AI Studio key (prefix `AQ.`, bound to a principal), and
// Cloud TTS answers 401 CREDENTIALS_MISSING "API keys are not supported by this API" for it; Translation v2,
// which does take standard keys, answers the same, so this says nothing about a standard `AIza…` key.
import { BAD_KEY, PASSAGES, loadEnv, saveAudio, send, writeRecord } from './lib.mjs';

const env = loadEnv();
const key = env.GOOGLE_CLOUD_TTS_API_KEY || BAD_KEY;
const real = Boolean(env.GOOGLE_CLOUD_TTS_API_KEY);
const BASE = 'https://texttospeech.googleapis.com/v1';
const VOICES = { vi: ['vi-VN', 'vi-VN-Chirp3-HD-Kore'], en: ['en-US', 'en-US-Chirp3-HD-Kore'] };

function synth(lang, apiKey, viaQuery = false) {
  return send({
    url: `${BASE}/text:synthesize${viaQuery ? `?key=${encodeURIComponent(apiKey)}` : ''}`,
    headers: { 'Content-Type': 'application/json', ...(viaQuery ? {} : { 'x-goog-api-key': apiKey }) },
    body: { input: { text: PASSAGES[lang] }, voice: { languageCode: VOICES[lang][0], name: VOICES[lang][1] }, audioConfig: { audioEncoding: 'MP3' } },
  });
}

const rows = [];
const records = {};
for (const lang of ['vi', 'en']) {
  const r = await synth(lang, key);
  records[`synth-${lang}`] = r.record;
  rows.push({ call: `synthesize ${lang} (header)`, status: r.res.status, info: r.res.ok ? saveAudio(`google-cloud-${lang}.mp3`, Buffer.from(r.json.audioContent, 'base64')) : JSON.stringify(r.json).slice(0, 200) });
  if (!real) break;
}
const q = await synth('vi', key, true);
records.synthQueryKey = q.record;
rows.push({ call: 'synthesize vi (?key=)', status: q.res.status, info: JSON.stringify(q.json).slice(0, 200) });
const voices = await send({ url: `${BASE}/voices?languageCode=vi-VN`, method: 'GET', headers: { 'x-goog-api-key': key } });
records.voices = voices.record;
rows.push({ call: 'voices?languageCode=vi-VN', status: voices.res.status, info: voices.res.ok ? voices.json.voices.map((v) => v.name).join(' ') : JSON.stringify(voices.json).slice(0, 200) });
if (env.GEMINI_API_KEY) {
  const g = await send({ url: `${BASE}/voices?languageCode=vi-VN`, method: 'GET', headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
  records.geminiKeyOnCloudTts = g.record;
  rows.push({ call: 'voices with the Gemini key', status: g.res.status, info: g.res.ok ? `${g.json.voices.length} voices` : JSON.stringify(g.json?.error?.details?.[0]?.reason ?? g.json).slice(0, 200) });
}
const empty = await send({ url: `${BASE}/text:synthesize`, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: { input: { text: 'x'.repeat(5001) }, voice: { languageCode: 'en-US' }, audioConfig: { audioEncoding: 'MP3' } } });
records.over5000Bytes = empty.record;
writeRecord(real ? 'google-cloud-ok' : 'google-cloud-error', records);
console.table(rows);
