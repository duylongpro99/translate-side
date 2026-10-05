// S3: Readability vs main/article walk on fixtures/sites. Scores against a hand-picked content root.
// Usage: node analyze.mjs [--no-flatten]
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { Readability, isProbablyReaderable } from '@mozilla/readability';
const DIR = '../../fixtures/sites';
const manifest = JSON.parse(fs.readFileSync(`${DIR}/manifest.json`, 'utf8'));
const FLATTEN = !process.argv.includes('--no-flatten');

import { flattenShadow } from './analyze-lib.mjs';
import { norm, words, shingles, textOf, pres } from './text.mjs';
import { walk, NOISE } from './walk.mjs';
function score(out, truth, chrome) {
  if (!out) return { len: 0, recall: 0, precision: 0, preKept: 0, leak: 0 };
  const T = shingles(textOf(truth)), O = shingles(textOf(out));
  let hit = 0; for (const s of O) if (T.has(s)) hit++;
  let cov = 0; for (const s of T) if (O.has(s)) cov++;
  // Multiset match: each truth <pre> must find an identical output <pre>.
  const tp = pres(truth), op = pres(out); let kept = 0;
  for (const p of tp) { const i = op.indexOf(p); if (i >= 0) { op.splice(i, 1); kept++; } }
  // Noise leak: output shingles found in page chrome (nav/aside/footer/header outside the truth root) and not in truth.
  let leak = 0; for (const s of O) if (chrome.has(s) && !T.has(s)) leak++;
  const missing = [...T].filter((s) => !O.has(s));
  return { leak, leakPct: leak / (O.size || 1), missingSample: missing.slice(0, 8), len: norm(textOf(out)).length, recall: cov / (T.size || 1), precision: hit / (O.size || 1),
    preKept: kept, tables: out.querySelectorAll('table').length,
    details: out.querySelectorAll('details').length };
}
const rows = [];
for (const [slug, m] of Object.entries(manifest)) {
  const html = fs.readFileSync(`${DIR}/${slug}.html`, 'utf8');
  const doc = new JSDOM(html, { url: m.finalUrl }).window.document;
  if (FLATTEN) flattenShadow(doc);
  const truth = doc.querySelector(m.contentSelector);
  const truthClean = truth.cloneNode(true); truthClean.querySelectorAll(NOISE).forEach((e) => e.remove());
  const tp = pres(truth);
  const readerable = isProbablyReaderable(doc);
  const art = new Readability(doc.cloneNode(true), { keepClasses: true }).parse();
  const rDom = art ? new JSDOM(`<div id=r>${art.content}</div>`).window.document.getElementById('r') : null;
  let chromeText = '';
  for (const e of doc.querySelectorAll('nav, aside, footer, header, [role=navigation], [role=complementary], [role=contentinfo], [role=banner]'))
    if (!truth.contains(e) && !e.contains(truth)) chromeText += ' ' + textOf(e);
  const chrome = shingles(chromeText);
  const R = score(rDom, truthClean, chrome), W = score(walk(doc), truthClean, chrome);
  rows.push({ slug, truthLen: norm(textOf(truthClean)).length, truthPre: tp.length, truthTables: truth.querySelectorAll('table').length,
    truthDetails: truth.querySelectorAll('details').length, readerable, R, W });
}
const pct = (x) => (100 * x).toFixed(0) + '%';
console.log(`flatten shadow DOM: ${FLATTEN}\n`);
console.log('| fixture | truth chars | pre | tbl | det | R recall | R precision | R chrome leak | R pre kept | R tbl/det | W recall | W precision | W chrome leak | W pre kept | W tbl/det | R len / W len |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.slug} | ${r.truthLen} | ${r.truthPre} | ${r.truthTables} | ${r.truthDetails} | ${pct(r.R.recall)} | ${pct(r.R.precision)} | ${r.R.leak} | ${r.R.preKept}/${r.truthPre} | ${r.R.tables}/${r.R.details} | ${pct(r.W.recall)} | ${pct(r.W.precision)} | ${r.W.leak} | ${r.W.preKept}/${r.truthPre} | ${r.W.tables}/${r.W.details} | ${(r.R.len / (r.W.len || 1)).toFixed(2)} |`);
fs.writeFileSync(`results-${FLATTEN ? 'flatten' : 'noflatten'}.json`, JSON.stringify(rows, null, 2));
