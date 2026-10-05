// C1 follow-up: which generic (+G) rule removes real content? Removes one rule at a time from the page and lists what goes missing.
import fs from 'node:fs'; import { JSDOM } from 'jsdom';
import { flattenShadow } from './analyze-lib.mjs'; import { norm, textOf } from './text.mjs';
import { walk } from './walk.mjs'; import { GENERIC, isGlyphAnchor } from './noise-selectors.mjs';
const M = JSON.parse(fs.readFileSync('../../fixtures/sites/manifest.json', 'utf8'));
const N = JSON.parse(fs.readFileSync('noise.json', 'utf8'));
const load = (slug) => { const d = new JSDOM(fs.readFileSync(`../../fixtures/sites/${slug}.html`, 'utf8'), { url: M[slug].finalUrl }).window.document; flattenShadow(d); return d; };
const noiseText = (slug) => new Set(N[slug].map((i) => i.text));
for (const slug of process.argv.slice(2)) {
  const base = walk(load(slug)); const nt = noiseText(slug);
  for (const rule of [...GENERIC, 'glyph-anchor']) {
    const d = load(slug); const hits = rule === 'glyph-anchor' ? [...d.body.querySelectorAll('a')].filter(isGlyphAnchor) : [...d.body.querySelectorAll(rule)];
    const content = hits.filter((e) => base.contains ? true : true).map((e) => norm(textOf(e))).filter((t) => t && !nt.has(t));
    if (content.length) console.log(`${slug} ${rule}: ${hits.length} hits, ${content.length} not labelled noise, e.g. ${content.slice(0, 4).map((t) => JSON.stringify(t.slice(0, 50))).join(', ')}`);
  }
}
