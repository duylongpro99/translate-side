// N6: license + attribution per fixture. Writes manifest `license`/`attribution` fields, a comment at the top of each
// fixture file, and fixtures/sites/ATTRIBUTION.md. Run after capture/scrub: node attribution.mjs
import fs from 'node:fs';
const DIR = '../../fixtures/sites';
const CHANGES = 'Rendered DOM captured by headless Chrome 154 on the capture date; scripts, iframes, network hints and tracking metadata removed; open shadow roots serialized as declarative shadow DOM; <base href> added. Text otherwise unchanged.';
export const A = {
  'docusaurus-code-blocks': { license: 'CC-BY-4.0', authors: 'Meta Platforms, Inc. and Docusaurus contributors', source: 'https://github.com/facebook/docusaurus (LICENSE-docs); site code MIT' },
  'mkdocs-material-admonitions': { license: 'MIT', authors: 'Martin Donath and contributors', source: 'https://github.com/squidfunk/mkdocs-material (LICENSE)' },
  'mdbook-rust-book-ownership': { license: 'MIT OR Apache-2.0', authors: 'Steve Klabnik, Carol Nichols, Chris Krycho and Rust community contributors', source: 'https://github.com/rust-lang/book (LICENSE-MIT, LICENSE-APACHE)' },
  'mdn-promise-then': { license: 'CC-BY-SA-2.5 (prose); code samples CC0-1.0 / MIT per MDN LICENSE.md', authors: 'Mozilla Contributors', history: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/then/contributors.txt', source: 'https://github.com/mdn/content/blob/main/LICENSE.md' },
  'docsrs-tokio': { license: 'MIT', authors: 'Tokio Contributors', source: 'https://github.com/tokio-rs/tokio (tokio/LICENSE); rustdoc/docs.rs page code MIT OR Apache-2.0' },
  'github-readme-bat': { license: 'README: MIT OR Apache-2.0', authors: 'David Peter and bat contributors', source: 'https://github.com/sharkdp/bat (LICENSE-MIT, LICENSE-APACHE)', extra: 'Cut to the README article (`article.markdown-body`) only, by user decision 2026-10-05 (`spikes/s3/cut-github.mjs`): the surrounding github.com page markup, which is GitHub\'s and not covered by bat\'s license, is not included.' },
  'wikipedia-futures-promises': { license: 'CC-BY-SA-4.0', authors: 'Wikipedia contributors', history: 'https://en.wikipedia.org/w/index.php?title=Futures_and_promises&action=history', source: 'https://en.wikipedia.org/wiki/Wikipedia:Text_of_the_Creative_Commons_Attribution-ShareAlike_4.0_International_License' },
  'goblog-pipelines': { license: 'CC-BY-4.0 (text); code BSD-3-Clause', authors: 'Sameer Ajmani (The Go Authors)', source: 'https://go.dev/copyright' },
  'twir-671': { license: 'CC-BY-SA-4.0', authors: 'This Week in Rust editors (nellshamrell, llogiq, ericseppanen, extrawurst, U007D, mariannegoldin, bdillo, opeolluwa, bnchi, KannanPalani57, tzilist) and contributors', source: 'https://this-week-in-rust.org/ (footer license link)' },
  'globalvoices-bangladesh-protests': { license: 'CC-BY-3.0 (text; third-party images not covered — no image files are stored, only their URLs)', authors: 'Pantha Rahman Reza (পান্থ রহমান রেজা), original in Bangla; translated to English by Rezwan', source: 'https://globalvoices.org/about/global-voices-attribution-policy/' },
};
if (import.meta.url === `file://${process.argv[1]}`) {
  const M = JSON.parse(fs.readFileSync(`${DIR}/manifest.json`, 'utf8'));
  let md = '# Fixture attribution\n\nThe fixtures in this directory are copies of third-party web pages, kept for local extraction tests. Each is used under the license below. Changes made to every fixture: ' + CHANGES + '\n\n';
  md += 'The page chrome around the content (site header, navigation, theme markup) belongs to the site operator; the licenses below cover the content. Open items are marked.\n\n';
  for (const [slug, m] of Object.entries(M)) {
    const a = A[slug]; if (!a) throw new Error('no attribution for ' + slug);
    m.license = a.license; m.attribution = { authors: a.authors, ...(a.history ? { history: a.history } : {}), licenseSource: a.source, changes: a.extra ? `${CHANGES} ${a.extra}` : CHANGES };
    md += `## ${slug}\n\n- Title: ${m.title}\n- Source: ${m.finalUrl} (captured ${m.capturedAt})\n- Authors: ${a.authors}\n${a.history ? `- History / contributors: ${a.history}\n` : ''}- License: ${a.license} (${a.source})\n- Changes: as above.${a.extra ? ` ${a.extra}` : ''}\n${a.open ? `- **Open item:** ${a.open}\n` : ''}\n`;
    const f = `${DIR}/${slug}.html`;
    let html = fs.readFileSync(f, 'utf8').replace(/^(<!DOCTYPE html>)?<!-- fixture-attribution:[\s\S]*?-->\n?/i, '$1');
    const note = `<!-- fixture-attribution: "${m.title}" — ${m.finalUrl} — by ${a.authors} — license ${a.license} — modified: see ATTRIBUTION.md -->\n`;
    html = /^<!DOCTYPE html>/i.test(html) ? html.replace(/^<!DOCTYPE html>/i, (d) => d + note) : note + html;
    fs.writeFileSync(f, html); m.bytes = html.length;
  }
  fs.writeFileSync(`${DIR}/manifest.json`, JSON.stringify(M, null, 2) + '\n');
  fs.writeFileSync(`${DIR}/ATTRIBUTION.md`, md);
  console.log('ok', Object.keys(M).length);
}
