// Post-checks (DESIGN.md §5.7 Step 4, plan M2-E4, user decision M2-D19): cheap, local checks of a
// final translation against its SOURCE (the segment's `inlineMarkup`), never against an earlier
// revision. Each failing check gives a reason; the check stage (stages/check.ts) re-requests the
// failing segments once, then fails them.
//
//   markers    inline markers well-formed: `[link]…[/link]` paired in order and exactly as many
//              as the source's (the panel maps them to the page's links); emphasis asterisks
//              (outside code spans) and backtick spans no fewer than the source's, and paired.
//              More are allowed: a first-use gloss repeats a marked term ("*giai đoạn* (*stages*)").
//              Spans nest, never cross: "*a [link]b* c[/link]" fails unless the source crosses
//              the same way (no more crossings than the source's)
//   code       every distinct backtick span of the source, byte-identical, at least once ("To
//              `panic!` or Not to `panic!`" may come back with one)
//   url        every URL of the source (outside code spans), byte-identical
//   number     every number of the source (outside code spans and URLs), digits identical;
//              separators may be localised (below)
//   length     the translation is not empty or runaway against its source (thresholds below)
//   script     no letters of a script that is neither the target language's nor in the source
//              (e.g. CJK in Vietnamese)
//   duplicate  (document level, checkDocument) the translation copies a neighbouring segment's
//              translation while the sources differ (duplicate.ts)
//
// Numbers: a run of digits with single `.`, `,`, NBSP, narrow NBSP or `'` between digit groups
// ("1,000.5", "1.000,5", "1 000") is read as values (numberValues). A separator followed by
// exactly three digits groups thousands; one other `.` or `,`, the last, is the decimal point;
// with more than one other separator the run is a list or a version ("1,2,3", "1.2.10") and each
// group is a value. So thousand and decimal separators may be localised ("3.5" = "3,5", "1,000" =
// "1.000", "1,000.5" = "1.000,5"), but "3.5" ≠ "35" and "1,2,3" is 1, 2 and 3 (review D-N4). A
// value may come back fewer or more times. Numbers are never required to be spelled out or
// converted; a number written as words, in Roman numerals or with its digits changed fails.
// Digits inside a word ("utf8", "x86_64") count too: they are not translated either.
//
// Length (chars of the translation over chars of the source, markers included; review D-N5): the
// bounds depend on whether each side is written in a dense script (Chinese, Japanese, Korean: a
// character carries about a word's share of meaning). The source's side is read from its text (at
// least DENSE_SHARE of its letters Han, kana or Hangul), the target's from its language (zh, ja,
// ko). It fails when the translation is empty; when the source has at least the minimum length
// and the ratio is below the floor; or when the translation is longer than max × source +
// LENGTH_SLACK_CHARS (room for a short heading's first-use gloss).
//
//   source → target        min source chars   floor   max
//   sparse → sparse               20           0.25     3    calibrated: en→vi ran 0.6–2.4 (M1, M2 eval outputs)
//   sparse → dense                20           0.1      3    zh/ja/ko text ~0.3–0.6× English
//   dense  → sparse               10           0.5      8    English ~2–4× Chinese/Japanese chars
//   dense  → dense                10           0.25     3
//
// The dense rows are estimates from typical character ratios, not calibrated: the eval set has
// no CJK source yet.

import { copiesNeighbour, type Rendered } from '../parsing/duplicate.ts';

export type CheckKind = 'markers' | 'code' | 'url' | 'number' | 'length' | 'script' | 'duplicate';

export interface CheckFailure {
  kind: CheckKind;
  /** Short, for logs and the failure's `raw`: what is missing or wrong. */
  detail: string;
}

export interface LengthBounds {
  /** Below this many source characters a short ratio is not judged (labels, "OK", numbers). */
  minSourceChars: number;
  floor: number;
  max: number;
}

