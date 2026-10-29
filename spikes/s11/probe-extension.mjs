// The extension-page path: loads spikes/s11/ext (MV3, host permissions only, no CORS help from the
// servers) in Playwright's Chromium the way e2e/fixtures.ts does, opens chrome-extension://<id>/probe.html
// and runs each provider's request there with fetch. Real keys (Gemini, OpenRouter) synthesize vi and en
// and the audio is decoded by Chromium (decodeAudioData and an <audio> element). The keyless providers
// get an invalid key: the page must read the provider's own status and body, not a CORS failure.
// Keys reach the page only as page.evaluate arguments; results/extension.json holds no key.
//
// Run from the repository root: node spikes/s11/probe-extension.mjs
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { BAD_KEY, PASSAGES, loadEnv } from './lib.mjs';

const HERE = import.meta.dirname;
const EXT = path.join(HERE, 'ext');
const ARGS = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required'];
const env = loadEnv();
const json = (body) => JSON.stringify(body);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const calls = [];
for (const lang of ['vi', 'en']) {
  if (env.GEMINI_API_KEY) {
    calls.push({
      name: `gemini interactions ${lang}`,
      req: {
        url: 'https://generativelanguage.googleapis.com/v1beta/interactions',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: json({ model: 'gemini-3.8-flash-lite-tts', input: [{ type: 'user_input', content: [{ type: 'text', text: PASSAGES[lang], annotations: [{ type: 'speech_metadata', style: 'calm narrator' }] }] }], response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice: 'Kore' }] } }),
      },
    });
  }
  if (env.OPENROUTER_API_KEY) {
    calls.push({
      name: `openrouter audio/speech ${lang}`,
      req: { url: 'https://openrouter.ai/api/v1/audio/speech', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENROUTER_API_KEY}` }, body: json({ model: 'fish-audio/s2.1-pro-free:free', input: PASSAGES[lang], response_format: 'mp3' }) },
    });
  }
}
if (env.GEMINI_API_KEY) {
  calls.push({
    name: 'gemini generateContent vi',
    req: {
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: json({ contents: [{ parts: [{ text: PASSAGES.vi }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } } } }),
    },
  });
}
calls.push(
  { name: 'openai (invalid key)', req: { url: 'https://api.openai.com/v1/audio/speech', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BAD_KEY}` }, body: json({ model: 'gpt-4o-mini-tts', input: PASSAGES.vi, voice: 'marin', instructions: 'calm' }) } },
  { name: 'azure key header (invalid key)', req: { url: 'https://eastus.tts.speech.microsoft.com/cognitiveservices/v1', headers: { 'Ocp-Apim-Subscription-Key': BAD_KEY, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' }, body: `<speak version='1.0' xml:lang='vi-VN'><voice name='vi-VN-HoaiMyNeural'>${esc(PASSAGES.vi)}</voice></speak>` } },
  { name: 'azure issueToken (invalid key)', req: { url: 'https://eastus.api.cognitive.microsoft.com/sts/v1.0/issueToken', headers: { 'Ocp-Apim-Subscription-Key': BAD_KEY } } },
  { name: 'elevenlabs (invalid key)', req: { url: 'https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128', headers: { 'Content-Type': 'application/json', 'xi-api-key': BAD_KEY }, body: json({ text: PASSAGES.vi, model_id: 'eleven_flash_v2_5', language_code: 'vi' }) } },
  { name: 'google cloud tts (invalid key)', req: { url: 'https://texttospeech.googleapis.com/v1/text:synthesize', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': BAD_KEY }, body: json({ input: { text: PASSAGES.vi }, voice: { languageCode: 'vi-VN', name: 'vi-VN-Chirp3-HD-Kore' }, audioConfig: { audioEncoding: 'MP3' } }) } },
  { name: 'vbee realtime (invalid token)', req: { url: 'https://api.vbee.vn/v1/tts', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BAD_KEY}`, 'App-Id': '00000000-0000-0000-0000-000000000000' }, body: json({ text: PASSAGES.vi, mode: 'sync', voiceCode: 'hn_female_ngochuyen_full_48k-fhg' }) } },
  { name: 'fpt.ai v5 (invalid key)', req: { url: 'https://api.fpt.ai/hmi/tts/v5', headers: { api_key: BAD_KEY, voice: 'banmai', 'Content-Type': 'text/plain; charset=utf-8' }, body: PASSAGES.vi } },
);

const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...ARGS] });
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/probe.html`);
  const results = [];
  for (const { name, req } of calls) {
    const r = await page.evaluate((q) => window.s11Call(q), req);
    results.push({ name, ...r });
    console.log(name, '→', JSON.stringify(r).slice(0, 260));
  }
  const out = { recordedAt: new Date().toISOString(), browser: `${context.browser()?.version() ?? 'chromium'} (Playwright Chromium, headless)`, userAgent: await page.evaluate(() => navigator.userAgent), results };
  const file = path.join(HERE, 'results/extension.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(out, null, 2);
  for (const v of Object.values(env)) if (v && v.length > 8 && text.includes(v)) throw new Error('refusing to write: a key value would leak');
  fs.writeFileSync(file, text + '\n');
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
} finally {
  await context.close();
}
