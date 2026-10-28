import { useEffect, useState } from 'preact/hooks';
import { i18n } from '#i18n';

/** The settings page's sections in page order: each section's id and its heading's message. */
export const SECTIONS = [
  ['providers', 'options.providers.title'],
  ['languages', 'options.languages.title'],
  ['translation-style', 'options.style.title'],
  ['quality', 'options.quality.title'],
  ['glossary', 'options.glossary.title'],
  ['sites', 'options.sites.title'],
  ['shortcuts', 'options.shortcuts.title'],
  ['voice', 'options.voice.title'],
  ['spend', 'options.spend.title'],
  ['cache', 'options.cache.title'],
  ['memory', 'options.memory.title'],
  ['transfer', 'options.transfer.title'],
  ['diagnostics', 'options.diagnostics.title'],
] as const;

/**
 * The section index: a link to each section by its id (so #sites and #memory deep links still
 * land), the one in view marked with aria-current. A sticky column on a wide page, a wrapping row
 * at the top of a narrow one (CSS).
 */
export function OptionsNav() {
  const [current, setCurrent] = useState<string>(SECTIONS[0][0]);
  // Only sections the page has (the cache and memory sections are absent without IndexedDB): no dead links.
  const [present, setPresent] = useState<readonly string[] | undefined>(undefined);
  useEffect(() => {
    // Sections render as their data loads: the list follows them.
    const sync = () => {
      const now = SECTIONS.map(([id]) => id).filter((id) => document.getElementById(id));
      setPresent((cur) => (cur && cur.join() === now.join() ? cur : now));
    };
    sync();
    let watch: () => void = () => undefined;
    const pageChanges = new MutationObserver(() => {
      sync();
      watch();
    });
    pageChanges.observe(document.body, { childList: true, subtree: true });
    if (typeof IntersectionObserver === 'undefined') return () => pageChanges.disconnect();
    const visible = new Set<string>();
    // In view: the section crossing the upper part of the window; the first one in page order wins. At the
    // bottom of the page the last sections may never reach that band: the last one in view wins there.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        const { scrollHeight } = document.documentElement;
        const atBottom = scrollHeight > window.innerHeight && window.innerHeight + window.scrollY >= scrollHeight - 2;
        const shown = SECTIONS.filter(([id]) => visible.has(id));
        const pick = atBottom ? shown[shown.length - 1] : shown[0];
        if (pick) setCurrent(pick[0]);
      },
      { rootMargin: '0px 0px -60% 0px' },
    );
    const watched = new Set<Element>();
    watch = () => {
      for (const [id] of SECTIONS) {
        const el = document.getElementById(id);
        if (el && !watched.has(el)) {
          watched.add(el);
          observer.observe(el);
        }
      }
    };
    watch();
    return () => {
      observer.disconnect();
      pageChanges.disconnect();
    };
  }, []);
  return (
    <nav class="opt__nav" aria-label={i18n.t('options.nav.label')} data-testid="options-nav">
      <ul>
        {SECTIONS.filter(([id]) => present === undefined || present.includes(id)).map(([id, title]) => (
          <li key={id}>
            <a href={`#${id}`} {...(current === id ? { 'aria-current': 'true' } : {})} onClick={() => setCurrent(id)}>
              {i18n.t(title)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
