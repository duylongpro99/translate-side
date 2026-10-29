// Listening set + automatic intelligibility proxy.
//  1. Phonemizes listen-set.json with our G2P and with the espeak-ng oracle (en: also piper-plus raw).
//  2. Synthesizes every version in the extension page (Chromium) and saves WAVs under .cache/s10/listen/ with blind
//     names (vi-01-A.wav ...); the key is .cache/s10/listen/key.json, a score sheet scores.csv for the owner.
//  3. Transcribes each WAV with Gemini (audio understanding) and scores it against the text: WER, CER, and for vi the
//     tone accuracy (syllables whose letters were heard right and whose tone mark is also right).
// Writes results/asr-proxy.json. Usage: node build.mjs && node scripts/run.mjs scripts/listen.ts [--model M] [--reuse]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EnglishG2P } from '@piper-plus/g2p/en';
import { phonemize as phonemizeVi, expandNumbers } from '../g2p-vi.ts';
import { phonemizeEn } from '../g2p-en.ts';
import { espeakPhonemes, cacheDir } from './oracle-lib.mjs';
import { launch, voiceHost, BASE, VI, EN } from './browser.mjs';
import { generate } from './gemini.mjs';

const arg = (k: string, d: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1]! : d);
// gemini-3.5-transcribe returned empty text for inline WAV on 2026-10-26, and the free tier allows ~20 requests a day per
// model, so clips are sent in batches: one request per (language, system, run), each clip a different sentence (so the
// model cannot borrow words between two readings of the same sentence).
const MODEL = arg('--model', 'gemini-3-flash-preview');
const REUSE = process.argv.includes('--reuse'); // keep existing WAVs and transcripts
const RUNS = Number(arg('--runs', '2')); // transcriptions per WAV (the ASR is not deterministic)
const OUT = path.join(cacheDir, 'listen');
mkdirSync(OUT, { recursive: true });
const set = JSON.parse(readFileSync(new URL('../listen-set.json', import.meta.url), 'utf8'));
const piperPlus = new EnglishG2P();

type Item = { lang: 'vi' | 'en'; n: number; text: string; systems: Record<string, string[]> };
const items: Item[] = [];
const viOracle = espeakPhonemes('vi', set.vi.map((t: string) => expandNumbers(t))).phonemes;
set.vi.forEach((t: string, i: number) =>
  items.push({ lang: 'vi', n: i + 1, text: t, systems: { ours: phonemizeVi(t), oracle: viOracle[i] } }),
);
const enOracle = espeakPhonemes('en', set.en).phonemes;
set.en.forEach((t: string, i: number) =>
  items.push({
    lang: 'en',
    n: i + 1,
    text: t,
    systems: { ours: phonemizeEn(t, 'en'), oracle: enOracle[i], 'piper-plus': [piperPlus.phonemize(t).tokens.join('')] },
  }),
);

// Blind labels: a fixed shuffle per item (seeded), so reruns keep the same names.
function labels(n: number, keys: string[]) {
  const ks = [...keys];
  let seed = n * 7919;
  for (let i = ks.length - 1; i > 0; i--) {
    seed = (seed * 48271) % 2147483647;
    const j = seed % (i + 1);
    [ks[i], ks[j]] = [ks[j]!, ks[i]!];
  }
  return Object.fromEntries(ks.map((k, i) => [k, 'ABC'[i]!]));
}

function wav(pcm16: Buffer, rate: number) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm16.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm16.length, 40);
  return Buffer.concat([h, pcm16]);
}

// ---- scoring ----
const norm = (s: string, lang: string) =>
  (lang === 'vi' ? expandNumbers(s) : s)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
function lev<T>(a: T[], b: T[]) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}
const TONES = /[̣̀́̃̉]/g;
const toneOf = (syl: string) => (syl.normalize('NFD').match(TONES) ?? ['0'])[0];
const baseOf = (syl: string) => syl.normalize('NFD').replace(TONES, '').normalize('NFC');
// Syllable alignment on toneless bases; then, of the aligned equal bases, how many tones match.
function toneAccuracy(ref: string[], hyp: string[]) {
  const a = ref.map(baseOf), b = hyp.map(baseOf);
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  let i = a.length, j = b.length, same = 0, ok = 0;
  while (i > 0 && j > 0) {
    if (d[i]![j] === d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      if (a[i - 1] === b[j - 1]) {
        same++;
        if (toneOf(ref[i - 1]!) === toneOf(hyp[j - 1]!)) ok++;
      }
      i--, j--;
    } else if (d[i]![j] === d[i - 1]![j]! + 1) i--;
    else j--;
  }
  return { same, ok };
}

