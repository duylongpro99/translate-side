// User decision 2026-10-05: the GitHub fixture keeps only the README article. The surrounding github.com page markup
// (header, repo UI, stylesheets) is GitHub's and not covered by bat's license, so it is removed. Keeps the doctype,
// <html lang>, <base href>, charset, viewport and <title>, and puts article.markdown-body (unchanged) alone in <body>.
// Then re-run: node scrub.mjs && node attribution.mjs
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
const f = '../../fixtures/sites/github-readme-bat.html';
const doc = new JSDOM(fs.readFileSync(f, 'utf8')).window.document;
const art = doc.querySelector('article.markdown-body');
if (!art) throw new Error('article.markdown-body not found (already cut?)');
const keep = ['base', 'meta[charset]', 'meta[name=viewport]', 'title'].map((s) => doc.head.querySelector(s)?.outerHTML).filter(Boolean);
const lang = doc.documentElement.getAttribute('lang');
const html = `<!DOCTYPE html><html${lang ? ` lang="${lang}"` : ''}><head>${keep.join('')}</head><body>${art.outerHTML}</body></html>`;
fs.writeFileSync(f, html);
console.log('github-readme-bat cut to the README article:', html.length, 'bytes');
