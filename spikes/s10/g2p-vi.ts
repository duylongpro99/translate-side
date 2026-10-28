// Rule-based Vietnamese G2P for the Piper `vi_VN-vais1000-medium` voice. MIT, pure TypeScript, no dependencies.
//
// The voice was trained on espeak-ng's IPA output (voice `vi`, through piper-phonemize). This module emits the same
// symbol conventions without espeak-ng: it was written from Vietnamese spelling rules and checked against espeak-ng
// only as a black-box oracle at dev time (spikes/s10/oracle.json). No espeak-ng code or data files are copied.
//
// Public API (phase 8 moves this file to src/tts/piper/g2p-vi.ts unchanged):
//   phonemize(text, opts?)      -> string[]  one IPA string per sentence, in Piper's format (feed to phonemeIds)
//   phonemizeWords(text, opts?) -> Token[]   per-word detail: syllables and punctuation (used by the spike's scorer)
//   opts.foreign(word)          -> IPA for a non-Vietnamese word (pass the English G2P); a rough built-in otherwise
//   phonemeIds(ipa, map)        -> number[]  Piper ids: ^ _ (id _)* $ , codepoints after NFD
//   expandNumbers(text)         -> string    digits -> Vietnamese words (Northern: nghìn, linh)
//   syllableToIpa(syllable)     -> string | null  one syllable, null if it is not Vietnamese
//
// Symbol conventions (as the voice expects them):
//   stress ˈ before the nucleus (ˌ for a set of unstressed function words), tone digit after the nucleus and before
//   the coda: huyền 2, sắc ɜ, hỏi 4, ngã 5, nặng 6, ngang nothing (but `1` on âu/êu, e.g. đâu = ɗˈə1w).

export type Token =
  | { kind: 'word'; text: string; syllables: string[] }
  | { kind: 'punct'; text: string };

const TONE_MARKS: Record<string, string> = {
  '\u0300': '2', // grave: huyền
  '\u0301': 'ɜ', // acute: sắc
  '\u0309': '4', // hook above: hỏi
  '\u0303': '5', // tilde: ngã
  '\u0323': '6', // dot below: nặng
};

// Words espeak-ng's voice reads with secondary stress (ˌ). Learned by observing the oracle's output on common words.
const UNSTRESSED = new Set(
  (
    'và là của các những được cho với không đã sẽ đang thì mà để từ khi như nhưng vì nên bị đến mọi nếu chưa mỗi ' +
    'phải dù hoặc bởi tới vẫn còn lúc con cái khoảng chẳng'
  ).split(' '),
);

const ONSETS: [string, string][] = [
  ['ngh', 'ŋ'],
  ['ng', 'ŋ'],
  ['gh', 'ɣ'],
  ['kh', 'x'],
  ['nh', 'ɲ'],
  ['ph', 'f'],
  ['th', 't'],
  ['tr', 'tʃ'],
  ['ch', 'tʃ'],
  ['b', 'b'],
  ['c', 'k'],
  ['k', 'k'],
  ['d', 'z'],
  ['đ', 'ɗ'],
  ['g', 'ɣ'],
  ['h', 'h'],
  ['l', 'l'],
  ['m', 'm'],
  ['n', 'n'],
  ['p', 'p'],
  ['r', 'z'],
  ['s', 's'],
  ['t', 't̪'],
  ['v', 'v'],
  ['x', 's'],
];

// Vowel nuclei (spelling, IPA), longest first. Diphthongs change with the coda in nucleusIpa().
const NUCLEI: [string, string][] = [
  ['iê', 'iɛ'],
  ['yê', 'iɛ'],
  ['ia', 'iə'],
  ['ya', 'iə'],
  ['uô', 'uə'],
  ['ua', 'uə'],
  ['ươ', 'yə'],
  ['ưa', 'yə'],
  ['oo', 'ɔ'],
  ['a', 'aː'],
  ['ă', 'a'],
  ['â', 'ə'],
  ['e', 'ɛ'],
  ['ê', 'e'],
  ['i', 'i'],
  ['y', 'i'],
  ['o', 'ɔ'],
  ['ô', 'o'],
  ['ơ', 'əː'],
  ['u', 'u'],
  ['ư', 'y'],
];

const VOWELS = new Set([...'aăâeêioôơuưy']);

