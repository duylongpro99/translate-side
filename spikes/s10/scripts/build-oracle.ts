// Builds ../oracle.json (or ../oracle-heldout.json with --heldout): corpus-vi[-heldout].json text -> numbers expanded -> espeak-ng phonemes (Piper's training phonemizer).
// Also phonemizes with the current piper-tts build and records whether the two agree.
import { readFileSync, writeFileSync } from 'node:fs';
import { expandNumbers } from '../g2p-vi.ts';
import { espeakPhonemes } from './oracle-lib.mjs';

const suffix = process.argv.includes('--heldout') ? '-heldout' : '';
const corpus = JSON.parse(readFileSync(new URL(`../corpus-vi${suffix}.json`, import.meta.url), 'utf8'));
const items = corpus.sentences.map((s: { group: string; text: string }) => ({ ...s, expanded: expandNumbers(s.text) }));
const texts = items.map((i: { expanded: string }) => i.expanded);
const train = espeakPhonemes('vi', texts, 'training');
const cur = espeakPhonemes('vi', texts, 'current');
let same = 0;
const entries = items.map((it: object, i: number) => {
  const a = train.phonemes[i];
  if (JSON.stringify(a) === JSON.stringify(cur.phonemes[i])) same++;
  return { ...it, phonemes: a };
});
writeFileSync(
  new URL(`../oracle${suffix}.json`, import.meta.url),
  JSON.stringify(
    {
      note: 'Dev-time oracle only. Phonemes are espeak-ng output (GPL tool, used as a black box); never shipped.',
      voice: 'vi',
      phonemizer: train.phonemizer,
      crossCheck: { phonemizer: cur.phonemizer, identicalSentences: same, total: items.length },
      entries,
    },
    null,
    1,
  ) + '\n',
);
console.log(`oracle: ${items.length} sentences; ${train.phonemizer} vs ${cur.phonemizer}: ${same} identical`);
