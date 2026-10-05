// Candidate signals for "is the walk result good?" on each fixture, plus a negative control with semantic containers removed.
import fs from 'node:fs'; import { JSDOM } from 'jsdom'; import { Readability } from '@mozilla/readability';
import { flattenShadow } from './analyze-lib.mjs'; import { walk } from './walk.mjs'; import { textOf, norm } from './text.mjs';
const M = JSON.parse(fs.readFileSync('../../fixtures/sites/manifest.json', 'utf8'));
const len = (e) => norm(textOf(e)).length;
const linkDensity = (e) => { const t = len(e) || 1; let l = 0; for (const a of e.querySelectorAll('a')) l += norm(a.textContent).length; return l / t; };
console.log('| fixture | walk chars | walk / body text | walk link density | walk / Readability chars | pre in walk / pre in body |\n|---|---|---|---|---|---|');
for (const [slug, m] of Object.entries(M)) {
  const doc = new JSDOM(fs.readFileSync(`../../fixtures/sites/${slug}.html`, 'utf8'), { url: m.finalUrl }).window.document;
  flattenShadow(doc);
  const body = doc.body.cloneNode(true); body.querySelectorAll('[hidden], [aria-hidden=true]').forEach((e) => e.remove());
  const W = walk(doc);
  const art = new Readability(doc.cloneNode(true)).parse();
  const visiblePre = body.querySelectorAll('pre').length;
  console.log(`| ${slug} | ${len(W)} | ${(len(W) / len(body)).toFixed(2)} | ${linkDensity(W).toFixed(2)} | ${(len(W) / art.textContent.replace(/\s+/g, ' ').length).toFixed(2)} | ${W.querySelectorAll('pre').length}/${visiblePre} |`);
}
