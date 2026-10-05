// Helper for labelling noise.json: print exact normalized texts of outermost W-output elements starting with each prefix.
import fs from 'node:fs'; import { JSDOM } from 'jsdom';
import { flattenShadow } from './analyze-lib.mjs'; import { norm, textOf } from './text.mjs'; import { walk } from './walk.mjs';
const M = JSON.parse(fs.readFileSync('../../fixtures/sites/manifest.json', 'utf8'));
const [slug, ...prefixes] = process.argv.slice(2);
const d = new JSDOM(fs.readFileSync(`../../fixtures/sites/${slug}.html`, 'utf8'), { url: M[slug].finalUrl }).window.document; flattenShadow(d);
const W = walk(d);
for (const p of prefixes) {
  const els = [...W.querySelectorAll('*')].filter((e) => norm(textOf(e)).startsWith(p));
  const inner = els.filter((e) => !els.some((x) => x !== e && e.contains(x) && norm(textOf(x)) === norm(textOf(e))));
  console.log(JSON.stringify(p), '→', [...new Set(inner.map((e) => norm(textOf(e))))].slice(0, 4).map((t) => JSON.stringify(t.slice(0, 160))).join(' | '));
}
