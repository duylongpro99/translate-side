// FPT.AI TTS v5 (no key): the documented request with an invalid key (no callback_url), and whether the
// "async" link it returns can be polled. FPT_API_KEY in .env, if set, synthesizes for real (vi only:
// FPT.AI has Vietnamese voices only) and polls the async link until the MP3 is there.
import { BAD_KEY, PASSAGES, loadEnv, saveAudio, send, writeRecord } from './lib.mjs';

const env = loadEnv();
const key = env.FPT_API_KEY || BAD_KEY;
const real = Boolean(env.FPT_API_KEY);
const URL_V5 = 'https://api.fpt.ai/hmi/tts/v5';

const rows = [];
const r = await send({ url: URL_V5, headers: { api_key: key, voice: 'banmai', speed: '0', format: 'mp3', 'Content-Type': 'text/plain; charset=utf-8' }, body: PASSAGES.vi });
rows.push({ call: 'synthesize vi (no callback_url)', status: r.res.status, contentType: r.record.response.contentType, info: JSON.stringify(r.json ?? r.text).slice(0, 240) });
const records = { synthesize: r.record };

if (real && r.json?.async) {
  // Poll the async link: 404/403 until the file is written, then 200 audio/mpeg.
  const t0 = Date.now();
  let audio;
  for (let i = 0; i < 60 && !audio; i++) {
    const p = await fetch(r.json.async);
    if (p.ok) audio = Buffer.from(await p.arrayBuffer());
    else await new Promise((res) => setTimeout(res, 1000));
    rows.push({ call: `poll ${i}`, status: p.status, contentType: p.headers.get('content-type'), info: `${Date.now() - t0} ms` });
  }
  records.asyncHost = new URL(r.json.async).origin;
  if (audio) rows.push({ call: 'async mp3', status: 200, info: saveAudio('fpt-vi.mp3', audio) });
}
const noKey = await send({ url: URL_V5, headers: { voice: 'banmai', 'Content-Type': 'text/plain; charset=utf-8' }, body: PASSAGES.vi });
rows.push({ call: 'no api_key header', status: noKey.res.status, info: JSON.stringify(noKey.json ?? noKey.text).slice(0, 200) });
records.noKey = noKey.record;
writeRecord(real ? 'fpt-ok' : 'fpt-error', records);
console.table(rows);
