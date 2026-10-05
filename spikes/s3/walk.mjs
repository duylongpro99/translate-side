import { textOf, norm } from './text.mjs';
// Removed from the walk result. Inactive tab panels are hidden but kept (the reader can switch tabs).
export const NOISE = 'nav, aside, footer, [role=navigation], [role=complementary], [role=contentinfo], [role=search], form, dialog, button, ' +
  '[aria-hidden=true], [hidden]:not([role=tabpanel]), style, script, noscript, svg, template';

const len = (e) => norm(textOf(e)).length;
export const linkDensity = (e) => { const t = len(e) || 1; let l = 0; for (const a of e.querySelectorAll('a')) l += norm(a.textContent).length; return l / t; };

// Language switchers: lists whose links mostly carry lang/hreflang.
function isLanguageList(list) {
  const a = list.querySelectorAll('a');
  return a.length >= 5 && [...a].filter((x) => x.hasAttribute('hreflang') || x.hasAttribute('lang')).length / a.length >= 0.8;
}

export function walkRoot(doc) {
  const cands = [...doc.querySelectorAll('[role=main], main, article')];
  if (!cands.length) return null;
  // Outermost main-ish element; narrow to a single dominant <article> inside it.
  let root = cands.find((c) => c.matches('[role=main], main')) ?? cands[0];
  const rootLen = len(root);
  const dom = [...root.querySelectorAll('article')].filter((a) => len(a) >= 0.5 * rootLen);
  if (dom.length === 1) root = dom[0];
  return root;
}

export function walk(doc) {
  const root = walkRoot(doc);
  if (!root) return null;
  const c = root.cloneNode(true);
  c.querySelectorAll(NOISE).forEach((e) => e.remove());
  c.querySelectorAll('ul, ol').forEach((l) => isLanguageList(l) && l.remove());
  return c;
}

// Proposed policy (see docs/decisions/S3): walk first, Readability when the walk is missing or poor.
export const WALK_MIN_CHARS = 500;
export const WALK_MAX_LINK_DENSITY = 0.35;
export function walkIsGood(w) {
  return !!w && len(w) >= WALK_MIN_CHARS && linkDensity(w) <= WALK_MAX_LINK_DENSITY;
}
