// N7: drop tracking/visitor data from fixtures. Keeps only charset/viewport/description metas (plus generator,
// which extraction uses to detect the site generator) and strips analytics/tracking attributes everywhere,
// including inside declarative shadow roots.
const KEEP_META = (m) => m.hasAttribute('charset') || /^(viewport|description|generator)$/i.test(m.getAttribute('name') ?? '');
const TRACK_ATTR = /^data-(hydro|analytics|ophan|octo|ga-|gtm|track|tracking|testid-tracking)/i;
// Also removes script/noscript/iframe and network hints (prefetch/preload/modulepreload/preconnect/dns-prefetch),
// recursing into nested declarative shadow roots.
const HINTS = 'link[rel~=prefetch i], link[rel~=preload i], link[rel~=modulepreload i], link[rel~=preconnect i], link[rel~=dns-prefetch i]';
function allRoots(doc) {
  const out = [doc];
  for (let i = 0; i < out.length; i++) for (const t of out[i].querySelectorAll('template[shadowrootmode]')) out.push(t.content);
  return out;
}
export function scrub(doc) {
  const roots = allRoots(doc);
  let metas = 0, attrs = 0, removed = 0;
  for (const r of roots) {
    // Round 2 (C3): hidden form inputs (comment-form nonces), Gravatar avatars (hash of a commenter's email).
    for (const e of r.querySelectorAll(`script, noscript, iframe, ${HINTS}, input[type=hidden i], img[src*="gravatar.com"]`)) { e.remove(); removed++; }
    // HTML comments, except the fixture-attribution header.
    const it = (r.ownerDocument ?? r).createNodeIterator(r, 128); const cs = []; let c;
    while ((c = it.nextNode())) if (!c.data.trimStart().startsWith('fixture-attribution:')) cs.push(c);
    for (const x of cs) { x.remove(); removed++; }
    for (const m of r.querySelectorAll('meta')) if (!KEEP_META(m)) { m.remove(); metas++; }
    for (const e of r.querySelectorAll('*')) for (const a of [...e.attributes]) if (TRACK_ATTR.test(a.name)) { e.removeAttribute(a.name); attrs++; }
  }
  return { metas, attrs, removed, roots: roots.length };
}
// Post-process existing fixtures in place: node scrub.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs'); const { JSDOM } = await import('jsdom');
  const DIR = '../../fixtures/sites'; const M = JSON.parse(fs.readFileSync(`${DIR}/manifest.json`, 'utf8'));
  for (const slug of Object.keys(M)) {
    const f = `${DIR}/${slug}.html`; if (!fs.existsSync(f)) continue;
    const dom = new JSDOM(fs.readFileSync(f, 'utf8')); const n = scrub(dom.window.document);
    const html = dom.serialize(); fs.writeFileSync(f, html); M[slug].bytes = html.length; M[slug].scrubbed = true;
    console.log(slug, n);
  }
  fs.writeFileSync(`${DIR}/manifest.json`, JSON.stringify(M, null, 2) + '\n');
}
