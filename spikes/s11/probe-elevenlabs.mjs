// ElevenLabs (no key): the documented request with an invalid key, plus the public models and voices
// routes. With ELEVENLABS_API_KEY set it synthesizes for real (vi and en, eleven_flash_v2_5 and eleven_v4).
import { BAD_KEY, PASSAGES, loadEnv, saveAudio, send, writeRecord } from './lib.mjs';

const env = loadEnv();
const key = env.ELEVENLABS_API_KEY || BAD_KEY;
const real = Boolean(env.ELEVENLABS_API_KEY);
const BASE = 'https://api.elevenlabs.io';
const VOICE = 'JBFqnCBsd6RMkjVDRZzb'; // "George", a default premade voice used in the docs' examples

function synth(lang, model) {
  return send({
    url: `${BASE}/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
    headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
    body: { text: PASSAGES[lang], model_id: model, language_code: lang },
  });
}

const rows = [];
const records = {};
for (const model of ['eleven_flash_v2_5', 'eleven_v4']) {
  for (const lang of ['vi', 'en']) {
    const r = await synth(lang, model);
    records[`${model}-${lang}`] = r.record;
    rows.push({ call: `${model} ${lang}`, status: r.res.status, contentType: r.record.response.contentType, info: r.res.ok ? saveAudio(`elevenlabs-${model}-${lang}.mp3`, r.bytes) : JSON.stringify(r.json ?? r.text).slice(0, 180) });
    if (!real) break; // one invalid-key call per model is enough
  }
}
const noKey = await send({ url: `${BASE}/v1/text-to-speech/${VOICE}`, headers: { 'Content-Type': 'application/json' }, body: { text: 'hi', model_id: 'eleven_flash_v2_5' } });
rows.push({ call: 'no key header', status: noKey.res.status, info: JSON.stringify(noKey.json ?? noKey.text).slice(0, 180) });
const models = await send({ url: `${BASE}/v1/models`, method: 'GET', headers: { 'xi-api-key': key } });
rows.push({ call: 'GET /v1/models', status: models.res.status, info: Array.isArray(models.json) ? models.json.map((m) => `${m.model_id}${m.languages?.some((l) => l.language_id === 'vi') ? '(vi)' : ''}`).join(' ') : JSON.stringify(models.json).slice(0, 160) });
const voices = await send({ url: `${BASE}/v2/voices?page_size=10`, method: 'GET', headers: { 'xi-api-key': key } });
rows.push({ call: 'GET /v2/voices', status: voices.res.status, info: JSON.stringify(voices.json).slice(0, 160) });
const shared = await send({ url: `${BASE}/v1/shared-voices?language=vi&page_size=5`, method: 'GET', headers: { 'xi-api-key': key } });
rows.push({ call: 'GET /v1/shared-voices?language=vi', status: shared.res.status, info: JSON.stringify(shared.json).slice(0, 160) });

writeRecord(real ? 'elevenlabs-ok' : 'elevenlabs-error', { invalidKey: Object.values(records)[0], noKeyHeader: noKey.record, models: models.record, voices: voices.record, sharedVoicesVi: shared.record });
console.table(rows);
