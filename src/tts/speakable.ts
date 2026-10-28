// Speakable text, rule-based (no LLM): numbers, dates, percentages, money and common
// abbreviations written out the way a Vietnamese or English reader says them, URLs dropped, then
// the text split into sentences and clauses so a voice pauses where a reader would. Pure and
// dependency-free; the system voice uses only this, cloud voices may get an LLM pass
// first (prepare.ts) and fall back to this.

/** Clauses longer than this are split again at commas, semicolons, colons and dashes. */
export const MAX_CLAUSE_CHARS = 200;

type Lang = 'vi' | 'en' | 'other';

const primary = (lang: string): Lang => {
  const p = lang.trim().toLowerCase().split(/[-_]/)[0];
  return p === 'vi' ? 'vi' : p === 'en' ? 'en' : 'other';
};

// ---- Vietnamese numbers --------------------------------------------------------------------------

/** A word from a table, '' past its end (an index the rules never produce). */
const at = (table: readonly string[], i: number) => table[i] ?? '';

const VI_DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const VI_GROUPS = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];

/** 0–999; `full` reads leading zeros ("không trăm lẻ năm") as a group after a larger one does. */
function viTriple(n: number, full: boolean): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const out: string[] = [];
  if (h > 0 || full) out.push(at(VI_DIGITS, h), 'trăm');
  if (t === 0) {
    if (u > 0) {
      if (out.length > 0) out.push('lẻ');
      out.push(at(VI_DIGITS, u));
    }
  } else {
    out.push(t === 1 ? 'mười' : `${VI_DIGITS[t]} mươi`);
    if (u === 1) out.push(t === 1 ? 'một' : 'mốt');
    else if (u === 4) out.push(t === 1 ? 'bốn' : 'tư');
    else if (u === 5) out.push('lăm');
    else if (u > 0) out.push(at(VI_DIGITS, u));
  }
  return out.join(' ');
}

function viInteger(n: number): string {
  if (n === 0) return 'không';
  const groups: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) groups.push(x % 1000);
  const out: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i] ?? 0;
    if (g === 0) continue;
    out.push(viTriple(g, i < groups.length - 1));
    if (VI_GROUPS[i]) out.push(at(VI_GROUPS, i));
  }
  return out.join(' ');
}

// ---- English numbers -----------------------------------------------------------------------------

const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_GROUPS = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion'];

function enBelow100(n: number): string {
  if (n < 20) return at(EN_ONES, n);
  const u = n % 10;
  return u ? `${EN_TENS[Math.floor(n / 10)]}-${EN_ONES[u]}` : at(EN_TENS, Math.floor(n / 10));
}

function enTriple(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const out: string[] = [];
  if (h) out.push(at(EN_ONES, h), 'hundred');
  if (r) out.push(enBelow100(r));
  return out.join(' ');
}

function enInteger(n: number): string {
  if (n === 0) return 'zero';
  const groups: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) groups.push(x % 1000);
  const out: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i] ?? 0;
    if (!g) continue;
    out.push(enTriple(g));
    if (EN_GROUPS[i]) out.push(at(EN_GROUPS, i));
  }
  return out.join(' ');
}

/** A year the way it is said: 1999 "nineteen ninety-nine", 2005 "two thousand five", 2026 "twenty twenty-six". */
function enYear(n: number): string {
  if (n < 1100 || n > 2099 || (n >= 2000 && n < 2010)) return enInteger(n);
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  return lo === 0 ? `${enBelow100(hi)} hundred` : `${enBelow100(hi)} ${lo < 10 ? `oh ${EN_ONES[lo]}` : enBelow100(lo)}`;
}

