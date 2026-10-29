// OpenAI-compatible POST /v1/audio/speech. There is no OpenAI key, so:
// - the real round trip runs on OpenRouter's /api/v1/audio/speech (same shape) with its free speech model
//   (the account has no credits; paid models answer 402);
// - api.openai.com is probed with an invalid key (endpoint, auth header, error body);
// - AIBOX (api.ai-box.vn, a "new-api" gateway) is probed with its real key: the route exists, the token has no TTS model.
import { BAD_KEY, PASSAGES, loadEnv, saveAudio, send, writeRecord } from './lib.mjs';

const env = loadEnv();
const INSTRUCTIONS = 'Read clearly and calmly, like a narrator reading an article aloud.';

function speech(base, apiKey, body) {
  return send({ url: `${base}/audio/speech`, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body });
}

const summary = [];

// 1. OpenRouter, real key, free speech model: vi and en, mp3 (default) and wav.
if (env.OPENROUTER_API_KEY) {
  const model = 'fish-audio/s2.1-pro-free:free';
  for (const lang of ['vi', 'en']) {
    const r = await speech('https://openrouter.ai/api/v1', env.OPENROUTER_API_KEY, { model, input: PASSAGES[lang], response_format: 'mp3', instructions: INSTRUCTIONS });
    const info = r.res.ok ? saveAudio(`openrouter-${lang}.mp3`, r.bytes) : `HTTP ${r.res.status} ${JSON.stringify(r.json).slice(0, 200)}`;
    summary.push({ base: 'openrouter', model, lang, status: r.res.status, contentType: r.record.response.contentType, ms: r.ms, info });
    if (lang === 'vi') writeRecord('openai-compatible-openrouter-ok', r.record);
  }
  const wav = await speech('https://openrouter.ai/api/v1', env.OPENROUTER_API_KEY, { model, input: PASSAGES.en, response_format: 'wav' });
  summary.push({ base: 'openrouter', model, lang: 'en (wav)', status: wav.res.status, contentType: wav.record.response.contentType, ms: wav.ms, info: wav.res.ok ? saveAudio('openrouter-en.wav', wav.bytes) : JSON.stringify(wav.json).slice(0, 200) });
  const paid = await speech('https://openrouter.ai/api/v1', env.OPENROUTER_API_KEY, { model: 'google/gemini-3.8-flash-tts', input: PASSAGES.en, voice: 'Kore' });
  const noModel = await speech('https://openrouter.ai/api/v1', env.OPENROUTER_API_KEY, { model: 'openai/gpt-4o-mini-tts', input: PASSAGES.en, voice: 'alloy' });
  const badKey = await speech('https://openrouter.ai/api/v1', BAD_KEY, { model, input: PASSAGES.en });
  writeRecord('openai-compatible-openrouter-error', { noCredits: paid.record, unknownModel: noModel.record, invalidKey: badKey.record });
  for (const [n, r] of Object.entries({ paid, noModel, badKey })) summary.push({ base: 'openrouter', model: n, lang: 'en', status: r.res.status, contentType: r.record.response.contentType, info: JSON.stringify(r.json).slice(0, 160) });
  const models = await send({ url: 'https://openrouter.ai/api/v1/models?output_modalities=speech', method: 'GET', headers: {} });
  console.log('OpenRouter speech models (no auth needed):', (models.json?.data ?? []).map((m) => m.id).join(' '));
}

// 2. api.openai.com with an invalid key: the documented gpt-4o-mini-tts request.
const openai = await speech('https://api.openai.com/v1', BAD_KEY, { model: 'gpt-4o-mini-tts', input: PASSAGES.vi, voice: 'marin', instructions: INSTRUCTIONS, response_format: 'mp3' });
writeRecord('openai-error', openai.record);
summary.push({ base: 'api.openai.com', model: 'gpt-4o-mini-tts', lang: 'vi', status: openai.res.status, contentType: openai.record.response.contentType, info: JSON.stringify(openai.json).slice(0, 200) });

// 3. AIBOX with its real key.
if (env.AIBOX_API_KEY) {
  const models = await send({ url: 'https://api.ai-box.vn/v1/models', method: 'GET', headers: { Authorization: `Bearer ${env.AIBOX_API_KEY}` } });
  console.log('AIBOX models:', (models.json?.data ?? []).map((m) => m.id).join(' '));
  const r = await speech('https://api.ai-box.vn/v1', env.AIBOX_API_KEY, { model: 'gpt-4o-mini-tts', input: PASSAGES.vi, voice: 'alloy' });
  const nf = await send({ url: 'https://api.ai-box.vn/v1/audio/no-such-route', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.AIBOX_API_KEY}` }, body: {} });
  writeRecord('openai-compatible-aibox-error', { modelNotAllowed: r.record, unknownRoute: nf.record });
  summary.push({ base: 'aibox', model: 'gpt-4o-mini-tts', lang: 'vi', status: r.res.status, info: JSON.stringify(r.json).slice(0, 200) });
  summary.push({ base: 'aibox', model: '(unknown route)', lang: '-', status: nf.res.status, info: (JSON.stringify(nf.json) ?? nf.text ?? '').slice(0, 120) });
}
console.table(summary);
