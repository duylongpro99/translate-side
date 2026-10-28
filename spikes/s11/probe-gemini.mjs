// Gemini TTS (real key: GEMINI_API_KEY). The free tier allows 10 requests a day per TTS model: this probe
// makes 5 on each 3.8 model, the extension probe 3 more on Flash Lite; runs past 10 a day get 429 (gemini-rate-limit-error).
// Synthesizes the vi and en passages with both 3.8 TTS models
// through the Interactions endpoint and through generateContent, saves the WAVs, lists the voices
// and records an invalid-key error.
import { BAD_KEY, PASSAGES, loadEnv, pcmToWav, saveAudio, send, writeRecord } from './lib.mjs';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const key = loadEnv().GEMINI_API_KEY;
if (!key) throw new Error('GEMINI_API_KEY is not set in .env');
const STYLE = 'Read clearly and calmly, like a narrator reading an article aloud.';

/** Interactions: the endpoint the current speech-generation guide documents. */
function interactions(model, text, voice, apiKey = key) {
  return send({
    url: `${BASE}/interactions`,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: {
      model,
      input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: STYLE }] }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice }] },
    },
  });
}

/** generateContent with responseModalities AUDIO: the older shape, still served. */
function generateContent(model, text, voice) {
  return send({
    url: `${BASE}/models/${model}:generateContent`,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: {
      contents: [{ parts: [{ text: `${STYLE}\n\n${text}` }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    },
  });
}

function audioFromInteraction(json) {
  const parts = (json.steps ?? []).filter((s) => s.type === 'model_output').flatMap((s) => s.content ?? []).filter((c) => c.type === 'audio');
  const last = parts.at(-1);
  return last && { mime: last.mime_type, data: Buffer.from(last.data, 'base64') };
}

function audioFromGenerateContent(json) {
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  return part && { mime: part.inlineData.mimeType, data: Buffer.from(part.inlineData.data, 'base64') };
}

/** A WAV as is; headerless L16 (older models) wrapped in a header so afinfo can read it. */
function asWav({ mime, data }) {
  return /wav/.test(mime) ? data : pcmToWav(data, Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000));
}

const summary = [];
for (const model of ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']) {
  for (const lang of ['vi', 'en']) {
    const r = await interactions(model, PASSAGES[lang], 'Kore');
    const audio = r.res.ok ? audioFromInteraction(r.json) : undefined;
    const info = audio ? saveAudio(`gemini-${model}-interactions-${lang}.wav`, asWav(audio)) : `HTTP ${r.res.status}`;
    summary.push({ model, endpoint: 'interactions', lang, status: r.res.status, mime: audio?.mime, ms: r.ms, usage: r.json?.usage?.total_output_tokens, info });
    if (model === 'gemini-3.8-flash-tts' && lang === 'vi') writeRecord('gemini-ok', r.record);
  }
}
for (const lang of ['vi', 'en']) {
  const model = 'gemini-3.8-flash-tts';
  const r = await generateContent(model, PASSAGES[lang], 'Kore');
  const audio = r.res.ok ? audioFromGenerateContent(r.json) : undefined;
  const info = audio ? saveAudio(`gemini-${model}-generatecontent-${lang}.wav`, asWav(audio)) : `HTTP ${r.res.status}`;
  summary.push({ model, endpoint: 'generateContent', lang, status: r.res.status, mime: audio?.mime, ms: r.ms, info });
  if (lang === 'vi') writeRecord('gemini-generatecontent-ok', r.record);
}

// A Vietnamese voice from the Extended Voice Library (GET /v1beta/voices?language_code=vi-VN) is used by its id.
{
  const r = await interactions('gemini-3.8-flash-lite-tts', PASSAGES.vi, 'vi-vn-tutor-1');
  const audio = r.res.ok ? audioFromInteraction(r.json) : undefined;
  summary.push({ model: 'gemini-3.8-flash-lite-tts', endpoint: 'interactions (voice vi-vn-tutor-1)', lang: 'vi', status: r.res.status, mime: audio?.mime, ms: r.ms, info: audio ? saveAudio('gemini-lite-vi-vn-tutor-1.wav', asWav(audio)) : `HTTP ${r.res.status}` });
}

// Voices: the prebuilt list is fixed in the docs; the Extended Voice Library is queryable.
const allVoices = await send({ url: `${BASE}/voices?page_size=100`, method: 'GET', headers: { 'x-goog-api-key': key } });
const langs = {};
for (const v of allVoices.json?.voices ?? []) langs[v.language_code] = (langs[v.language_code] ?? 0) + 1;
console.log('voices (all) by language_code', allVoices.res.status, JSON.stringify(langs), 'nextPageToken' in (allVoices.json ?? {}) ? 'more pages' : '');
const voices = await send({ url: `${BASE}/voices?language_code=vi-VN&page_size=50`, method: 'GET', headers: { 'x-goog-api-key': key } });
console.log('voices', voices.res.status, JSON.stringify(voices.json).slice(0, 600));
writeRecord('gemini-voices-ok', voices.record);

// Errors: an invalid key, and an empty input.
const bad = await interactions('gemini-3.8-flash-tts', PASSAGES.en, 'Kore', BAD_KEY);
const unknownVoice = await interactions('gemini-3.8-flash-tts', PASSAGES.en, 'NoSuchVoice');
const pcm = await send({ url: `${BASE}/interactions`, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: { model: 'gemini-3.8-flash-lite-tts', input: PASSAGES.en, response_format: { type: 'audio', mime_type: 'audio/l16', sample_rate: 24000 }, generation_config: { speech_config: [{ voice: 'Puck' }] } } });
const pcmAudio = audioFromInteraction(pcm.json ?? {});
console.log('l16 request →', pcm.res.status, pcmAudio?.mime, pcmAudio && saveAudio('gemini-l16-en.wav', asWav(pcmAudio)));
writeRecord('gemini-l16-ok', pcm.record);
writeRecord('gemini-error', { invalidKey: bad.record, unknownVoice: unknownVoice.record });
console.table(summary);
console.log('invalid key →', bad.res.status, JSON.stringify(bad.json).slice(0, 300));
console.log('unknown voice →', unknownVoice.res.status, JSON.stringify(unknownVoice.json).slice(0, 300));
