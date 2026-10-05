// Per method: headings kept (of truth headings), paragraphs/list items kept, and the walk's extra text not in truth.
import fs from 'node:fs'; import { JSDOM } from 'jsdom'; import { Readability } from '@mozilla/readability';
import { flattenShadow } from './analyze-lib.mjs';
import { walk } from './walk.mjs';
const M = JSON.parse(fs.readFileSync('../../fixtures/sites/manifest.json', 'utf8'));
const norm = (s) => s.replace(/[​¶§#]/g, '').replace(/\s+/g, ' ').trim();
const blocks = (root, sel) => [...root.querySelectorAll(sel)].filter((e) => !e.closest('[hidden],nav,aside,footer,button')).map((e) => norm(e.textContent)).filter((t) => t.length > 3);
const kept = (truthList, outEls) => { const pool = outEls.slice(); let k = 0; for (const t of truthList) { const i = pool.indexOf(t); if (i >= 0) { pool.splice(i, 1); k++; } } return k; };
const out = [];
console.log('| fixture | headings | R kept | W kept | p+li | R kept | W kept | walk extra blocks (not in truth), sample |\n|---|---|---|---|---|---|---|---|');
for (const [slug, m] of Object.entries(M)) {
  const doc = new JSDOM(fs.readFileSync(`../../fixtures/sites/${slug}.html`, 'utf8'), { url: m.finalUrl }).window.document;
  flattenShadow(doc);
  const truth = doc.querySelector(m.contentSelector);
  const art = new Readability(doc.cloneNode(true)).parse();
  const R = new JSDOM(`<div>${art.content}</div>`).window.document.body;
  const W = walk(doc);
  const H = 'h1,h2,h3,h4,h5,h6', P = 'p,li';
  const th = blocks(truth, H), tp = blocks(truth, P);
  const tAll = new Set(blocks(truth, `${H},${P},td,th,dt,dd,figcaption,blockquote`));
  const extra = blocks(W, `${H},${P},td,th,dt,dd,figcaption`).filter((t) => !tAll.has(t));
  out.push({ slug, extra });
  console.log(`| ${slug} | ${th.length} | ${kept(th, blocks(R, H))} | ${kept(th, blocks(W, H))} | ${tp.length} | ${kept(tp, blocks(R, P))} | ${kept(tp, blocks(W, P))} | ${extra.length}: ${extra.slice(0, 4).map((t) => '“' + t.slice(0, 40) + '”').join(', ')} |`);
}
fs.writeFileSync('walk-extra.json', JSON.stringify(out, null, 2));