// A syllable's spelling, split. Returns null when the word is not a Vietnamese syllable.
function parse(base: string): { onset: string; glide: boolean; nucleus: string; coda: string } | null {
  let rest = base;
  let onset = '';
  let glide = false;

  if (rest.startsWith('qu') && rest.length > 2 && VOWELS.has(rest[2]!)) {
    onset = 'k';
    rest = rest.slice(2);
    // quốc, quôc: espeak-ng reads the "u" as part of the uô nucleus, not as a glide.
    if (rest.startsWith('ô')) rest = 'u' + rest;
    else glide = true;
  } else if (rest.startsWith('gi') && rest.length > 2 && VOWELS.has(rest[2]!)) {
    onset = 'z';
    // giếng, giết: the "i" also starts the iê nucleus.
    rest = rest[2] === 'ê' ? rest.slice(1) : rest.slice(2);
  } else if (rest.startsWith('gi')) {
    onset = 'z'; // gì, gìn: g + i
    rest = rest.slice(1);
  } else {
    for (const [spell, ipa] of ONSETS) {
      if (rest.startsWith(spell)) {
        onset = ipa;
        rest = rest.slice(spell.length);
        break;
      }
    }
  }

  // Glides: o before a/ă/e, u before ê/y/â/ơ (but not the ua/uô/ươ nuclei).
  if (!glide && rest.length > 1) {
    if (rest[0] === 'o' && 'aăe'.includes(rest[1]!)) glide = true;
    else if (rest[0] === 'u' && 'êyâơ'.includes(rest[1]!)) glide = true;
    if (glide) rest = rest.slice(1);
  }

  for (const [spell] of NUCLEI) {
    if (rest.startsWith(spell)) {
      const nucleus = spell;
      const coda = rest.slice(spell.length);
      // k only in place names (Đắk Lắk); read as c.
      if (!/^(|m|n|ng|nh|p|t|c|k|ch|i|y|o|u)$/.test(coda)) return null;
      return { onset, glide, nucleus, coda };
    }
  }
  return null;
}

function nucleusIpa(nucleus: string, coda: string): string {
  const hasCoda = coda !== '';
  switch (nucleus) {
    case 'ia':
    case 'ya':
      return 'iə';
    case 'iê':
    case 'yê':
      return hasCoda ? 'iɛ' : 'iə';
    case 'ua':
    case 'uô':
      return 'uə';
    case 'ưa':
    case 'ươ':
      return 'yə';
  }
  // a before y/u is short (ay, au); anh/ach is read "e-".
  if (nucleus === 'a' && (coda === 'y' || coda === 'u')) return 'a';
  if (nucleus === 'a' && (coda === 'nh' || coda === 'ch')) return 'e-';
  if (nucleus === 'ư' && coda === 'u') return 'i'; // ưu -> iw
  return NUCLEI.find(([s]) => s === nucleus)![1];
}

function codaIpa(nucleusIpaValue: string, coda: string): string {
  switch (coda) {
    case '':
      return '';
    case 'm':
      return 'm';
    case 'n':
      return 'n';
    case 'ng':
      return 'ŋ';
    case 'nh':
      return 'ɲ';
    case 'p':
      return 'p';
    case 't':
      return 't̪';
    case 'c':
    case 'k':
      return nucleusIpaValue === 'ɔ' || nucleusIpaValue === 'o' ? 'k' : 'c';
    case 'ch':
      return 'c';
    case 'i':
    case 'y':
      return 'j';
    case 'o':
    case 'u':
      return 'w';
  }
  return '';
}

/** One syllable (a whitespace-free run of letters) to IPA, or null if it is not a Vietnamese syllable. */
export function syllableToIpa(word: string): string | null {
  const nfd = word.toLowerCase().normalize('NFD');
  let tone = '';
  let stripped = '';
  for (const ch of nfd) {
    const t = TONE_MARKS[ch];
    if (t) tone = t;
    else stripped += ch;
  }
  const base = stripped.normalize('NFC');
  const p = parse(base);
  if (!p) return null;

  let nuc = nucleusIpa(p.nucleus, p.coda);
  let coda = codaIpa(nuc, p.coda);
  // ây is one unit (əɪ): the tone follows it.
  if (p.nucleus === 'â' && p.coda === 'y') {
    nuc = 'əɪ';
    coda = '';
  }
  if (tone === '' && ((p.nucleus === 'â' && p.coda === 'u') || (p.nucleus === 'ê' && p.coda === 'u'))) tone = '1';

  const stress = UNSTRESSED.has(word.toLowerCase().normalize('NFC')) ? 'ˌ' : 'ˈ';
  return p.onset + (p.glide ? 'w' : '') + stress + nuc + tone + coda;
}

// ---------- numbers ----------

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function readTriple(n: number, full: boolean): string[] {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const out: string[] = [];
  if (full || h > 0) out.push(DIGITS[h]!, 'trăm');
  if (t === 0) {
    if (u > 0 && out.length > 0) out.push('linh', DIGITS[u]!);
    else if (u > 0) out.push(DIGITS[u]!);
  } else if (t === 1) {
    out.push('mười');
    if (u === 5) out.push('lăm');
    else if (u > 0) out.push(DIGITS[u]!);
  } else {
    out.push(DIGITS[t]!, 'mươi');
    if (u === 1) out.push('mốt');
    else if (u === 4) out.push('tư');
    else if (u === 5) out.push('lăm');
    else if (u > 0) out.push(DIGITS[u]!);
  }
  return out;
}

/** A non-negative integer as Vietnamese words (Northern usage). Above 999 tỷ it reads digit by digit. */
export function numberToWords(n: number): string {
  if (n === 0) return 'không';
  if (n >= 1e12 || !Number.isSafeInteger(n)) return [...String(n)].map((d) => DIGITS[Number(d)]).join(' ');
  const units = ['', 'nghìn', 'triệu', 'tỷ'];
  const groups: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) groups.push(x % 1000);
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (g === 0) continue;
    // Inner groups read their hundreds: 2.050 = hai nghìn không trăm năm mươi.
    words.push(...readTriple(g, i < groups.length - 1));
    if (units[i]) words.push(units[i]!);
  }
  return words.join(' ');
}

