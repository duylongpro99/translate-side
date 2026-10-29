// Scores g2p-vi.ts against oracle.json: per-syllable exact match (the go/no-go metric), plus looser views.
// Writes results/g2p-match[-heldout][-foreign-en].json.
// Usage: node scripts/score-g2p.ts [--heldout] [--top N]
//        node scripts/run.mjs scripts/score-g2p.ts --foreign-en [--heldout]
//   --foreign-en: non-Vietnamese words go through g2p-en.ts (as the product would wire it; needs run.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { phonemize, phonemizeWords, syllableToIpa, type Options } from '../g2p-vi.ts';

type Entry = { group: string; text: string; expanded: string; phonemes: string[] };
const heldout = process.argv.includes('--heldout');
const foreignEn = process.argv.includes('--foreign-en');

const oracle = JSON.parse(readFileSync(new URL(`../oracle${heldout ? '-heldout' : ''}.json`, import.meta.url), 'utf8'));
// espeak-ng's vi voice switches to its default English voice (`en`) for these words.
const opts: Options = foreignEn
  ? { foreign: (w) => (globalThis as any).__s10PhonemizeEn(w, 'en').join(' ').replace(/[.,:;?!]/g, '') || null }
  : {};
const top = Number(process.argv[process.argv.indexOf('--top') + 1]) || 40;

const sylls = (s: string) =>
  s
    .split(/\s+/)
    .map((t) => t.replace(/[.,:;?!]/g, ''))
    .filter(Boolean);
const noStress = (s: string) => s.replace(/[ˈˌ]/g, '');
const tone = (s: string) => (s.match(/[123456ɜ7]/) ?? [''])[0];

// Levenshtein alignment of two token lists; returns aligned pairs (null = gap).
function align(a: string[], b: string[]): [number | null, number | null][] {
  const n = a.length;
  const m = b.length;
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  const out: [number | null, number | null][] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i]![j] === d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)) out.push([--i, --j]);
    else if (i > 0 && d[i]![j] === d[i - 1]![j]! + 1) out.push([--i, null]);
    else out.push([null, --j]);
  }
  return out.reverse();
}

async function main() {
  // g2p-en.ts only loads when bundled (run.mjs); a dynamic import keeps the plain-node path free of it.
  if (foreignEn) (globalThis as any).__s10PhonemizeEn = (await import('../g2p-en.ts')).phonemizeEn;
let total = 0;
let vnTotal = 0;
let vnExact = 0;
let exact = 0;
let loose = 0;
let toneOk = 0;
let sentExact = 0;
let sentStringExact = 0;
const byGroup: Record<string, { total: number; exact: number }> = {};
const misses = new Map<string, { count: number; word: string; ours: string; oracle: string }>();

for (const e of oracle.entries as Entry[]) {
  const words = phonemizeWords(e.text, opts).flatMap((t) => (t.kind === 'word' ? t.syllables.map((s) => ({ w: t.text, s })) : []));
  const ours = words.map((x) => x.s);
  const ref = sylls(e.phonemes.join(' '));
  if (phonemize(e.text, opts).join(' ') === e.phonemes.join(' ')) sentStringExact++;
  const g = (byGroup[e.group] ??= { total: 0, exact: 0 });
  let allOk = ours.length === ref.length;
  for (const [i, j] of align(ours, ref)) {
    if (j === null) continue; // an extra syllable on our side is counted through the oracle's count only
    total++;
    g.total++;
    const o = i === null ? '' : ours[i]!;
    const r = ref[j]!;
    const isVn = i !== null && syllableToIpa(words[i]!.w) !== null;
    if (isVn) vnTotal++;
    if (o === r && isVn) vnExact++;
    if (o === r) {
      exact++;
      g.exact++;
      loose++;
      toneOk++;
      continue;
    }
    allOk = false;
    if (noStress(o) === noStress(r)) loose++;
    if (o && tone(o) === tone(r)) toneOk++;
    const word = i === null ? '∅' : words[i]!.w.toLowerCase();
    const k = `${word}|${o}|${r}`;
    const m = misses.get(k) ?? { count: 0, word, ours: o, oracle: r };
    m.count++;
    misses.set(k, m);
  }
  if (allOk) sentExact++;
}

const n = (oracle.entries as Entry[]).length;
const result = {
  date: new Date().toISOString(),
  corpus: heldout ? 'corpus-vi-heldout.json' : 'corpus-vi.json',
  foreignWords: foreignEn ? 'g2p-en.ts (phonemize@2.0.1)' : 'built-in fallback',
  oraclePhonemizer: oracle.phonemizer,
  sentences: n,
  syllables: total,
  exactSyllableMatch: +(exact / total).toFixed(4),
  matchIgnoringStressMark: +(loose / total).toFixed(4),
  toneMatch: +(toneOk / total).toFixed(4),
  sentencesAllSyllablesExact: +(sentExact / n).toFixed(4),
  sentencesWholeStringExact: +(sentStringExact / n).toFixed(4),
  byGroup: Object.fromEntries(Object.entries(byGroup).map(([k, v]) => [k, { ...v, rate: +(v.exact / v.total).toFixed(4) }])),
  // Syllables of Vietnamese words only: words the G2P parses as Vietnamese syllables.
  vietnameseSyllables: vnTotal,
  vietnameseSyllableExactMatch: +(vnExact / vnTotal).toFixed(4),
  mismatches: [...misses.values()].sort((a, b) => b.count - a.count),
};
writeFileSync(new URL(`../results/g2p-match${heldout ? '-heldout' : ''}${foreignEn ? '-foreign-en' : ''}.json`, import.meta.url), JSON.stringify(result, null, 1) + '\n');
const { mismatches, ...summary } = result;
console.log(JSON.stringify(summary, null, 1));
for (const m of mismatches.slice(0, top)) console.log(m.count, m.word, m.ours, '→', m.oracle);
}
main();
