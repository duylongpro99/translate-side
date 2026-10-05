import fs from 'node:fs'; import { JSDOM } from 'jsdom'; import { Readability } from '@mozilla/readability'; import { flattenShadow } from './analyze-lib.mjs';
const [slug, needle] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync('../../fixtures/sites/manifest.json', 'utf8'))[slug];
const doc = new JSDOM(fs.readFileSync(`../../fixtures/sites/${slug}.html`, 'utf8'), { url: m.finalUrl }).window.document; flattenShadow(doc);
const src = [...doc.querySelectorAll('h1,h2,h3,p')].find((e) => e.textContent.includes(needle));
console.log('SOURCE:', src?.outerHTML.slice(0, 400));
const art = new Readability(doc.cloneNode(true)).parse();
// Search the output's text, not its raw HTML, so inline markup inside the needle doesn't cause a false negative.
const out = new JSDOM(art.content).window.document.body.textContent.replace(/\s+/g, ' ');
const i = out.indexOf(needle); console.log('IN OUTPUT TEXT at', i, i >= 0 ? out.slice(Math.max(0, i - 200), i + 150) : '');
