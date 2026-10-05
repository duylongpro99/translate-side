// Proposed extraction policy, evaluated on fixtures and two synthetic negative controls:
//   nosemantic: main/article/[role=main] renamed to div (walk has nothing to start from)
//   wholepage:  semantic containers renamed, then the whole <body> wrapped in one <main> (walk root is the whole page)
import fs from 'node:fs'; import { JSDOM } from 'jsdom'; import { Readability } from '@mozilla/readability';
import { flattenShadow } from './analyze-lib.mjs'; import { walk, walkIsGood, linkDensity } from './walk.mjs';
import { textOf, norm, shingles, pres } from './text.mjs';
const M = JSON.parse(fs.readFileSync('../../fixtures/sites/manifest.json', 'utf8'));
export function extract(doc) {
  flattenShadow(doc);
  const w = walk(doc);
  if (walkIsGood(w)) return { via: 'walk', root: w };
  const art = new Readability(doc.cloneNode(true)).parse();
  if (art && norm(art.textContent).length >= 500) return { via: 'readability', root: new JSDOM(`<div>${art.content}</div>`).window.document.body };
  return { via: 'none (selection mode hint)', root: null };
}
function rename(doc) {
  for (const e of [...doc.querySelectorAll('main, article')]) { const d = doc.createElement('div'); d.append(...e.childNodes); for (const a of e.attributes) d.setAttribute(a.name, a.value); e.replaceWith(d); }
  doc.querySelectorAll('[role=main]').forEach((e) => e.removeAttribute('role'));
}
const pct = (x) => (100 * x).toFixed(0) + '%';
console.log('| fixture | variant | chosen | recall | precision | chrome leak | pre kept | walk link density |\n|---|---|---|---|---|---|---|---|');
for (const [slug, m] of Object.entries(M)) for (const variant of ['as-is', 'nosemantic', 'wholepage']) {
  const doc = new JSDOM(fs.readFileSync(`../../fixtures/sites/${slug}.html`, 'utf8'), { url: m.finalUrl }).window.document;
  flattenShadow(doc);
  const truthEl = doc.querySelector(m.contentSelector); truthEl.setAttribute('data-truth', '1');
  const truth = truthEl.cloneNode(true); truth.querySelectorAll('nav, aside, footer, button, [aria-hidden=true], [hidden]:not([role=tabpanel]), style, svg').forEach((e) => e.remove());
  let chromeText = ''; for (const e of doc.querySelectorAll('nav, aside, footer, header, [role=navigation], [role=complementary], [role=contentinfo], [role=banner]')) if (!truthEl.contains(e) && !e.contains(truthEl)) chromeText += ' ' + textOf(e);
  if (variant !== 'as-is') rename(doc);
  if (variant === 'wholepage') { const mn = doc.createElement('main'); mn.append(...doc.body.childNodes); doc.body.append(mn); }
  const w = walk(doc);
  const r = extract(doc);
  const T = shingles(textOf(truth)), O = r.root ? shingles(textOf(r.root)) : new Set(), C = shingles(chromeText);
  let cov = 0; for (const s of T) if (O.has(s)) cov++;
  let hit = 0, leak = 0; for (const s of O) { if (T.has(s)) hit++; else if (C.has(s)) leak++; }
  const tp = pres(truth), op = r.root ? pres(r.root) : []; let kept = 0; for (const p of tp) { const i = op.indexOf(p); if (i >= 0) { op.splice(i, 1); kept++; } }
  console.log(`| ${slug} | ${variant} | ${r.via} | ${pct(cov / (T.size || 1))} | ${pct(hit / (O.size || 1))} | ${leak} | ${kept}/${tp.length} | ${w ? linkDensity(w).toFixed(2) : '-'} |`);
}
