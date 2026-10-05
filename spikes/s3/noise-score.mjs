// B1: noise judged on the actual output against the hand-checked list in noise.json (independent of the walk's rules).
// Variants: R, W (as committed), and both with in-content selectors (G = generic, S = per-generator) applied to the page first.
import fs from 'node:fs'; import { JSDOM } from 'jsdom'; import { Readability } from '@mozilla/readability';
import { flattenShadow } from './analyze-lib.mjs'; import { norm, textOf, shingles, pres } from './text.mjs';
import { walk, NOISE } from './walk.mjs'; import { stripInContent, detectGenerator } from './noise-selectors.mjs';
const DIR = '../../fixtures/sites';
const M = JSON.parse(fs.readFileSync(`${DIR}/manifest.json`, 'utf8'));
const N = JSON.parse(fs.readFileSync('noise.json', 'utf8'));
// Occurrences of an item = outermost elements whose whole text equals it.
function count(root, text) {
  let n = 0;
  for (const e of root.querySelectorAll('*')) if (norm(textOf(e)) === text && !(e.parentElement && e.parentElement !== root && norm(textOf(e.parentElement)) === text)) n++;
  return n;
}
function stripItems(root, items) {
  const texts = new Set(items.map((i) => i.text));
  for (const e of [...root.querySelectorAll('*')]) if (root.contains(e) && texts.has(norm(textOf(e)))) e.remove();
}
// Upper bound (review C2): occurrences of the item as a whole-word, case-sensitive substring of the whole output text.
// Catches noise that is a bare text node or part of a larger element; may over-count short items that are also words in content.
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function substrCount(root, items) {
  const o = norm(textOf(root)); let n = 0;
  for (const it of items) if (it.kind !== 'hidden' && it.kind !== 'glyph') n += (o.match(new RegExp(`(?<![\\p{L}\\p{N}])${esc(it.text)}(?![\\p{L}\\p{N}])`, 'gu')) ?? []).length;
  return n;
}
function noise(root, items) {
  const by = { visible: 0, hidden: 0, glyph: 0 }, present = [];
  let chars = 0;
  for (const it of items) {
    const n = count(root, it.text); if (!n) continue;
    const k = it.kind === 'hidden' ? 'hidden' : it.kind === 'glyph' ? 'glyph' : 'visible';
    by[k] += n; if (k === 'visible') { present.push(`${it.text}${n > 1 ? ' ×' + n : ''}`); chars += n * it.text.length; }
  }
  return { ...by, present, chars, pct: chars / (norm(textOf(root)).length || 1) };
}
// Content kept, block level: truth leaf blocks (≥ 15 chars, not a labelled noise item) whose text appears in the output text.
// Block-level rather than 5-gram recall, because removing noise creates 5-grams that bridge the gap and look like losses.
const LEAF = 'p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, blockquote, summary';
const BLK = /^(P|LI|H[1-6]|TD|TH|DT|DD|FIGCAPTION|BLOCKQUOTE|SUMMARY|DIV|UL|OL|TABLE|PRE|SECTION)$/;
function recall(out, truth, items) {
  const noiseText = new Set(items.map((i) => i.text));
  const o = norm(textOf(out));
  const blocks = [...truth.querySelectorAll(LEAF)].filter((e) => ![...e.querySelectorAll('*')].some((c) => BLK.test(c.tagName)) && !e.closest('pre'))
    .map((e) => norm(textOf(e))).filter((t) => t.length >= 15 && !noiseText.has(t));
  return blocks.filter((t) => o.includes(t)).length / (blocks.length || 1);
}
function preKept(out, truth) { const op = pres(out); let k = 0; for (const p of pres(truth)) { const i = op.indexOf(p); if (i >= 0) { op.splice(i, 1); k++; } } return k; }
const load = (slug) => { const d = new JSDOM(fs.readFileSync(`${DIR}/${slug}.html`, 'utf8'), { url: M[slug].finalUrl }).window.document; flattenShadow(d); return d; };
const readability = (doc) => { const a = new Readability(doc.cloneNode(true)).parse(); return new JSDOM(`<div>${a?.content ?? ''}</div>`).window.document.body; };
const VARIANTS = {
  R: (d) => readability(d),
  W: (d) => walk(d),
  'R+G+S': (d) => { stripInContent(d.body, { generator: detectGenerator(d) }); return readability(d); },
  'W+G': (d) => { stripInContent(d.body); return walk(d); },
  'W+G+S': (d) => { stripInContent(d.body, { generator: detectGenerator(d) }); return walk(d); },
};
const rows = [];
for (const slug of Object.keys(M)) {
  const items = N[slug];
  const d0 = load(slug); const truth = d0.querySelector(M[slug].contentSelector).cloneNode(true); truth.querySelectorAll(NOISE).forEach((e) => e.remove());
  // Truth for content/pre = the committed truth minus only the hand-labelled noise.json items (review C1: not minus the
  // G/S selectors, which would make the "selectors removed no content" check circular).
  stripItems(truth, items);
  const row = { slug, generator: detectGenerator(d0) };
  for (const [v, f] of Object.entries(VARIANTS)) { const out = f(load(slug)); row[v] = { ...noise(out, items), substr: substrCount(out, items), recall: recall(out, truth, items), pre: preKept(out, truth), truthPre: pres(truth).length }; }
  rows.push(row);
}
fs.writeFileSync('noise-results.json', JSON.stringify(rows, null, 2));
const V = Object.keys(VARIANTS);
let md = '# B1 noise evaluation (hand-checked list, `noise.json`)\n\nVisible noise occurrences per output (kinds ui/meta/promo). Hidden = items hidden by site CSS (a Chrome visibility check would drop them; jsdom cannot). Glyph = letterless permalink anchors.\n\n';
md += `| fixture | generator | ${V.map((v) => `${v} visible`).join(' | ')} | W hidden | W glyph | W+G+S hidden |\n|---|---|${V.map(() => '---').join('|')}|---|---|---|\n`;
for (const r of rows) md += `| ${r.slug} | ${r.generator ?? '–'} | ${V.map((v) => `${r[v].visible}`).join(' | ')} | ${r.W.hidden} | ${r.W.glyph} | ${r['W+G+S'].hidden} |\n`;
md += `| **sites with 0 visible noise** | | ${V.map((v) => `**${rows.filter((r) => r[v].visible === 0).length}/10**`).join(' | ')} | | | |\n\n`;
md += `Upper bound (whole-word substring of the output text, visible kinds; may over-count short items that are also ordinary words):\n\n| fixture | ${V.join(' | ')} |\n|---|${V.map(() => '---').join('|')}|\n`;
for (const r of rows) md += `| ${r.slug} | ${V.map((v) => r[v].substr).join(' | ')} |\n`;
md += `| **sites with 0** | ${V.map((v) => `**${rows.filter((r) => r[v].substr === 0).length}/10**`).join(' | ')} |\n\n`;
md += `Noise share of output chars (visible kinds):\n\n| fixture | ${V.join(' | ')} |\n|---|${V.map(() => '---').join('|')}|\n`;
for (const r of rows) md += `| ${r.slug} | ${V.map((v) => (100 * r[v].pct).toFixed(2) + '%').join(' | ')} |\n`;
md += `\nContent blocks kept (truth leaf blocks ≥ 15 chars, labelled noise excluded, found in the output text) and \`pre\` kept, to check that the selectors don't remove content:\n\n| fixture | ${V.map((v) => `${v} recall / pre`).join(' | ')} |\n|---|${V.map(() => '---').join('|')}|\n`;
for (const r of rows) md += `| ${r.slug} | ${V.map((v) => `${(100 * r[v].recall).toFixed(0)}% / ${r[v].pre}/${r[v].truthPre}`).join(' | ')} |\n`;
md += '\nItems left per output:\n\n';
for (const r of rows) md += `- **${r.slug}**\n${V.map((v) => `  - ${v}: ${r[v].present.join('; ') || '—'}`).join('\n')}\n`;
fs.writeFileSync('noise.md', md);
console.log(md);
