// Vbee (no key): the Realtime (sync) API and the Batch (async) API with an invalid token, the Get-request
// poll and the voices list. VBEE_TOKEN + VBEE_APP_ID in .env, if set, synthesize for real (vi; Realtime
// has no English voice).
import { BAD_KEY, PASSAGES, loadEnv, saveAudio, send, writeRecord } from './lib.mjs';

const env = loadEnv();
const token = env.VBEE_TOKEN || BAD_KEY;
const appId = env.VBEE_APP_ID || '00000000-0000-0000-0000-000000000000';
const real = Boolean(env.VBEE_TOKEN && env.VBEE_APP_ID);
const BASE = 'https://api.vbee.vn/v1';
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'App-Id': appId };
const VOICE_VI = 'hn_female_ngochuyen_full_48k-fhg';

const rows = [];
const realtime = await send({ url: `${BASE}/tts`, headers: H, body: { text: PASSAGES.vi, mode: 'sync', voiceCode: VOICE_VI, outputFormat: 'mp3' } });
rows.push({ call: 'realtime vi (sync)', status: realtime.res.status, contentType: realtime.record.response.contentType, info: realtime.res.ok && !realtime.json ? saveAudio('vbee-vi.mp3', realtime.bytes) : JSON.stringify(realtime.json ?? realtime.text).slice(0, 200) });
const tooLong = await send({ url: `${BASE}/tts`, headers: H, body: { text: 'a'.repeat(301), mode: 'sync', voiceCode: VOICE_VI } });
rows.push({ call: 'realtime 301 chars', status: tooLong.res.status, info: JSON.stringify(tooLong.json ?? tooLong.text).slice(0, 200) });
const batch = await send({ url: `${BASE}/tts`, headers: H, body: { text: PASSAGES.en, mode: 'async', voiceCode: VOICE_VI, outputFormat: 'mp3' } });
rows.push({ call: 'batch without webhookUrl', status: batch.res.status, info: JSON.stringify(batch.json ?? batch.text).slice(0, 200) });
const poll = await send({ url: `${BASE}/tts/requests/00000000-0000-0000-0000-000000000000`, method: 'GET', headers: H });
rows.push({ call: 'GET tts/requests/{id}', status: poll.res.status, info: JSON.stringify(poll.json ?? poll.text).slice(0, 200) });
const voices = await send({ url: `${BASE}/voices?language_code=vi-VN&limit=20`, method: 'GET', headers: H });
rows.push({ call: 'GET voices', status: voices.res.status, info: JSON.stringify(voices.json ?? voices.text).slice(0, 200) });
const noAppId = await send({ url: `${BASE}/tts`, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: { text: 'xin chào', mode: 'sync', voiceCode: VOICE_VI } });
rows.push({ call: 'no App-Id header', status: noAppId.res.status, info: JSON.stringify(noAppId.json ?? noAppId.text).slice(0, 200) });
const preflight = await fetch(`${BASE}/tts`, { method: 'OPTIONS', headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,app-id,content-type' } });
rows.push({ call: 'CORS preflight (information)', status: preflight.status, info: `allow-origin=${preflight.headers.get('access-control-allow-origin')} allow-headers=${preflight.headers.get('access-control-allow-headers')}` });

writeRecord(real ? 'vbee-ok' : 'vbee-error', { realtime: realtime.record, realtimeTooLong: tooLong.record, batchNoWebhook: batch.record, getRequest: poll.record, voices: voices.record, noAppId: noAppId.record });
console.table(rows);
