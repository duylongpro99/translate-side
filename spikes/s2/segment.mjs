// Builds the S2 chunk set from the 10 S3 fixtures: a throwaway segmenter (not M0-E6), close enough to §4.1 that the
// model sees realistic input: block segments, inline markers [link]…[/link], `code`, *em*, **strong**; `pre` skipped.
// Output: chunks.json = 50 chunks (5 per fixture, spread over the document), ids numbered per chunk from 1.
// `node segment.mjs --large` instead writes chunks-large.json: chunks at the DESIGN §5.7 size (800–1,500 est. tokens,
// no segment cap), one per fixture, ids prefixed "L:". The budget rotates over 900/1,100/1,300/1,500 by fixture so the
// sizes cover the range; the middle chunk of those that reach 800 is taken.
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { flattenShadow } from '../s3/analyze-lib.mjs';
import { stripInContent, detectGenerator } from '../s3/noise-selectors.mjs';

const FIX = new URL('../../fixtures/sites/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', FIX), 'utf8'));
const BLOCK = 'h1,h2,h3,h4,h5,h6,p,li,dt,dd,td,th,figcaption,blockquote,summary';
const SKIP = 'pre,script,style,nav,svg,math,button,[hidden],[aria-hidden=true]';

function inline(node) {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.nodeType !== 1) return '';
  const el = node;
  if (el.matches(SKIP)) return '';
  if (el.matches(BLOCK)) return ''; // nested block becomes its own segment
  const inner = () => [...el.childNodes].map(inline).join('');
  switch (el.localName) {
    case 'code': case 'kbd': case 'samp': return '`' + el.textContent + '`';
    case 'a': { const t = inner(); return t.trim() ? `[link]${t}[/link]` : ''; }
    case 'em': case 'i': { const t = inner(); return t.trim() ? `*${t}*` : t; }
    case 'strong': case 'b': { const t = inner(); return t.trim() ? `**${t}**` : t; }
    case 'br': return ' ';
    default: return inner();
  }
}

function segments(root) {
  const out = [];
  for (const el of root.querySelectorAll(BLOCK)) {
    if (el.closest(SKIP)) continue;
    const text = [...el.childNodes].map(inline).join('').replace(/\s+/g, ' ').trim();
    if (text.replace(/[`*\[\]/link]/g, '').trim().length < 2) continue;
    out.push({ kind: el.localName, text });
  }
  return out;
}

const estTokens = (s) => Math.ceil(s.length / 4);
function chunk(segs, budget = 450, maxSegs = 14) {
  const chunks = []; let cur = [];
  for (const s of segs) {
    if (cur.length && (cur.reduce((n, x) => n + estTokens(x.text), 0) + estTokens(s.text) > budget || cur.length >= maxSegs)) { chunks.push(cur); cur = []; }
    cur.push(s);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const LARGE = process.argv.includes('--large');
const all = [];
for (const [fi, [slug, m]] of Object.entries(manifest).entries()) {
  const html = fs.readFileSync(new URL(`${slug}.html`, FIX), 'utf8');
  const doc = new JSDOM(html, { url: m.finalUrl }).window.document;
  flattenShadow(doc);
  const root = doc.querySelector(m.contentSelector);
  stripInContent(root, { generic: true, generator: detectGenerator(doc) });
  const tok = (c) => c.reduce((n, s) => n + estTokens(s.text), 0);
  let pick;
  if (LARGE) {
    const big = chunk(segments(root), [900, 1100, 1300, 1500][fi % 4], Infinity).filter((c) => tok(c) >= 800);
    pick = big.length ? [big[Math.floor((big.length - 1) / 2)]] : [];
  } else {
    const cs = chunk(segments(root)).filter((c) => c.length >= 3);
    // 5 chunks spread evenly over the document
    pick = [0, 1, 2, 3, 4].map((i) => cs[Math.min(cs.length - 1, Math.round((i * (cs.length - 1)) / 4))]);
  }
  [...new Set(pick)].forEach((c, i) => all.push({ id: `${LARGE ? 'L:' : ''}${slug}#${i}`, slug, title: m.title,
    segs: c.map((s, j) => ({ id: j + 1, kind: s.kind, text: s.text })) }));
}
fs.writeFileSync(new URL(LARGE ? 'chunks-large.json' : 'chunks.json', import.meta.url), JSON.stringify(all, null, 1));
const nSeg = all.reduce((n, c) => n + c.segs.length, 0);
const lt = all.flatMap((c) => c.segs).filter((s) => /[<>]/.test(s.text)).length;
console.log(`chunks ${all.length}, segments ${nSeg}, segs with < or > ${lt}, est tokens/chunk median`,
  all.map((c) => c.segs.reduce((n, s) => n + estTokens(s.text), 0)).sort((a, b) => a - b)[Math.floor(all.length / 2)]);
if (LARGE) console.log(all.map((c) => `${c.id} ${c.segs.length} segs ${c.segs.reduce((n, s) => n + estTokens(s.text), 0)} tok`).join('\n'));
