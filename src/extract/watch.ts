// Watches the page for changes after it was read (plan M5-E2, DESIGN §4.1 "a MutationObserver plus
// URL-change detection handles SPAs"; §9). SPA frameworks re-render constantly (plan M5 §8 risk), so:
// - mutations are debounced: the page is read again once the DOM has been quiet for `settleMs`,
//   or after `maxWaitMs` of steady change at the latest;
// - mutations only inside site chrome (nav, sidebars, header, footer) or <head> are ignored: the
//   reader's content is in main (an active sidebar link changing is not a new page);
// - a page that keeps changing (a ticker, a live feed) is read less often: each change reported
//   within `stormWindowMs` of the one before doubles the settle time, up to `maxSettleMs`.
// URL changes (history.pushState, back/forward, hash) are caught by the mutations they cause, and
// by popstate/hashchange and the Navigation API where the browser has it, so a route change whose
// DOM update lands first is not missed.

export interface ChangeWatchOptions {
  settleMs?: number;
  maxWaitMs?: number;
  maxSettleMs?: number;
  stormWindowMs?: number;
}

export interface ChangeWatch {
  stop(): void;
  /** Tell the watch whether the last settle produced a change (it slows down under a storm). */
  reported(changed: boolean): void;
}

/** Elements whose own changes never make a new page: site chrome around the content. */
const CHROME = 'head, nav, aside, header, footer, [role=navigation], [role=complementary], [role=banner], [role=contentinfo]';

const MAIN = 'main, article, [role=main]';

/** Is every node this mutation touched inside site chrome (or not in the page at all)? */
function inChrome(record: MutationRecord): boolean {
  const target = record.target.nodeType === 1 ? (record.target as Element) : record.target.parentElement;
  if (!target) return true;
  const chrome = target.closest(CHROME);
  if (!chrome) return false;
  // An article's own <header> (its title) is content, not chrome; so is a wrapper that holds the content.
  return !chrome.closest(MAIN) && !chrome.querySelector(MAIN);
}

export function watchChanges(win: Window, onSettled: () => void, opts: ChangeWatchOptions = {}): ChangeWatch {
  const base = opts.settleMs ?? 500;
  const maxWait = opts.maxWaitMs ?? 3000;
  const maxSettle = opts.maxSettleMs ?? 8000;
  const stormWindow = opts.stormWindowMs ?? 5000;
  let settle = base;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  let lastChange = -Infinity;
  let stopped = false;

  const fire = () => {
    clearTimeout(settleTimer);
    clearTimeout(maxTimer);
    settleTimer = undefined;
    maxTimer = undefined;
    if (!stopped) onSettled();
  };
  const poke = () => {
    if (stopped) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(fire, settle);
    maxTimer ??= setTimeout(fire, Math.max(maxWait, settle));
  };

  const observer = new (win as Window & typeof globalThis).MutationObserver((records: MutationRecord[]) => {
    if (records.some((r) => !inChrome(r))) poke();
  });
  observer.observe(win.document.documentElement, { childList: true, subtree: true, characterData: true });
  const onNav = () => poke();
  win.addEventListener('popstate', onNav);
  win.addEventListener('hashchange', onNav);
  const nav = (win as Window & { navigation?: EventTarget }).navigation;
  nav?.addEventListener('navigatesuccess', onNav);

  return {
    stop() {
      stopped = true;
      observer.disconnect();
      clearTimeout(settleTimer);
      clearTimeout(maxTimer);
      win.removeEventListener('popstate', onNav);
      win.removeEventListener('hashchange', onNav);
      nav?.removeEventListener('navigatesuccess', onNav);
    },
    reported(changed) {
      if (!changed) return;
      const now = Date.now();
      settle = now - lastChange < stormWindow ? Math.min(settle * 2, maxSettle) : base;
      lastChange = now;
    },
  };
}
