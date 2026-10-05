// N1: confirm the causes of Readability's losses by removing each cause and re-running.
// - Wikipedia: the .mw-editsection link inside each div.mw-heading.
// - docs.rs: h2.section-header — "header" is in Readability's unlikelyCandidates regex (same cause as the Substack
//   headings in the first fixture set, class header-anchor-post).
// - Go blog: <span class="comment"> inside <pre> — "comment" is in unlikelyCandidates, so code comments are deleted.
import fs from 'node:fs'; import { JSDOM } from 'jsdom'; import { Readability } from '@mozilla/readability';
import { flattenShadow } from './analyze-lib.mjs';
import { pres } from './text.mjs';
const M = JSON.parse(fs.readFileSync('../../fixtures/sites/manifest.json', 'utf8'));
const R = (d) => new JSDOM(`<div>${new Readability(d.cloneNode(true)).parse().content}</div>`).window.document.body;
const unclass = (sel) => (d) => d.querySelectorAll(sel).forEach((e) => e.removeAttribute('class'));
const slug0 = 'goblog-pipelines';
const cases = [
  ['wikipedia-futures-promises', 'remove .mw-editsection', (d) => d.querySelectorAll('.mw-editsection').forEach((e) => e.remove()), (b) => b.querySelectorAll('h2,h3').length, 'h2/h3'],
  ['docsrs-tokio', 'drop class on h2.section-header', unclass('h2.section-header'), (b) => b.querySelectorAll('h2,h3,h4').length, 'h2-h4'],
  ['goblog-pipelines', 'drop class on pre span.comment', unclass('pre span.comment'), (b, d) => { const op = pres(b); let k = 0; for (const p of pres(d.querySelector(M[slug0].contentSelector))) { const i = op.indexOf(p); if (i >= 0) { op.splice(i, 1); k++; } } return k; }, 'identical pre (of 26)'],
];
for (const [slug, what, fix, measure, unit] of cases) {
  const load = () => { const d = new JSDOM(fs.readFileSync(`../../fixtures/sites/${slug}.html`, 'utf8'), { url: M[slug].finalUrl }).window.document; flattenShadow(d); return d; };
  const d0 = load(); const before = measure(R(d0), d0); const d = load(); fix(d); const after = measure(R(d), load());
  console.log(`${slug}: ${what}: ${unit} ${before} → ${after}`);
}
