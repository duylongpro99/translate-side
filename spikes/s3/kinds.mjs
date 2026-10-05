// Count docs-specific block types inside each fixture's content root (after shadow flattening).
import fs from 'node:fs'; import { JSDOM } from 'jsdom'; import { flattenShadow } from './analyze-lib.mjs';
const M = JSON.parse(fs.readFileSync('../../fixtures/sites/manifest.json', 'utf8'));
const SEL = {
  admonition: '.theme-admonition, .admonition, .markdown-alert, [class*=hint], [class*=callout], aside.note, .notecard',
  details: 'details', tabpanel: '[role=tabpanel]', hiddenTabpanel: '[role=tabpanel][hidden]', table: 'table', figure: 'figure, figcaption', math: 'math, .mwe-math-element',
};
console.log('| fixture | ' + Object.keys(SEL).join(' | ') + ' |\n|---|' + Object.keys(SEL).map(() => '---|').join(''));
for (const [slug, m] of Object.entries(M)) {
  const doc = new JSDOM(fs.readFileSync(`../../fixtures/sites/${slug}.html`, 'utf8')).window.document; flattenShadow(doc);
  const root = doc.querySelector(m.contentSelector);
  console.log(`| ${slug} | ` + Object.values(SEL).map((s) => root.querySelectorAll(s).length).join(' | ') + ' |');
}
