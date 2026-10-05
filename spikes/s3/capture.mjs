// Save a rendered-DOM snapshot of each site (scripts removed, <base> added) into fixtures/sites/.
import fs from 'node:fs';
import { launch, openPage } from './cdp.mjs';
import { JSDOM } from 'jsdom';
const OUT = '../../fixtures/sites';
fs.mkdirSync(OUT, { recursive: true });
const sites = JSON.parse(fs.readFileSync('sites.json', 'utf8'));
const only = process.argv[2];
const cdp = await launch();
const manifest = fs.existsSync(`${OUT}/manifest.json`) ? JSON.parse(fs.readFileSync(`${OUT}/manifest.json`, 'utf8')) : {};
for (const site of sites) {
  if (only && site.slug !== only) continue;
  const p = await openPage(cdp, site.url);
  await new Promise((r) => setTimeout(r, 3000));
  await p.ev(`(async () => { for (let y = 0; y < document.body.scrollHeight; y += 800) { scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); } scrollTo(0, 0); })()`);
  await new Promise((r) => setTimeout(r, 2000));
  // Serialize open shadow roots as declarative shadow DOM (<template shadowrootmode>), so fixtures keep web-component content.
  const snap = await p.ev(`(() => {
    const roots = []; let open = 0, closedGuess = 0;
    const walk = (n) => { for (const e of n.querySelectorAll('*')) { if (e.shadowRoot) { roots.push(e.shadowRoot); open++; walk(e.shadowRoot); } else if (e.tagName.includes('-') && !customElements.get(e.localName)) {} } };
    walk(document);
    const html = document.documentElement.getHTML({ shadowRoots: roots });
    return JSON.stringify({ html, title: document.title, finalUrl: location.href, openShadowRoots: open,
      contentFound: !!document.querySelector(${JSON.stringify(site.contentSelector)}) });
  })()`);
  const s = JSON.parse(snap);
  const dom = new JSDOM(`<!doctype html><html>${s.html}</html>`);
  const D = dom.window.document;
  D.querySelectorAll('script, noscript, iframe, template:not([shadowrootmode])').forEach((e) => e.remove());
  for (const t of D.querySelectorAll('template[shadowrootmode]')) t.content.querySelectorAll('script, noscript, iframe').forEach((e) => e.remove());
  const base = D.createElement('base'); base.href = s.finalUrl; D.head.prepend(base);
  s.html = dom.serialize();
  fs.writeFileSync(`${OUT}/${site.slug}.html`, s.html);
  manifest[site.slug] = { ...site, finalUrl: s.finalUrl, title: s.title, capturedAt: new Date().toISOString(), bytes: s.html.length, openShadowRoots: s.openShadowRoots, contentFound: s.contentFound };
  console.log(site.slug, s.title.slice(0, 60), s.html.length, 'shadowRoots=' + s.openShadowRoots, 'contentFound=' + s.contentFound);
  await p.close();
}
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
await cdp.close();
