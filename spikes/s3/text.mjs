export const norm = (s) => s.replace(/\s+/g, ' ').trim();
export const words = (s) => norm(s).toLowerCase().split(' ').filter(Boolean);
export const shingles = (s, k = 5) => { const w = words(s), out = new Set(); for (let i = 0; i + k <= w.length; i++) out.add(w.slice(i, i + k).join(' ')); return out; };
// Join text nodes with spaces so shingles don't depend on how each method puts whitespace between blocks.
export const textOf = (el) => {
  const c = el.cloneNode(true); c.querySelectorAll('style, script, noscript, svg, template').forEach((e) => e.remove());
  const w = c.ownerDocument.createTreeWalker(c, 4); let out = '', n; while ((n = w.nextNode())) out += ' ' + n.nodeValue; return out;
};
export const pres = (el) => [...el.querySelectorAll('pre')].map((p) => norm(p.textContent)).filter(Boolean);
