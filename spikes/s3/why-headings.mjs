// N1: for each truth heading Readability doesn't keep as a heading, show its source markup context and whether its text survives as non-heading.
import fs from 'node:fs'; import { JSDOM } from 'jsdom'; import { Readability } from '@mozilla/readability';
import { flattenShadow } from './analyze-lib.mjs';
const M = JSON.parse(fs.readFileSync('../../fixtures/sites/manifest.json', 'utf8'));
const norm = (s) => s.replace(/[​¶§#]/g, '').replace(/\[ ?edit ?\]/g, '').replace(/\s+/g, ' ').trim();
for (const slug of process.argv.slice(2)) {
  const m = M[slug];
  const doc = new JSDOM(fs.readFileSync(`../../fixtures/sites/${slug}.html`, 'utf8'), { url: m.finalUrl }).window.document; flattenShadow(doc);
  const truth = doc.querySelector(m.contentSelector);
  const art = new Readability(doc.cloneNode(true)).parse();
  const R = new JSDOM(`<div>${art.content}</div>`).window.document.body;
  const rh = new Set([...R.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((e) => norm(e.textContent)));
  const rText = norm(R.textContent);
  console.log(`== ${slug} title="${art.title}" R headings: ${[...rh].slice(0, 5).join(' | ')}`);
  for (const h of truth.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const t = norm(h.textContent); if (rh.has(t) || t.length < 3) continue;
    const p = h.parentElement;
    const tagIn = [...R.querySelectorAll('*')].find((e) => e.children.length === 0 && norm(e.textContent) === t);
    console.log(`  ${h.tagName} "${t.slice(0, 50)}" class="${h.className}" parent=${p.tagName}.${p.className.slice(0, 40)} text in R: ${rText.includes(t)} as <${tagIn?.tagName ?? '-'}>`);
  }
}
