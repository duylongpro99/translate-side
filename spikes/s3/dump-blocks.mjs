// Dump short leaf-ish text blocks of W and R output per fixture, for hand-checking UI noise.
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { flattenShadow } from './analyze-lib.mjs';
import { norm, textOf } from './text.mjs';
import { walk } from './walk.mjs';
const DIR = '../../fixtures/sites';
const manifest = JSON.parse(fs.readFileSync(`${DIR}/manifest.json`, 'utf8'));
const MAX = +(process.argv[2] ?? 60);
const only = process.argv[3];
const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, dt, dd, figcaption, caption, td, th, summary, blockquote, div, span, a, time';
function short(root) {
  const out = new Map();
  for (const e of root.querySelectorAll(BLOCK)) {
    if (e.closest('pre')) continue;
    const t = norm(textOf(e)); if (!t || t.length > MAX) continue;
    // keep the outermost element with this text
    out.set(t, (out.get(t) ?? 0) + 1);
  }
  return out;
}
for (const [slug, m] of Object.entries(manifest)) {
  if (only && slug !== only) continue;
  const doc = new JSDOM(fs.readFileSync(`${DIR}/${slug}.html`, 'utf8'), { url: m.finalUrl }).window.document;
  flattenShadow(doc);
  const art = new Readability(doc.cloneNode(true), { keepClasses: true }).parse();
  const r = new JSDOM(`<div>${art?.content ?? ''}</div>`).window.document.body;
  const W = short(walk(doc)), R = short(r);
  console.log(`\n## ${slug}`);
  for (const [t, n] of W) console.log(`W${R.has(t) ? 'R' : ' '} ×${n} ${t}`);
  for (const [t, n] of R) if (!W.has(t)) console.log(` R ×${n} ${t}`);
}