/** The table above, by `${source}-${target}` density. */
export const LENGTH_BOUNDS: Record<'sparse-sparse' | 'sparse-dense' | 'dense-sparse' | 'dense-dense', LengthBounds> = {
  'sparse-sparse': { minSourceChars: 20, floor: 0.25, max: 3 },
  'sparse-dense': { minSourceChars: 20, floor: 0.1, max: 3 },
  'dense-sparse': { minSourceChars: 10, floor: 0.5, max: 8 },
  'dense-dense': { minSourceChars: 10, floor: 0.25, max: 3 },
};
export const LENGTH_SLACK_CHARS = 80;
/** A source is dense when at least this share of its letters (outside code) are Han, kana or Hangul. */
export const DENSE_SHARE = 0.3;

const CODE_SPAN = /`[^`]+`/g;
/** http(s) and www. URLs up to whitespace, a marker or a quote; trailing punctuation is not part of them. */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`[\]]+/gi;
const TRAILING = /[.,;:!?)\]}'"»]$/;
const NUMBER = /\d+(?:[.,\u00a0\u202f'\u2019]\d+)*/g;

/** The backtick spans of `text`, in order, backticks included. */
export function codeSpans(text: string): string[] {
  return text.match(CODE_SPAN) ?? [];
}

/** `text` with its backtick spans blanked (one space each), so other checks never look inside code. */
export function withoutCode(text: string): string {
  return text.replace(CODE_SPAN, ' ');
}

/** The URLs of `text` outside code spans, trailing punctuation (and an unmatched `)`) cut. */
export function urls(text: string): string[] {
  return (withoutCode(text).match(URL_RE) ?? []).map(trimUrl);
}

function trimUrl(url: string): string {
  let u = url;
  while (TRAILING.test(u)) {
    // A `)` that closes a parenthesis inside the URL stays ("…/Rust_(language)").
    if (u.endsWith(')') && (u.match(/\(/g) ?? []).length >= (u.match(/\)/g) ?? []).length) return u;
    u = u.slice(0, -1);
  }
  return u;
}

/** The numbers of `text` outside code spans and URLs, as values ("1,000.5" → "1000.5", "1,2,3" → 1, 2, 3). */
export function numbers(text: string): string[] {
  let rest = withoutCode(text);
  for (const u of urls(text)) rest = rest.split(u).join(' ');
  return (rest.match(NUMBER) ?? []).flatMap(numberValues);
}

/** One run of digits and separators as its values (see the top of the file). */
export function numberValues(run: string): string[] {
  const parts = run.split(/([.,\u00a0\u202f'\u2019])/);
  const groups = parts.filter((_, i) => i % 2 === 0);
  const seps = parts.filter((_, i) => i % 2 === 1);
  // Separator i stands between groups i and i + 1.
  const other = seps.flatMap((_, i) => (groups[i + 1]?.length === 3 ? [] : [i]));
  if (other.length === 0) return [groups.join('')];
  const last = seps.length - 1;
  if (other.length === 1 && other[0] === last && /[.,]/.test(seps[last] ?? '')) return [`${groups.slice(0, -1).join('')}.${groups.at(-1) ?? ''}`];
  const out: string[] = [];
  let cur = groups[0] ?? '';
  seps.forEach((_, i) => {
    if (other.includes(i)) {
      out.push(cur);
      cur = '';
    }
    cur += groups[i + 1] ?? '';
  });
  return [...out, cur];
}

/** Inline markers of a text, outside code spans: links, emphasis, backtick spans. */
export function markerCounts(text: string): { code: number; link: number; emphasis: number } {
  const plain = withoutCode(text);
  const count = (re: RegExp) => plain.match(re)?.length ?? 0;
  return { code: codeSpans(text).length, link: count(/\[link\][\s\S]*?\[\/link\]/g), emphasis: count(/\*\*[^*]+\*\*|\*[^*]+\*/g) };
}

/** `[link]`/`[/link]` alternate, starting with an open, and every open closes. */
function linksPaired(text: string): boolean {
  let open = false;
  for (const m of withoutCode(text).matchAll(/\[(\/?)link\]/g)) {
    const closing = m[1] === '/';
    if (closing !== open) return false;
    open = !closing;
  }
  return !open;
}

/** How many pairs of spans cross ("*a [link]b* c[/link]"): links paired in order, `**` and `*` each paired in turn, outside code. */
export function crossings(text: string): number {
  const spans: [number, number][] = [];
  const open: Record<string, number | undefined> = {};
  for (const m of withoutCode(text).matchAll(/\[\/?link\]|\*\*|\*/g)) {
    const key = m[0] === '[/link]' ? '[link]' : m[0];
    const at = m.index ?? 0;
    const start = open[key];
    if (start === undefined) {
      if (m[0] !== '[/link]') open[key] = at;
    } else if (m[0] !== '[link]') {
      spans.push([start, at]);
      open[key] = undefined;
    }
  }
  let n = 0;
  for (const [i, a] of spans.entries()) for (const b of spans.slice(i + 1)) if ((a[0] < b[0] && b[0] < a[1] && a[1] < b[1]) || (b[0] < a[0] && a[0] < b[1] && b[1] < a[1])) n++;
  return n;
}

const asterisks = (text: string) => (withoutCode(text).match(/\*/g) ?? []).length;

const short = (s: string) => (s.length > 40 ? `${s.slice(0, 37)}…` : s);

export function checkMarkers(source: string, translation: string): CheckFailure | undefined {
  const a = markerCounts(source);
  const b = markerCounts(translation);
  if (!linksPaired(translation) && linksPaired(source)) return { kind: 'markers', detail: 'unpaired [link] markers' };
  // Links map to the page's links in order (the panel), so exactly as many.
  if (a.link !== b.link) return { kind: 'markers', detail: `${b.link} links for ${a.link}` };
  if (crossings(translation) > crossings(source)) return { kind: 'markers', detail: 'crossed markers' };
  // Emphasis and code may be repeated (a first-use gloss "*giai đoạn* (*stages*)"), not lost.
  const sa = asterisks(source);
  const ta = asterisks(translation);
  if (ta < sa) return { kind: 'markers', detail: `${ta} emphasis asterisks for ${sa}` };
  if (ta % 2 !== sa % 2) return { kind: 'markers', detail: 'an unpaired emphasis asterisk' };
  if (b.code < a.code && new Set(codeSpans(translation)).size < new Set(codeSpans(source)).size) return { kind: 'markers', detail: `${b.code} code spans for ${a.code}` };
  if ((translation.match(/`/g) ?? []).length % 2 !== 0 && (source.match(/`/g) ?? []).length % 2 === 0) return { kind: 'markers', detail: 'an unclosed backtick' };
  return undefined;
}

export function checkCode(source: string, translation: string): CheckFailure | undefined {
  // Each distinct span at least once: "To `panic!` or Not to `panic!`" may become one `panic!`.
  const have = new Set(codeSpans(translation));
  for (const span of new Set(codeSpans(source))) if (!have.has(span)) return { kind: 'code', detail: `missing ${short(span)}` };
  return undefined;
}

export function checkUrls(source: string, translation: string): CheckFailure | undefined {
  // Byte-identical, anywhere in the translation (the model may move it, or code-span it).
  for (const u of new Set(urls(source))) if (!translation.includes(u)) return { kind: 'url', detail: `missing ${short(u)}` };
  return undefined;
}

export function checkNumbers(source: string, translation: string): CheckFailure | undefined {
  const have = new Set(numbers(translation));
  for (const n of new Set(numbers(source))) if (!have.has(n)) return { kind: 'number', detail: `missing ${n}` };
  return undefined;
}

const DENSE_TARGET = /^(zh|ja|ko)\b/i;
const DENSE_LETTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

/** Whether `text` is written mostly in a dense script (Han, kana, Hangul), by its letters outside code. */
export function isDense(text: string): boolean {
  const plain = withoutCode(text);
  const letters = plain.match(/\p{L}/gu)?.length ?? 0;
  return letters > 0 && (plain.match(DENSE_LETTER)?.length ?? 0) / letters >= DENSE_SHARE;
}

/** The length bounds for `source` translated into `targetLang`. */
export function lengthBounds(source: string, targetLang: string): LengthBounds {
  return LENGTH_BOUNDS[`${isDense(source) ? 'dense' : 'sparse'}-${DENSE_TARGET.test(targetLang) ? 'dense' : 'sparse'}`];
}

export function checkLength(source: string, translation: string, targetLang: string): CheckFailure | undefined {
  const s = source.trim().length;
  const t = translation.trim().length;
  if (t === 0) return s === 0 ? undefined : { kind: 'length', detail: 'empty' };
  const { minSourceChars, floor, max } = lengthBounds(source, targetLang);
  if (s >= minSourceChars && t / s < floor) return { kind: 'length', detail: `ratio ${(t / s).toFixed(2)} below ${floor}` };
  if (t > max * s + LENGTH_SLACK_CHARS) return { kind: 'length', detail: `ratio ${(t / s).toFixed(2)} runaway` };
  return undefined;
}

/** Scripts the wrong-script check knows. Latin and Greek (maths) are never flagged. */
const SCRIPTS: Record<string, RegExp> = {
  Han: /\p{Script=Han}/u,
  Hiragana: /\p{Script=Hiragana}/u,
  Katakana: /\p{Script=Katakana}/u,
  Hangul: /\p{Script=Hangul}/u,
  Cyrillic: /\p{Script=Cyrillic}/u,
  Arabic: /\p{Script=Arabic}/u,
  Hebrew: /\p{Script=Hebrew}/u,
  Thai: /\p{Script=Thai}/u,
  Devanagari: /\p{Script=Devanagari}/u,
};

/** The scripts a target language is written in, among SCRIPTS (Latin-script languages: none). */
export const TARGET_SCRIPTS: Record<string, readonly string[]> = {
  zh: ['Han'],
  ja: ['Han', 'Hiragana', 'Katakana'],
  ko: ['Hangul', 'Han'],
  ru: ['Cyrillic'],
  uk: ['Cyrillic'],
  bg: ['Cyrillic'],
  sr: ['Cyrillic'],
  ar: ['Arabic'],
  fa: ['Arabic'],
  ur: ['Arabic'],
  he: ['Hebrew'],
  th: ['Thai'],
  hi: ['Devanagari'],
  mr: ['Devanagari'],
  ne: ['Devanagari'],
};

/** The script letters of `text` outside code spans: the first character of each script found. */
function scriptsIn(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const ch of withoutCode(text)) {
    for (const [name, re] of Object.entries(SCRIPTS)) if (!out.has(name) && re.test(ch)) out.set(name, ch);
  }
  return out;
}

export function checkScript(source: string, translation: string, targetLang: string): CheckFailure | undefined {
  const allowed = new Set(TARGET_SCRIPTS[targetLang.toLowerCase().split('-')[0] ?? ''] ?? []);
  const inSource = scriptsIn(source);
  for (const [name, ch] of scriptsIn(translation)) {
    if (!allowed.has(name) && !inSource.has(name)) return { kind: 'script', detail: `${name} text (${ch})` };
  }
  return undefined;
}

/** Every per-segment check of `translation` against `source`, in a fixed order. */
export function checkSegment(source: string, translation: string, targetLang: string): CheckFailure[] {
  return [
    checkLength(source, translation, targetLang),
    checkMarkers(source, translation),
    checkCode(source, translation),
    checkUrls(source, translation),
    checkNumbers(source, translation),
    checkScript(source, translation, targetLang),
  ].filter((f): f is CheckFailure => f !== undefined);
}

/** How many translated segments on each side a translation is compared with by the duplicate check. */
export const DUPLICATE_WINDOW = 2;

export interface CheckedSegment {
  id: string;
  source: string;
  translation: string;
}

/**
 * The document-level neighbour-duplicate check over translated segments in page order: a
 * translation that copies one of the DUPLICATE_WINDOW translations before it (sources differing,
 * duplicate.ts) fails; of a pair, the later one, which is where a copy lands (a tail sent without
 * its translation, a segment answered with its predecessor's text). Ids → failure.
 */
export function checkDuplicates(segments: readonly CheckedSegment[]): Map<string, CheckFailure> {
  const out = new Map<string, CheckFailure>();
  segments.forEach((s, i) => {
    const before: Rendered[] = segments.slice(Math.max(0, i - DUPLICATE_WINDOW), i).map((o) => ({ source: o.source, translation: o.translation }));
    if (copiesNeighbour(s.source, s.translation, before)) out.set(s.id, { kind: 'duplicate', detail: 'copies a neighbouring translation' });
  });
  return out;
}
