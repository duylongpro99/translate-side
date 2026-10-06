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
  '[class*=editsection i]',
  'a[href*="action=edit"]', // edit-this-section links
];

export type Generator = 'Docusaurus' | 'MDN' | 'rustdoc' | 'MediaWiki' | 'WordPress' | 'GoDev' | 'MkDocs';

/** S: per-generator cleanup selectors. */
export const GENERATOR_NOISE: Record<Generator, string[]> = {
  Docusaurus: ['.theme-doc-version-badge', '[class*=browserWindowHeader]', '[class*=playgroundHeader]'],
  // Code-example headers (language label, copy button) and the compat table's icon legend.
  MDN: ['.baseline-indicator', '.bc-toolbar', '.article-footer', '.code-example > .example-header', '.bc-legend'],
  // Feature/platform badges glued to item names in the module and re-export lists.
  rustdoc: ['rustdoc-toolbar', '.main-heading .sub-heading', 'summary.hideme', '.item-table .stab'],
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
  MkDocs: [],
};

/**
 * S, removed only when the element is all the text of its parent: a version badge on a line of
 * its own is metadata, but the same badge inside a sentence ("Prior to 8.5.6, …") is a word of it.
 */
export const GENERATOR_STANDALONE_NOISE: Partial<Record<Generator, string[]>> = {
  MkDocs: ['.mdx-badge'], // Material for MkDocs' own docs: "minimum version" badges
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
  if (/^mkdocs\b/i.test(gen)) return 'MkDocs';
  return null;
}

/**
 * Paywall boxes ("Subscribe to keep reading"). Matched loosely by class, so only a small box is
 * removed: some news CMSs wrap the article body itself in `.paywall-content`. Limit: a site that
 * puts a paywall class on each paragraph would lose every paragraph (S3 follow-ups).
 */
const PAYWALL = '[class*=paywall i], [data-testid=paywall]';
const PAYWALL_MAX_CHARS = 500;
const isPaywallBox = (el: Element) =>
  !el.querySelector('main, article, [role=main]') && (el.textContent ?? '').replace(/\s+/g, ' ').trim().length < PAYWALL_MAX_CHARS;

const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '');
const isStandalone = (el: Element) => !!el.parentElement && squash(el.parentElement.textContent) === squash(el.textContent);

/** Permalink anchors whose text has no letters or digits (¶, §, #, zero-width space). */
const isGlyphAnchor = (a: Element) => (a.getAttribute('href') ?? '').startsWith('#') && !/[\p{L}\p{N}]/u.test(a.textContent ?? '');

/** G (+ S when a generator is known), applied to the working copy before the walk. */
export function stripInContent(root: Element, generator: Generator | null): void {
  const selectors = [...GENERIC_NOISE, ...(generator ? GENERATOR_NOISE[generator] : [])];
  root.querySelectorAll(selectors.join(', ')).forEach((e) => e.remove());
  root.querySelectorAll(PAYWALL).forEach((e) => isPaywallBox(e) && e.remove());
  const standalone = generator ? GENERATOR_STANDALONE_NOISE[generator] : undefined;
  if (standalone?.length) root.querySelectorAll(standalone.join(', ')).forEach((e) => isStandalone(e) && e.remove());
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
