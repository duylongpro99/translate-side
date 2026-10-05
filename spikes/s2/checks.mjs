// Post-parse checks shared by run.mjs and analyze.mjs (DESIGN §5.7 step 4, the parts S2 measures).
const BACKTICK = /`[^`]*`/g;
const cnt = (s, re) => (s.match(re) ?? []).length;
// Inline markers kept? [link]…[/link] counts, backtick spans byte-identical (as a multiset), ** counts.
export function markerCheck(srcText, out) {
  const issues = [];
  if (cnt(srcText, /\[link\]/g) !== cnt(out, /\[link\]/g) || cnt(srcText, /\[\/link\]/g) !== cnt(out, /\[\/link\]/g)) issues.push('link');
  const a = (srcText.match(BACKTICK) ?? []).sort(), b = (out.match(BACKTICK) ?? []).sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) issues.push('backtick');
  if (cnt(srcText, /\*\*/g) !== cnt(out, /\*\*/g)) issues.push('strong');
  if (/<(code|strong|em|a)\b/i.test(out) && !/<(code|strong|em|a)\b/i.test(srcText)) issues.push('html');
  return issues;
}
// Output identical to a source with at least two longer words: "untranslated" (often right: names, lorem ipsum).
export const isUntranslated = (src, out) => out.trim() === src.trim() && /[a-z]{4,}.*\s.*[a-z]{4,}/i.test(src);
