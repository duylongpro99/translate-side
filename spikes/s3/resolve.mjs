// Find a concrete article URL on index pages (Substack, Guardian, Medium) so the fixture list can be frozen.
import { launch, openPage } from './cdp.mjs';
const cdp = await launch();
for (const [u, pat] of [['https://newsletter.pragmaticengineer.com/archive', '/p/'], ['https://www.theguardian.com/technology', '/technology/20'], ['https://medium.com/tag/rust', '-'], ['https://gitbook.com/docs/creating-content/blocks/code-block', '']]) {
  const p = await openPage(cdp, u);
  await new Promise((r) => setTimeout(r, 4000));
  console.log(u, '->', await p.ev(`document.title + ' | ' + [...new Set([...document.querySelectorAll('a[href*="${pat}"]')].map(a => a.href))].slice(0, 6).join(' ')`));
  await p.close();
}
await cdp.close();
