// Scores English G2P candidates against espeak-ng (the voice's training phonemizer) on corpus-en.json + the Harvard
// listening sentences. Metric: phoneme error rate (PER) = edit distance over phoneme codepoints (stress marks, spaces
// and punctuation removed) / oracle length; plus the stress-aware PER. Writes results/en-g2p.json.
// Usage: node scripts/run.mjs scripts/score-en.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { EnglishG2P } from '@piper-plus/g2p/en';
import { phonemizeEn, type EnVariant } from '../g2p-en.ts';
import { espeakPhonemes } from './oracle-lib.mjs';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const texts: string[] = [...read('corpus-en.json').sentences.map((s: { text: string }) => s.text), ...read('listen-set.json').en];
const piperPlus = new EnglishG2P();

function lev(a: string[], b: string[]) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}
const units = (s: string, stress: boolean) => [...s.normalize('NFD').replace(stress ? /[\s.,:;?!]/g : /[\sˈˌ.,:;?!]/g, '')];

const candidates: Record<string, (t: string, v: EnVariant) => string> = {
  'piper-plus@0.4.2 (raw)': (t) => piperPlus.phonemize(t).tokens.join(''),
  'phonemize@2.0.1 + espeak adapter (g2p-en.ts)': (t, v) => phonemizeEn(t, v).join(' '),
};
const out: Record<string, unknown> = { date: new Date().toISOString(), sentences: texts.length, targets: {} };
for (const variant of ['en', 'en-us'] as EnVariant[]) {
  const oracle = espeakPhonemes(variant, texts);
  const ref = oracle.phonemes.map((p: string[]) => p.join(' '));
  const res: Record<string, unknown> = { oracle: `${oracle.phonemizer} voice ${variant}` };
  for (const [name, fn] of Object.entries(candidates)) {
    let e = 0, es = 0, n = 0, ns = 0, exactSent = 0;
    const worst: { text: string; ours: string; oracle: string; per: number }[] = [];
    texts.forEach((t, i) => {
      const o = fn(t, variant);
      const a = units(o, false), b = units(ref[i]!, false);
      const d = lev(a, b);
      e += d; n += b.length;
      es += lev(units(o, true), units(ref[i]!, true)); ns += units(ref[i]!, true).length;
      if (d === 0) exactSent++;
      worst.push({ text: t, ours: o, oracle: ref[i]!, per: +(d / b.length).toFixed(3) });
    });
    res[name] = {
      per: +(e / n).toFixed(4),
      perWithStress: +(es / ns).toFixed(4),
      sentencesExact: exactSent,
      worst: worst.sort((x, y) => y.per - x.per).slice(0, 3),
    };
    console.log(variant, name, 'PER', (e / n).toFixed(4), 'PER+stress', (es / ns).toFixed(4));
  }
  (out.targets as Record<string, unknown>)[variant] = res;
}
writeFileSync(new URL('../results/en-g2p.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
