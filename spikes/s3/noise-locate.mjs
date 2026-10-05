// For each hand-labelled noise item, show where it sits in the walk output (ancestor chain + telling attributes).
import fs from 'node:fs'; import { JSDOM } from 'jsdom';
import { flattenShadow } from './analyze-lib.mjs'; import { norm, textOf } from './text.mjs'; import { walk } from './walk.mjs';
const M = JSON.parse(fs.readFileSync('../../fixtures/sites/manifest.json', 'utf8'));
const N = JSON.parse(fs.readFileSync('noise.json', 'utf8'));
const desc = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '') +
  [...e.attributes].filter((a) => /^(role|aria-|data-(testid|component|link-name|gu-name)|hidden)/.test(a.name)).map((a) => `[${a.name}=${a.value.slice(0, 30)}]`).join('');
for (const [slug, items] of Object.entries(N)) {
  if (slug.startsWith('_') || (process.argv[2] && slug !== process.argv[2])) continue;
  const doc = new JSDOM(fs.readFileSync(`../../fixtures/sites/${slug}.html`, 'utf8'), { url: M[slug].finalUrl }).window.document; flattenShadow(doc);
  const W = walk(doc);
  console.log(`\n## ${slug}`);
  for (const it of items) {
    const els = [...W.querySelectorAll('*')].filter((e) => norm(textOf(e)) === it.text && !(e.parentElement && norm(textOf(e.parentElement)) === it.text));
    const e = els[0];
    if (!e) { console.log(`  [${it.text}] not in W`); continue; }
    const chain = []; for (let x = e; x && x !== W && chain.length < 4; x = x.parentElement) chain.push(desc(x));
    console.log(`  [${it.text}] ×${els.length}: ${chain.join(' < ')}`);
  }
}