function enOrdinal(n: number): string {
  const words = enInteger(n);
  const last = /\w+$/.exec(words)?.[0] ?? '';
  const irregular: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
  const ord = irregular[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return words.slice(0, words.length - last.length) + ord;
}

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const VI_MONTHS = ['một', 'hai', 'ba', 'tư', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười', 'mười một', 'mười hai'];

/** Above this, digits are left as they are: no reader says a 16-digit number as words. */
const MAX_WORDS_NUMBER = 999_999_999_999_999;

/** An integer as words, or undefined when it is too large to read as one. */
export function integerWords(n: number, lang: 'vi' | 'en'): string | undefined {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_WORDS_NUMBER) return undefined;
  return lang === 'vi' ? viInteger(n) : enInteger(n);
}

// ---- Number parsing -------------------------------------------------------------------------------

/**
 * Reads a written number in the language's convention: vi "1.250.000" and "3,5", en "1,250,000"
 * and "3.5". A run of 3-digit groups after the other separator is still a thousands grouping
 * ("1,250,000" in Vietnamese text), and a single other separator not before 3 digits is a decimal
 * point written the other way ("1.5 triệu", "1,5"). Undefined when it is not a number this module
 * reads (an IP address, a version): it is then left as written.
 */
function parseNumber(raw: string, lang: 'vi' | 'en'): { int: number; frac?: string } | undefined {
  const thousands = lang === 'vi' ? '.' : ',';
  const decimal = lang === 'vi' ? ',' : '.';
  const grouped = (sep: string) => new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`);
  let int: string;
  let frac: string | undefined;
  if (grouped(thousands).test(raw)) int = raw.split(thousands).join('');
  else if (grouped(decimal).test(raw) && raw.split(decimal).length > 2) int = raw.split(decimal).join('');
  else if (raw.includes(decimal)) {
    const [whole = '', part, ...more] = raw.split(decimal);
    if (part === undefined || more.length > 0) return undefined;
    int = whole.split(thousands).join('');
    frac = part;
  } else if (raw.includes(thousands)) {
    const [whole = '', part, ...more] = raw.split(thousands);
    if (part === undefined || more.length > 0) return undefined;
    int = whole;
    frac = part;
  } else int = raw;
  if (!/^\d+$/.test(int) || (frac !== undefined && !/^\d+$/.test(frac))) return undefined;
  return frac === undefined ? { int: Number(int) } : { int: Number(int), frac };
}

function numberWords(raw: string, lang: 'vi' | 'en'): string | undefined {
  const n = parseNumber(raw, lang);
  if (!n) return undefined;
  const int = integerWords(n.int, lang);
  if (int === undefined) return undefined;
  if (n.frac === undefined) return int;
  if (lang === 'vi') {
    const frac = n.frac.length <= 3 && !n.frac.startsWith('0') ? viInteger(Number(n.frac)) : [...n.frac].map((d) => VI_DIGITS[Number(d)]).join(' ');
    return `${int} phẩy ${frac}`;
  }
  return `${int} point ${[...n.frac].map((d) => EN_ONES[Number(d)]).join(' ')}`;
}

// ---- Abbreviations ----------------------------------------------------------------------------------

// Matched case-sensitively, whole tokens only. Longer forms first (TP.HCM before TP.).
const VI_ABBREVIATIONS: [string, string][] = [
  ['TP.HCM', 'Thành phố Hồ Chí Minh'],
  ['TP. HCM', 'Thành phố Hồ Chí Minh'],
  ['TPHCM', 'Thành phố Hồ Chí Minh'],
  ['TP.', 'thành phố'],
  ['v.v.', 'vân vân'],
  ['v.v', 'vân vân'],
  ['ThS.', 'thạc sĩ'],
  ['TS.', 'tiến sĩ'],
  ['PGS.', 'phó giáo sư'],
  ['GS.', 'giáo sư'],
  ['BS.', 'bác sĩ'],
  ['UBND', 'Ủy ban nhân dân'],
  ['HĐND', 'Hội đồng nhân dân'],
  ['CSGT', 'cảnh sát giao thông'],
  ['THPT', 'trung học phổ thông'],
  ['THCS', 'trung học cơ sở'],
  ['Q.', 'quận'],
  ['P.', 'phường'],
  ['Tp.', 'thành phố'],
];
const EN_ABBREVIATIONS: [string, string][] = [
  ['e.g.', 'for example'],
  ['i.e.', 'that is'],
  ['etc.', 'et cetera'],
  ['vs.', 'versus'],
  ['Dr.', 'Doctor'],
  ['Mr.', 'Mister'],
  ['Mrs.', 'Missus'],
  ['Ms.', 'Miz'],
  ['Prof.', 'Professor'],
  ['St.', 'Saint'],
  ['Jr.', 'Junior'],
  ['Sr.', 'Senior'],
  ['approx.', 'approximately'],
  ['No.', 'number'],
];

const NUMBERED = new Set(['No.', 'Q.', 'P.']);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function expandAbbreviations(text: string, list: [string, string][]): string {
  let out = text;
  for (const [abbr, full] of list) {
    // Not inside a longer word: a letter or digit may not touch either end. "No." needs a number after it.
    // "Q." and "P." (district, ward) only before a number, so an initial in a name ("Nguyễn P. Long") stays.
    const tail = NUMBERED.has(abbr) ? '(?=\\s*\\d)' : abbr.endsWith('.') ? '' : '(?![\\p{L}\\p{N}])';
    // An abbreviation's own dot ends the sentence too when the next word starts one ("..., etc. The").
    // A dot may come before it when it ends another title ("PGS.TS.").
    const re = new RegExp(`(?<![\\p{L}\\p{N}]|[\\p{L}\\p{N}]\\.(?=\\p{Ll}))${escapeRe(abbr)}${tail}`, 'gu');
    out = out.replace(re, (_m, offset: number, whole: string) => {
      const after = whole.slice(offset + abbr.length);
      const endsSentence = abbr.endsWith('.') && /^\s+\p{Lu}/u.test(after) && /^(etc|v\.v)\.$/.test(abbr);
      // "Q.1" → "quận 1": the expansion never runs into the word or number after it.
      return endsSentence ? `${full}.` : /^[\p{L}\p{N}]/u.test(after) ? `${full} ` : full;
    });
  }
  return out;
}

// ---- Normalisation -----------------------------------------------------------------------------------

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/giu;
const NUM = '\\d[\\d.,]*\\d|\\d';

function normalizeVi(text: string): string {
  let t = expandAbbreviations(text, VI_ABBREVIATIONS);
  // Dates: 25/10/2026, 25-10-2026, 25.10.2026; a day and month alone only after "ngày" (a bare 1/2 is a fraction).
  const date = (m: string, ngay: string | undefined, d: string, mo: string, y?: string) => {
    const day = Number(d);
    const month = Number(mo);
    if (day < 1 || day > 31 || month < 1 || month > 12) return m;
    const out = `${ngay?.startsWith('N') ? 'Ngày' : 'ngày'} ${viInteger(day)} tháng ${VI_MONTHS[month - 1]}`;
    return y ? `${out} năm ${viInteger(Number(y))}` : out;
  };
  t = t.replace(/(?:\b([Nn]gày)\s+)?\b(\d{1,2})([/.-])(\d{1,2})\3(\d{4})\b/g, (m, ngay: string | undefined, d: string, _s: string, mo: string, y: string) => date(m, ngay, d, mo, y));
  t = t.replace(/\b([Nn]gày)\s+(\d{1,2})\/(\d{1,2})\b/g, (m, ngay: string, d: string, mo: string) => date(m, ngay, d, mo));
  t = t.replace(new RegExp(`(${NUM})\\s?%`, 'g'), (m, n: string) => (numberWords(n, 'vi') ?? n) + ' phần trăm');
  t = t.replace(new RegExp(`(${NUM})\\s?(?:₫|đ|VNĐ|VND|đồng)(?![\\p{L}])`, 'gu'), (m, n: string) => (numberWords(n, 'vi') ?? n) + ' đồng');
  t = t.replace(new RegExp(`(${NUM})\\s?(?:USD|\\$)`, 'g'), (m, n: string) => (numberWords(n, 'vi') ?? n) + ' đô la');
  t = t.replace(new RegExp(`\\$\\s?(${NUM})`, 'g'), (m, n: string) => (numberWords(n, 'vi') ?? n) + ' đô la');
  return t.replace(new RegExp(`(?<![\\p{L}])(${NUM})(?![\\p{L}])`, 'gu'), (m, n: string) => numberWords(n, 'vi') ?? m);
}

function normalizeEn(text: string): string {
  let t = expandAbbreviations(text, EN_ABBREVIATIONS);
  // Dates: day/month/year when the first part can only be a day, else month/day/year (en-US).
  t = t.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m, a: string, b: string, y: string) => {
    let [month, day] = [Number(a), Number(b)];
    if (month > 12) [month, day] = [day, month];
    if (day < 1 || day > 31 || month < 1 || month > 12) return m;
    return `${EN_MONTHS[month - 1]} ${enOrdinal(day)}, ${enYear(Number(y))}`;
  });
  t = t.replace(new RegExp(`(${NUM})\\s?%`, 'g'), (m, n: string) => (numberWords(n, 'en') ?? n) + ' percent');
  // "$1.50": dollars and cents.
  t = t.replace(/\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\b(?!\s(?:thousand|million|billion|trillion)\b)/g, (m, d: string, c: string) => {
    const dollars = numberWords(d, 'en');
    const cents = Number(c);
    if (dollars === undefined) return m;
    const dPart = `${dollars} ${dollars === 'one' ? 'dollar' : 'dollars'}`;
    return cents === 0 ? dPart : `${dPart} and ${enBelow100(cents)} ${cents === 1 ? 'cent' : 'cents'}`;
  });
  t = t.replace(new RegExp(`\\$\\s?(${NUM})(\\s(?:thousand|million|billion|trillion)\\b)?`, 'g'), (m, n: string, scale?: string) => {
    const words = (numberWords(n, 'en') ?? n) + (scale ?? '');
    return `${words} ${words === 'one' ? 'dollar' : 'dollars'}`;
  });
  t = t.replace(new RegExp(`(${NUM})\\s?(?:₫|VND)`, 'g'), (m, n: string) => (numberWords(n, 'en') ?? n) + ' dong');
  // A year in running text ("in 2026") reads as a year.
  t = t.replace(/\b(in|since|by|from|until|of)\s(1[1-9]\d\d|20\d\d)\b/g, (m, w: string, y: string) => `${w} ${enYear(Number(y))}`);
  return t.replace(new RegExp(`(?<![\\p{L}])(${NUM})(?![\\p{L}])`, 'gu'), (m, n: string) => numberWords(n, 'en') ?? m);
}

/** The text with URLs dropped and, for vi and en, numbers, dates, money and abbreviations written out. */
export function normalize(text: string, lang: string): string {
  const l = primary(lang);
  let t = text.replace(URL_RE, ' ');
  if (l === 'vi') t = normalizeVi(t);
  else if (l === 'en') t = normalizeEn(t);
  return t.replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

// ---- Splitting ----------------------------------------------------------------------------------------

const CLOSERS = `"'”’»)]}`;

/**
 * Sentences, split after . ! ? … (and CJK 。！？) when the next word starts a sentence, keeping
 * closing quotes and brackets with the sentence they close. A single-letter initial ("J. Smith",
 * "U.S. Army") and an ellipsis before a lower-case word do not end one. A line break always does.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    let start = 0;
    let i = 0;
    while (i < line.length) {
      const ch = line.charAt(i);
      if ('。！？'.includes(ch)) {
        let end = i + 1;
        while (end < line.length && CLOSERS.includes(line.charAt(end))) end++;
        out.push(line.slice(start, end));
        start = i = end;
        continue;
      }
      if (!'.!?…'.includes(ch)) {
        i++;
        continue;
      }
      let end = i;
      while (end < line.length && '.!?…'.includes(line.charAt(end))) end++;
      while (end < line.length && CLOSERS.includes(line.charAt(end))) end++;
      const rest = line.slice(end);
      const next = /^\s+(\S)/u.exec(rest)?.[1];
      // An initial is one capital letter ("J. Smith"); a one-letter word such as Vietnamese "ạ" ends a sentence.
      const initial = ch === '.' && end === i + 1 && /(^|[\s(.])\p{Lu}$/u.test(line.slice(0, i));
      const startsSentence = next !== undefined && /[\p{Lu}\p{N}"'“‘«([]/u.test(next);
      if (end >= line.length || (startsSentence && !initial)) {
        out.push(line.slice(start, end));
        start = end;
      }
      i = end;
    }
    out.push(line.slice(start));
  }
  return out.map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/** A long sentence cut at its last comma, semicolon, colon or dash before `max`, or at a space. */
function splitLong(sentence: string, max: number): string[] {
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const head = rest.slice(0, max);
    let cut = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(': '), head.lastIndexOf(' — '), head.lastIndexOf(' – '));
    cut = cut > max / 4 ? cut + 1 : head.lastIndexOf(' ');
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Clauses to read one at a time: sentences, with any longer than `max` split again. */
export function splitClauses(text: string, max = MAX_CLAUSE_CHARS): string[] {
  return splitSentences(text).flatMap((s) => (s.length > max ? splitLong(s, max) : [s]));
}

/** normalize then splitClauses: what a voice reads, clause by clause. */
export function speakable(text: string, lang: string, max = MAX_CLAUSE_CHARS): string[] {
  return splitClauses(normalize(text, lang), max);
}
