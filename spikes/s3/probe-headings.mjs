// Which truth headings / paragraphs does Readability drop?
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { flattenShadow } from './analyze-lib.mjs';
const m = JSON.parse(fs.readFileSync('../../fixtures/sites/manifest.json', 'utf8'));
const norm = (s) => s.replace(/[\u200b¶§#]/g, '').replace(/\s+/g, ' ').trim();
for (const [slug, site] of Object.entries(m)) {
  const doc = new JSDOM(fs.readFileSync(`../../fixtures/sites/${slug}.html`, 'utf8'), { url: site.finalUrl }).window.document;
  flattenShadow(doc);
  const truth = doc.querySelector(site.contentSelector);
  const art = new Readability(doc.cloneNode(true)).parse();
  const out = norm(new JSDOM(art.content).window.document.body.textContent);
  const lost = [...truth.querySelectorAll('h1,h2,h3,h4,p,li')].filter((e) => !e.closest('[hidden],nav,aside,footer'))
    .map((e) => [e.tagName, norm(e.textContent)]).filter(([, t]) => t.length > 3 && !out.includes(t));
  console.log(`== ${slug}: lost ${lost.length} blocks; article.title="${art.title}"`);
  for (const [tag, t] of lost.slice(0, 6)) console.log(`   ${tag}: ${t.slice(0, 100)}`);
}
