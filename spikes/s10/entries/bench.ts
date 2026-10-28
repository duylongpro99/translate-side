// The extension page's script. Bundled by build.mjs into ext/bench.js. Exposes window.s10 for scripts/bench.mjs.
import * as ort from 'onnxruntime-web/wasm';
import { phonemize as phonemizeVi, phonemeIds } from '../g2p-vi.ts';
import { phonemizeEn } from '../g2p-en.ts';

type Voice = { session: ort.InferenceSession; config: any };
const voices: Record<string, Voice> = {};
const CACHE = 's10-voices';

const params = new URLSearchParams(location.search);
ort.env.wasm.wasmPaths = chrome.runtime.getURL('ort/');
ort.env.wasm.numThreads = Number(params.get('threads') ?? '1');

async function cachedBytes(url: string) {
  const cache = await caches.open(CACHE);
  let res = await cache.match(url);
  let downloadMs = 0;
  if (!res) {
    const t = performance.now();
    const net = await fetch(url);
    if (!net.ok) throw new Error(`fetch ${url}: ${net.status}`);
    await cache.put(url, net);
    downloadMs = performance.now() - t;
    res = await cache.match(url);
  }
  const t = performance.now();
  const buf = await res!.arrayBuffer();
  return { buf, downloadMs, cacheReadMs: performance.now() - t };
}

async function loadVoice(name: string, base: string) {
  const t0 = performance.now();
  const cfgRes = await cachedBytes(`${base}/${name}.onnx.json`);
  const model = await cachedBytes(`${base}/${name}.onnx`);
  const t1 = performance.now();
  const session = await ort.InferenceSession.create(new Uint8Array(model.buf), { executionProviders: ['wasm'] });
  const t2 = performance.now();
  voices[name] = { session, config: JSON.parse(new TextDecoder().decode(cfgRes.buf)) };
  return {
    bytes: model.buf.byteLength,
    downloadMs: model.downloadMs,
    cacheReadMs: model.cacheReadMs,
    sessionCreateMs: t2 - t1,
    totalMs: t2 - t0,
    crossOriginIsolated,
    threads: ort.env.wasm.numThreads,
  };
}

async function synth(name: string, ipa: string) {
  const v = voices[name]!;
  const ids = phonemeIds(ipa, v.config.phoneme_id_map);
  const inf = v.config.inference;
  const t = performance.now();
  const out = await v.session.run({
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale, inf.length_scale, inf.noise_w]), [3]),
  });
  const ms = performance.now() - t;
  const audio = out[v.session.outputNames[0]!]!.data as Float32Array;
  return { audio, ms, ids: ids.length, seconds: audio.length / v.config.audio.sample_rate };
}

function toBase64Pcm16(chunks: Float32Array[]) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const pcm = new Int16Array(n);
  let o = 0;
  for (const c of chunks) for (let i = 0; i < c.length; i++) pcm[o++] = Math.max(-1, Math.min(1, c[i]!)) * 32767;
  const bytes = new Uint8Array(pcm.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// vi: our rules, with English words read by the English G2P (as espeak-ng switches to English for them).
const viOpts = { foreign: (w: string) => phonemizeEn(w, 'en').join(' ').replace(/[.,:;?!]/g, '') || null };
const g2p = (lang: string, text: string) => (lang === 'vi' ? phonemizeVi(text, viOpts) : phonemizeEn(text, 'en'));

/** Time to first audio for a block: G2P, first sentence's inference, start of playback. Then the rest, for the RTF. */
async function speakBlock(name: string, lang: string, text: string, play = true, clauses = false) {
  const t0 = performance.now();
  // clauses: also cut sentences after , ; : so the first chunk to synthesize is shorter.
  const sentences = clauses ? g2p(lang, text).flatMap((s) => s.split(/(?<=[,;:]) /)) : g2p(lang, text);
  const g2pMs = performance.now() - t0;
  const first = await synth(name, sentences[0]!);
  let firstAudioMs = performance.now() - t0;
  if (play) {
    const ctx = new AudioContext({ sampleRate: voices[name]!.config.audio.sample_rate });
    const buf = ctx.createBuffer(1, first.audio.length, ctx.sampleRate);
    buf.copyToChannel(first.audio, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    firstAudioMs = performance.now() - t0;
    src.stop();
    await ctx.close();
  }
  let infMs = first.ms;
  let seconds = first.seconds;
  for (const s of sentences.slice(1)) {
    const r = await synth(name, s);
    infMs += r.ms;
    seconds += r.seconds;
  }
  return {
    chars: text.length,
    sentences: sentences.length,
    firstSentenceChars: sentences[0]!.length,
    g2pMs,
    firstInferenceMs: first.ms,
    firstAudioMs,
    totalInferenceMs: infMs,
    audioSeconds: seconds,
    rtf: infMs / 1000 / seconds,
  };
}

/** Synthesizes given phoneme strings (one per sentence) and returns 16-bit PCM as base64, for the WAV files. */
async function synthPhonemes(name: string, sentences: string[]) {
  const chunks: Float32Array[] = [];
  const silence = new Float32Array(Math.round(0.25 * voices[name]!.config.audio.sample_rate));
  for (const s of sentences) {
    chunks.push((await synth(name, s)).audio, silence);
  }
  return { pcm16: toBase64Pcm16(chunks), sampleRate: voices[name]!.config.audio.sample_rate };
}

(globalThis as any).s10 = { loadVoice, speakBlock, synthPhonemes, g2p, ready: true };
document.getElementById('log')!.textContent += `\nready; threads=${ort.env.wasm.numThreads}; isolated=${crossOriginIsolated}`;
