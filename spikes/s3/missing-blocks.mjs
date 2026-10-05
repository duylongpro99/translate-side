// C1 follow-up: list truth content blocks missing from a variant's output (truth = contentSelector minus noise.json items).
import fs from 'node:fs'; import { JSDOM } from 'jsdom';
import { flattenShadow } from './analyze-lib.mjs'; import { norm, textOf } from './text.mjs';
import { walk, NOISE } from './walk.mjs'; import { stripInContent, detectGenerator } from './noise-selectors.mjs';
const M = JSON.parse(fs.readFileSync('../../fixtures/sites/manifest.json', 'utf8'));
const N = JSON.parse(fs.readFileSync('noise.json', 'utf8'));
const [slug, variant = 'W+G'] = process.argv.slice(2);
const load = () => { const d = new JSDOM(fs.readFileSync(`../../fixtures/sites/${slug}.html`, 'utf8'), { url: M[slug].finalUrl }).window.document; flattenShadow(d); return d; };
const d0 = load(); const truth = d0.querySelector(M[slug].contentSelector).cloneNode(true); truth.querySelectorAll(NOISE).forEach((e) => e.remove());
const texts = new Set(N[slug].map((i) => i.text)); for (const e of [...truth.querySelectorAll("*")]) if (truth.contains(e) && texts.has(norm(textOf(e)))) e.remove();
const d = load(); stripInContent(d.body, variant === 'W+G+S' ? { generator: detectGenerator(d) } : {}); const o = norm(textOf(walk(d)));
const BLK = /^(P|LI|H[1-6]|TD|TH|DT|DD|FIGCAPTION|BLOCKQUOTE|SUMMARY|DIV|UL|OL|TABLE|PRE|SECTION)$/;
const miss = [...truth.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, blockquote, summary')]
  .filter((e) => ![...e.querySelectorAll('*')].some((c) => BLK.test(c.tagName)) && !e.closest('pre')).map((e) => norm(textOf(e))).filter((t) => t.length >= 15 && !o.includes(t));
console.log(slug, variant, 'missing', miss.length); for (const t of miss.slice(0, 6)) console.log('  ', JSON.stringify(t.slice(0, 120)));
