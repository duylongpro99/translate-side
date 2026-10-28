// English G2P for Piper voices trained on espeak-ng phonemes, without espeak-ng.
//
// `phonemize` (npm, MIT, hans00/phonemize) does the hard part: a 125k-word lexicon, rules for unknown words, numbers.
// Its IPA follows dictionary conventions (stress before the syllable, ɫ, ɝ, American vowels). This adapter rewrites
// it into espeak-ng's conventions, which is what the voice was trained on:
//   variant 'en'    (espeak voice `en`, used by en_US-ljspeech/kristin/norman): non-rhotic, a, ɒ, əʊ, ɜː, eə, ɪə
//   variant 'en-us' (espeak voice `en-us`, used by en_US-lessac/amy/sam/...):   rhotic, æ, ɑː, oʊ, ɚ
// Stress marks are moved to sit right before the vowel, as espeak-ng writes them.
//
// API: phonemizeEn(text, variant?) -> string[]  one IPA string per sentence (feed to phonemeIds from g2p-vi.ts)
import { phonemize } from 'phonemize';

export type EnVariant = 'en' | 'en-us';

const VOWEL_START = /^(aɪ|aʊ|eɪ|oʊ|ɔɪ|ɑ|æ|ʌ|ə|ɔ|ɛ|ɝ|ɚ|ɪ|i|ʊ|u|a|e|o|ɜ|ɒ)/;

// Rewrites one word. `w` is phonemize's IPA for the word (no spaces).
function adaptWord(w: string, word: string, variant: EnVariant): string {
  let s = w.replace(/ɫ/g, 'l').replace(/ʤ/g, 'dʒ').replace(/ʧ/g, 'tʃ');
  // Move each stress mark from the syllable onset to just before the syllable's first vowel.
  let out = '';
  let pending = '';
  for (let i = 0; i < s.length; ) {
    const ch = s[i]!;
    if (ch === 'ˈ' || ch === 'ˌ') {
      pending = ch;
      i++;
      continue;
    }
    const v = s.slice(i).match(VOWEL_START);
    if (v) {
      out += pending + v[0];
      pending = '';
      i += v[0].length;
    } else {
      out += ch;
      i++;
    }
  }
  s = out;
  const NV = '(?![aeiouəɜɑɔɪʊɛæʌɒ])'; // not before a vowel
  // espeak-ng conventions that do not depend on the accent.
  s = s
    .replace(/n(?=[kɡ])/g, 'ŋ') // increase -> ɪŋkɹiːs
    .replace(/ə([zd])$/, 'ɪ$1') // charges, wanted -> -ɪz, -ɪd
    .replace(/[ˈˌ](i)$/, '$1'); // -ity: no stress on the final i
  if (variant === 'en') {
    s = s
      .replace(new RegExp(`ɑɹ${NV}`, 'g'), 'ɑː')
      .replace(new RegExp(`ɔɹ${NV}`, 'g'), 'ɔː')
      .replace(new RegExp(`ɛɹ${NV}`, 'g'), 'eə')
      .replace(new RegExp(`ɪɹ${NV}`, 'g'), 'ɪə')
      .replace(new RegExp(`ʊɹ${NV}`, 'g'), 'ʊə')
      .replace(/ɝ/g, 'ɜː')
      .replace(/ɚ/g, 'ə')
      .replace(/oʊ/g, 'əʊ')
      .replace(/æ/g, 'a')
      .replace(/ɑ(?!ː)/g, 'ɒ')
      .replace(/ɔ(?![ːɪ])/g, 'ɔː')
      .replace(/u(?!ː)/g, 'uː')
      .replace(/i(?!ː)(?!$)/g, 'iː')
      // Non-rhotic: drop ɹ after a vowel unless a vowel follows.
      .replace(new RegExp(`([əɜːɑɔɪʊeaɒ])ɹ${NV}`, 'g'), '$1');
  } else {
    s = s
      .replace(/ɝ/g, 'ɜː')
      .replace(/ɑ(?!ː)/g, 'ɑː')
      .replace(/ɔ(?![ːɪ])/g, 'ɔː')
      .replace(/u(?!ː)/g, 'uː')
      .replace(/i(?!ː)(?!$)/g, 'iː');
  }
  // aɪ/eɪ/ɔɪ must stay diphthongs.
  s = s.replace(/([aeɔ])iː/g, '$1ɪ');
  // espeak-ng stresses content words of one syllable; the dictionary IPA leaves them bare.
  if (!/[ˈˌ]/.test(s) && !FUNCTION_WORDS.has(word)) {
    const v = s.search(/[aeiouəɜɑɔɪʊɛæʌɒ]/);
    if (v >= 0) s = s.slice(0, v) + 'ˈ' + s.slice(v);
  }
  return s;
}

// Unstressed in espeak-ng's English (observed on the comparison corpus); everything else gets a stress mark.
const FUNCTION_WORDS = new Set(
  ('a an the of to in on at by for from with as and or but nor if so than then that this these those is am are was ' +
    'were be been being it its he him his she her we us our you your they them their i me my not no can could will ' +
    'would shall should may might must do does did has have had which who whom whose what there here up per via').split(' '),
);

/** Text to Piper phoneme strings, one per sentence (split after . ? !). */
export function phonemizeEn(text: string, variant: EnVariant = 'en'): string[] {
  const ipa: string = phonemize(text, variant === 'en' ? 'en-GB' : 'en-US');
  // The source words, to tell function words apart (phonemize keeps one IPA word per source word).
  const srcWords = text.toLowerCase().match(/[a-z0-9'’-]+/g) ?? [];
  const ipaWords = ipa.match(/[^\s.,:;?!]+/g) ?? [];
  const aligned = srcWords.length === ipaWords.length;
  let wi = 0;
  let prevThe = -1;
  const sentences: string[] = [];
  let cur = '';
  for (const m of ipa.matchAll(/[^\s.,:;?!]+|[.,:;?!]+|\s+/g)) {
    const t = m[0];
    if (/^\s+$/.test(t)) continue;
    if (/^[.,:;?!]+$/.test(t)) {
      const p = t[t.length - 1]!;
      cur = cur.trimEnd() + p;
      if (p === '.' || p === '?' || p === '!') {
        sentences.push(cur);
        cur = '';
      } else cur += ' ';
      continue;
    }
    if (cur !== '' && !cur.endsWith(' ')) cur += ' ';
    const word = aligned ? srcWords[wi]! : '';
    const a = adaptWord(t, word, variant);
    // "the" before a vowel is ðɪ.
    if (prevThe >= 0 && /^[ˈˌ]?[aeiouəɜɑɔɪʊɛæʌɒ]/.test(a)) cur = cur.slice(0, prevThe) + 'ðɪ ';
    prevThe = t === 'ðə' ? cur.length : -1;
    cur += a;
    wi++;
  }
  if (cur.trim()) sentences.push(cur.trimEnd());
  return sentences;
}
