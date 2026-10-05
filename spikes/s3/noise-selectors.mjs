// Optional in-content noise removal, tried on top of the walk (and before Readability) for B1 before/after.
// G = generic: no site names, applies to any page. S = per-generator: keyed to markup of one generator.
export const GENERIC = [
  '.sr-only', '.visually-hidden', '.screen-reader-text',             // visually hidden helper text
  '[class*=paywall i]', '[data-testid=paywall]',                     // paywall boxes
  '[class*=editsection i]', 'a[href*="action=edit"]',                // edit-this-section links
];
// Permalink anchors whose text has no letters or digits (¶, §, #, zero-width space).
export const isGlyphAnchor = (a) => (a.getAttribute('href') ?? '').startsWith('#') && !/[\p{L}\p{N}]/u.test(a.textContent);
export const GENERATOR = {
  Docusaurus: ['.theme-doc-version-badge', '[class*=browserWindowHeader]', '[class*=playgroundHeader]'],
  MDN: ['.baseline-indicator', '.bc-toolbar', '.article-footer'],
  rustdoc: ['rustdoc-toolbar', '.main-heading .sub-heading', 'summary.hideme'],
  MediaWiki: ['.catlinks', '.shortdescription', '.vector-body-before-content', '.vector-page-titlebar .vector-dropdown', '.cite-accessibility-label', '.cs1-visible-error'],
  // WordPress core conventions (comment form, widget areas) plus the Global Voices theme's related-story and term lists.
  WordPress: ['#respond', '.widget-container', '.headlines-container', '.post-terms-container', '.post-translations-container'],
  GoDev: ['.prevnext'],
};
// Generator detection from markup the generator always emits.
export function detectGenerator(doc) {
  const gen = doc.querySelector('meta[name=generator]')?.content ?? '';
  if (/docusaurus/i.test(gen)) return 'Docusaurus';
  if (/mediawiki/i.test(gen) || doc.querySelector('.mw-parser-output')) return 'MediaWiki';
  if (doc.querySelector('rustdoc-toolbar, meta[name=rustdoc-vars]')) return 'rustdoc';
  if (doc.querySelector('.bc-table, .baseline-indicator') && /developer\.mozilla\.org/.test(doc.URL)) return 'MDN';
  if (/wordpress/i.test(gen)) return 'WordPress';
  if (/^https:\/\/go\.dev\//.test(doc.URL)) return 'GoDev';
  return null;
}
export function stripInContent(root, { generic = true, generator = null } = {}) {
  const sels = [...(generic ? GENERIC : []), ...(generator ? GENERATOR[generator] ?? [] : [])];
  if (sels.length) root.querySelectorAll(sels.join(', ')).forEach((e) => e.remove());
  if (generic) root.querySelectorAll('a').forEach((a) => isGlyphAnchor(a) && a.remove());
}
