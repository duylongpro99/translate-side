// UI noise removal for the walk (decision S3): landmark chrome, generic in-content rules (G) and
// per-generator rules (S). Ported from spikes/s3/walk.mjs and noise-selectors.mjs. The S rules
// were written from the fixtures, so they may overfit (S3 caveat); keep each one keyed to markup
// its generator always emits.

/**
 * Removed inside the walk root. Inactive tab panels are hidden but kept (S3): by role here, and
 * any panel compose.ts recognized (it marks them `data-ts-hidden`).
 */
export const LANDMARK_NOISE = [
  'nav',
  'aside',
  'footer',
  '[role=navigation]',
  '[role=complementary]',
  '[role=contentinfo]',
  '[role=search]',
  'form',
  'dialog',
  'button',
  '[aria-hidden=true]:not([role=tabpanel]):not([data-ts-hidden])',
  '[hidden]:not([role=tabpanel]):not([data-ts-hidden])',
  'svg',
].join(', ');

/** G: generic in-content UI, no site names. */
export const GENERIC_NOISE = [
  '.sr-only',
  '.visually-hidden',
  '.screen-reader-text', // visually hidden helper text
  '[class*=paywall i]',
  '[data-testid=paywall]', // paywall boxes
  '[class*=editsection i]',
  'a[href*="action=edit"]', // edit-this-section links
];

export type Generator = 'Docusaurus' | 'MDN' | 'rustdoc' | 'MediaWiki' | 'WordPress' | 'GoDev';

/** S: per-generator cleanup selectors. */
export const GENERATOR_NOISE: Record<Generator, string[]> = {
  Docusaurus: ['.theme-doc-version-badge', '[class*=browserWindowHeader]', '[class*=playgroundHeader]'],
  MDN: ['.baseline-indicator', '.bc-toolbar', '.article-footer'],
  rustdoc: ['rustdoc-toolbar', '.main-heading .sub-heading', 'summary.hideme'],
  MediaWiki: [
    '.catlinks',
    '.shortdescription',
    '.vector-body-before-content',
    '.vector-page-titlebar .vector-dropdown',
    '.cite-accessibility-label',
    '.cs1-visible-error',
  ],
  // WordPress core conventions (comment form, widget areas) plus the Global Voices theme's
  // related-story and term lists.
  WordPress: ['#respond', '.widget-container', '.headlines-container', '.post-terms-container', '.post-translations-container'],
  GoDev: ['.prevnext'],
};

/**
 * Detect the generator from markup it always emits. URL checks use the document's base URL,
 * which is the page URL on a live page and the original URL in a saved fixture (`<base href>`).
 */
export function detectGenerator(doc: Document): Generator | null {
  const gen = doc.querySelector('meta[name=generator]')?.getAttribute('content') ?? '';
  const url = doc.baseURI;
  if (/docusaurus/i.test(gen)) return 'Docusaurus';
  if (/mediawiki/i.test(gen) || doc.querySelector('.mw-parser-output')) return 'MediaWiki';
  if (doc.querySelector('rustdoc-toolbar, meta[name=rustdoc-vars]')) return 'rustdoc';
  if (doc.querySelector('.bc-table, .baseline-indicator') && /^https:\/\/developer\.mozilla\.org\//.test(url)) return 'MDN';
  if (/wordpress/i.test(gen)) return 'WordPress';
  if (/^https:\/\/go\.dev\//.test(url)) return 'GoDev';
  return null;
}

/** Permalink anchors whose text has no letters or digits (¶, §, #, zero-width space). */
const isGlyphAnchor = (a: Element) => (a.getAttribute('href') ?? '').startsWith('#') && !/[\p{L}\p{N}]/u.test(a.textContent ?? '');

/** G (+ S when a generator is known), applied to the working copy before the walk. */
export function stripInContent(root: Element, generator: Generator | null): void {
  const selectors = [...GENERIC_NOISE, ...(generator ? GENERATOR_NOISE[generator] : [])];
  root.querySelectorAll(selectors.join(', ')).forEach((e) => e.remove());
  root.querySelectorAll('a').forEach((a) => isGlyphAnchor(a) && a.remove());
}

/** Language switchers: lists whose links mostly carry lang/hreflang. */
function isLanguageList(list: Element): boolean {
  const links = [...list.querySelectorAll('a')];
  return links.length >= 5 && links.filter((a) => a.hasAttribute('hreflang') || a.hasAttribute('lang')).length / links.length >= 0.8;
}

/** Landmark chrome and language switchers inside the walk root. */
export function stripLandmarks(root: Element): void {
  root.querySelectorAll(LANDMARK_NOISE).forEach((e) => e.remove());
  root.querySelectorAll('ul, ol').forEach((l) => isLanguageList(l) && l.remove());
}