// Fraction digits: as a number ("ba phẩy mười bốn"), digit by digit when they start with 0.
const readFraction = (d: string) => (d.startsWith('0') ? [...d].map((x) => DIGITS[Number(x)]).join(' ') : numberToWords(Number(d)));

/**
 * Replaces numbers and "%" by Vietnamese words. "2.500.000" uses "." as the thousands separator; "3,14" is a decimal
 * (phẩy); "1.5" (a dot not followed by three digits) is read with "chấm".
 */
export function expandNumbers(text: string): string {
  return text
    .replace(/(\d{1,3}(?:\.\d{3})+(?!\d)|\d+(?:\.\d+)?)(?:,(\d+))?/g, (_m, int: string, dec: string | undefined) => {
      let s: string;
      if (/^\d{1,3}(\.\d{3})+$/.test(int)) s = numberToWords(Number(int.replace(/\./g, '')));
      else {
        const [whole, frac] = int.split('.');
        s = numberToWords(Number(whole));
        if (frac) s += ' chấm ' + readFraction(frac);
      }
      if (dec) s += ' phẩy ' + readFraction(dec);
      return s;
    })
    .replace(/\s*%/g, ' phần trăm');
}

// ---------- text ----------

const CLAUSE_PUNCT = new Set([',', ':', ';']);
const SENTENCE_PUNCT = new Set(['.', '?', '!']);
const LETTER = /[\p{L}\p{M}]/u;

export type Options = {
  /**
   * Reads a word that is not a Vietnamese syllable (a loanword like "internet", "vitamin"). espeak-ng reads these with
   * its English voice, so the product passes its English G2P here. Return null to use the built-in fallback.
   */
  foreign?: (word: string) => string | null;
};

/** Words and clause punctuation, after number expansion. */
export function phonemizeWords(text: string, opts: Options = {}): Token[] {
  const src = expandNumbers(text.normalize('NFC'));
  const tokens: Token[] = [];
  const re = /[\p{L}\p{M}]+|[.,:;?!]+|\s+|./gu;
  for (const m of src.matchAll(re)) {
    const s = m[0];
    if (LETTER.test(s[0]!)) {
      const ipa = syllableToIpa(s);
      if (ipa) tokens.push({ kind: 'word', text: s, syllables: [ipa] });
      else {
        const f = opts.foreign?.(s) ?? fallback(s);
        if (f) tokens.push({ kind: 'word', text: s, syllables: [f] });
      }
    } else if (CLAUSE_PUNCT.has(s[0]!) || SENTENCE_PUNCT.has(s[0]!)) {
      // "..." and "?!" act as their last mark.
      tokens.push({ kind: 'punct', text: s[s.length - 1]! });
    }
  }
  return tokens;
}

// Built-in reading of a non-Vietnamese word: split it into consonants+vowels chunks ("vi-ta-min") and read each with
// the Vietnamese rules, dropping consonants Vietnamese cannot end a syllable with. Rough, but never silent.
function fallback(word: string): string {
  const chunks = word.toLowerCase().match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy]+$|[^aeiouy](?=[^aeiouy]))?/g) ?? [word];
  const out: string[] = [];
  for (const c of chunks) {
    let ipa = syllableToIpa(c);
    for (let cut = c; !ipa && cut.length > 1; ) {
      cut = cut.slice(0, -1);
      ipa = syllableToIpa(cut);
    }
    if (ipa) out.push(ipa);
  }
  return out.join('');
}

/** Text to Piper phoneme strings, one per sentence (split after . ? !). */
export function phonemize(text: string, opts: Options = {}): string[] {
  const sentences: string[] = [];
  let cur = '';
  for (const t of phonemizeWords(text, opts)) {
    if (t.kind === 'word') {
      if (cur !== '' && !cur.endsWith(' ')) cur += ' ';
      cur += t.syllables.join(' ');
    } else {
      cur = cur.trimEnd() + t.text;
      if (CLAUSE_PUNCT.has(t.text)) cur += ' ';
      if (SENTENCE_PUNCT.has(t.text)) {
        sentences.push(cur);
        cur = '';
      }
    }
  }
  if (cur.trim() !== '') sentences.push(cur.trimEnd());
  return sentences;
}

/** Piper input ids for one sentence: BOS, each codepoint (NFD) followed by the pad id, EOS. Unknown symbols are dropped. */
export function phonemeIds(ipa: string, idMap: Record<string, number[]>): number[] {
  const pad = idMap['_']![0]!;
  const ids = [idMap['^']![0]!, pad];
  for (const ch of ipa.normalize('NFD')) {
    const id = idMap[ch];
    if (!id) continue;
    ids.push(...id, pad);
  }
  ids.push(idMap['$']![0]!);
  return ids;
}
