// Azure Speech (no key): the documented SSML request on the regional endpoint with an invalid key,
// both auth styles (Ocp-Apim-Subscription-Key header, and the issueToken exchange), and the voices list.
// Region: AZURE_SPEECH_REGION from .env, else eastus. With AZURE_SPEECH_KEY set it synthesizes for real.
import { BAD_KEY, PASSAGES, loadEnv, saveAudio, send, writeRecord } from './lib.mjs';

const env = loadEnv();
const region = env.AZURE_SPEECH_REGION || 'eastus';
const key = env.AZURE_SPEECH_KEY || BAD_KEY;
const real = Boolean(env.AZURE_SPEECH_KEY);
const TTS = `https://${region}.tts.speech.microsoft.com`;
const VOICES = { vi: ['vi-VN', 'vi-VN-HoaiMyNeural'], en: ['en-US', 'en-US-AvaMultilingualNeural'] };

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ssml = (lang) => `<speak version='1.0' xml:lang='${VOICES[lang][0]}'><voice name='${VOICES[lang][1]}'>${esc(PASSAGES[lang])}</voice></speak>`;

function synth(lang, auth) {
  return send({
    url: `${TTS}/cognitiveservices/v1`,
    headers: { ...auth, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'translate-peer-s11' },
    body: ssml(lang),
  });
}

const rows = [];
const byKey = {};
for (const lang of ['vi', 'en']) {
  const r = await synth(lang, { 'Ocp-Apim-Subscription-Key': key });
  byKey[lang] = r;
  rows.push({ call: `synthesize ${lang} (key header)`, status: r.res.status, contentType: r.record.response.contentType, info: r.res.ok ? saveAudio(`azure-${lang}.mp3`, r.bytes) : (r.text ?? JSON.stringify(r.json) ?? '').slice(0, 160) });
}
// The token exchange: POST issueToken with the key header, then Authorization: Bearer.
const token = await send({ url: `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Length': '0' } });
rows.push({ call: 'issueToken', status: token.res.status, contentType: token.record.response.contentType, info: (token.text ?? JSON.stringify(token.json) ?? '').slice(0, 160) });
const bearer = await synth('vi', { Authorization: `Bearer ${real && token.res.ok ? token.bytes.toString('utf8') : BAD_KEY}` });
rows.push({ call: 'synthesize vi (Bearer)', status: bearer.res.status, contentType: bearer.record.response.contentType, info: (bearer.text ?? JSON.stringify(bearer.json) ?? '').slice(0, 160) });
const voices = await send({ url: `${TTS}/cognitiveservices/voices/list`, method: 'GET', headers: { 'Ocp-Apim-Subscription-Key': key } });
rows.push({ call: 'voices/list', status: voices.res.status, contentType: voices.record.response.contentType, info: Array.isArray(voices.json) ? `${voices.json.length} voices; vi-VN: ${voices.json.filter((v) => v.Locale === 'vi-VN').map((v) => v.ShortName).join(', ')}` : (voices.text ?? JSON.stringify(voices.json) ?? '').slice(0, 160) });
const wrongRegion = await send({ url: 'https://nosuchregion.tts.speech.microsoft.com/cognitiveservices/v1', headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' }, body: ssml('en') }).catch((e) => ({ res: { status: `fetch threw: ${e.cause?.code ?? e.message}` }, record: { error: String(e.cause?.code ?? e.message) } }));
rows.push({ call: 'unknown region', status: wrongRegion.res.status, info: '' });

writeRecord(real ? 'azure-ok' : 'azure-error', { region, keyHeader: byKey.vi.record, issueToken: token.record, bearer: bearer.record, voicesList: voices.record, unknownRegion: wrongRegion.record });
console.table(rows);