async function main() {
  const key: Record<string, Record<string, string>> = {};
  const transcriptsFile = path.join(OUT, 'transcripts.json');
  const saved = REUSE && existsSync(transcriptsFile) ? JSON.parse(readFileSync(transcriptsFile, 'utf8')) : {};
  const transcripts: Record<string, string[]> = saved.model === MODEL ? saved.byFile : {};
  const server = await voiceHost();
  const { ctx, open } = await launch('bench-profile');
  const page = await open(4);
  await page.evaluate(([b, vi, en]) => Promise.all([s10.loadVoice(vi, b), s10.loadVoice(en, b)]), [BASE, VI, EN]);
  for (const it of items) {
    const lab = labels(it.n + (it.lang === 'en' ? 100 : 0), Object.keys(it.systems));
    key[`${it.lang}-${String(it.n).padStart(2, '0')}`] = lab;
    for (const [sys, ph] of Object.entries(it.systems)) {
      const file = path.join(OUT, `${it.lang}-${String(it.n).padStart(2, '0')}-${lab[sys]}.wav`);
      if (!(REUSE && existsSync(file))) {
        const r = await page.evaluate(([v, p]) => s10.synthPhonemes(v, p), [it.lang === 'vi' ? VI : EN, ph] as const);
        writeFileSync(file, wav(Buffer.from(r.pcm16, 'base64'), r.sampleRate));
      }
    }
  }
  await ctx.close();
  server.close();
  writeFileSync(path.join(OUT, 'key.json'), JSON.stringify({ note: 'Blind labels: which system each letter is.', key }, null, 1));
  writeFileSync(
    path.join(OUT, 'scores.csv'),
    'file,intelligibility_1to5,tones_1to5 (vi only),notes\n' +
      Object.entries(key)
        .flatMap(([id, lab]) => Object.values(lab).sort().map((l) => `${id}-${l}.wav,,,`))
        .join('\n') +
      '\n',
  );

  // Transcribe, batched per (language, system).
  for (const lang of ['vi', 'en'] as const) {
    const langItems = items.filter((it) => it.lang === lang);
    for (const sys of Object.keys(langItems[0]!.systems)) {
      const files = langItems.map((it) => {
        const id = `${it.lang}-${String(it.n).padStart(2, '0')}`;
        return `${id}-${key[id]![sys]}.wav`;
      });
      while (Math.min(...files.map((f) => transcripts[f]?.length ?? 0)) < RUNS) {
        const language = lang === 'vi' ? 'Vietnamese' : 'English';
        const parts: object[] = [
          {
            text: `Below are ${files.length} short, unrelated ${language} speech clips. Transcribe each one independently, exactly as spoken, word for word${lang === 'vi' ? ', with full Vietnamese diacritics (tone marks)' : ''}. Do not correct or guess what was meant: write what you hear. Return a JSON array of ${files.length} strings, one per clip, in order.`,
          },
        ];
        files.forEach((f, k) => parts.push({ text: `Clip ${k + 1}:` }, { inlineData: { mimeType: 'audio/wav', data: readFileSync(path.join(OUT, f)).toString('base64') } }));
        const arr = JSON.parse(await generate(MODEL, parts, { json: true }));
        if (!Array.isArray(arr) || arr.length !== files.length) throw new Error(`bad batch reply for ${lang}/${sys}`);
        files.forEach((f, k) => (transcripts[f] ??= []).push(String(arr[k]).trim()));
        writeFileSync(transcriptsFile, JSON.stringify({ model: MODEL, byFile: transcripts }, null, 1));
        console.log(`transcribed ${lang}/${sys} run ${transcripts[files[0]!]!.length}`);
      }
    }
  }

  // Score.
  const agg: Record<string, Record<string, { wErr: number; wN: number; cErr: number; cN: number; cErrNoTone: number; tSame: number; tOk: number; items: number }>> = {};
  const perItem: unknown[] = [];
  for (const it of items) {
    const id = `${it.lang}-${String(it.n).padStart(2, '0')}`;
    const ref = norm(it.text, it.lang);
    for (const [sys, l] of Object.entries(key[id]!)) {
      const a = ((agg[it.lang] ??= {})[sys] ??= { wErr: 0, wN: 0, cErr: 0, cN: 0, cErrNoTone: 0, tSame: 0, tOk: 0, items: 0 });
      for (const hypRaw of transcripts[`${id}-${l}.wav`]!) {
        const hyp = norm(hypRaw, it.lang);
        const rw = ref.split(' '), hw = hyp.split(' ');
        a.wErr += lev(rw, hw);
        a.wN += rw.length;
        a.cErr += lev([...ref.normalize('NFD')], [...hyp.normalize('NFD')]);
        a.cN += [...ref.normalize('NFD')].length;
        a.cErrNoTone += lev([...ref.normalize('NFD').replace(TONES, '')], [...hyp.normalize('NFD').replace(TONES, '')]);
        if (it.lang === 'vi') {
          const t = toneAccuracy(rw, hw);
          a.tSame += t.same;
          a.tOk += t.ok;
        }
        a.items++;
        perItem.push({ file: `${id}-${l}.wav`, system: sys, ref, hyp, wer: +(lev(rw, hw) / rw.length).toFixed(3) });
      }
    }
  }
  const summary = Object.fromEntries(
    Object.entries(agg).map(([lang, s]) => [
      lang,
      Object.fromEntries(
        Object.entries(s).map(([sys, a]) => [
          sys,
          {
            transcriptions: a.items,
            wer: +(a.wErr / a.wN).toFixed(4),
            cer: +(a.cErr / a.cN).toFixed(4),
            ...(lang === 'vi' ? { cerIgnoringTones: +(a.cErrNoTone / a.cN).toFixed(4), toneAccuracy: +(a.tOk / a.tSame).toFixed(4) } : {}),
          },
        ]),
      ),
    ]),
  );
  writeFileSync(
    new URL('../results/asr-proxy.json', import.meta.url),
    JSON.stringify({ date: new Date().toISOString(), asrModel: MODEL, runsPerWav: RUNS, voices: { vi: VI, en: EN }, summary, perItem }, null, 1) + '\n',
  );
  console.log(JSON.stringify(summary, null, 1));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
