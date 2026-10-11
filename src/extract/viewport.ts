// What is on screen (plan M3-E1, E7; DESIGN.md §4.1 "an IntersectionObserver reports which segment
// IDs are on screen, used for priority and scroll sync"). Runs in the content script, over the
// live elements extractPage found for each segment. An IntersectionObserver keeps the set of
// elements on screen; scroll events (any scroller, so docs sites with an inner scroll pane count)
// move the anchor. Changes are pushed at most every `throttleMs`, and only when they differ.
import type { Viewport } from '@/shared/protocol';
import { edgeOf } from './link.ts';

export interface ViewportWatch {
  /** What is on screen now, worked out from the layout (no observer needed). */
  now(): Viewport;
  stop(): void;
}

export interface ViewportOptions {
  /** Least time between two pushes. */
  throttleMs?: number;
}

export const VIEWPORT_THROTTLE_MS = 50;

/** Where a segment is on the page: its element, or a Range over its own text (extractPage). */
export type ViewportTarget = Element | Range;

/**
 * Watches the elements of `targets` (segment id → live element or text Range). A Range has no
 * IntersectionObserver: it is measured on each read (scroll-throttled). `order` is the segments' page
 * order. `onChange` gets each new viewport, starting from the first change after `now()`. An
 * element shared by several segments and taller than the window does not count (see `coarse`).
 */
export function watchViewport(win: Window, targets: ReadonlyMap<string, ViewportTarget>, order: readonly string[], onChange: (v: Viewport) => void, opts: ViewportOptions = {}): ViewportWatch {
  const throttleMs = opts.throttleMs ?? VIEWPORT_THROTTLE_MS;
  const doc = win.document;
  // An element may hold several segments (the `#run[k]` blocks of one container): page order.
  const idsOf = new Map<ViewportTarget, string[]>();
  for (const id of order) {
    const el = targets.get(id);
    if (!el) continue;
    const ids = idsOf.get(el);
    if (ids) ids.push(id);
    else idsOf.set(el, [id]);
  }

  const onScreen = (el: ViewportTarget): boolean => {
    // Engines without Range layout (jsdom) can't place a Range: never on screen.
    if (typeof el.getBoundingClientRect !== 'function') return false;
    const r = el.getBoundingClientRect();
    return r.width + r.height > 0 && r.bottom > 0 && r.top < win.innerHeight && r.right > 0 && r.left < win.innerWidth;
  };

  // An element holding several segments that is taller than the window (on the Readability path,
  // the ancestor several made-up blocks share, up to the whole article) says nothing about which of
  // them is on screen: it is neither visible nor an anchor, or it would always be both.
  const coarse = (el: ViewportTarget, rect: DOMRect): boolean => (idsOf.get(el)?.length ?? 0) > 1 && rect.height > win.innerHeight;

  // With an observer, the set it reports; without one (old engines, tests), the layout each time.
  const Observer = (win as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  const shown = new Set<ViewportTarget>();
  for (const el of idsOf.keys()) if (onScreen(el)) shown.add(el);
  const ranges = [...idsOf.keys()].filter((t) => !isElement(t));

  const read = (): Viewport => {
    for (const t of Observer ? ranges : idsOf.keys()) {
      if (onScreen(t)) shown.add(t);
      else shown.delete(t);
    }
    const rects = new Map<ViewportTarget, DOMRect>();
    for (const el of shown) {
      const rect = el.getBoundingClientRect();
      if (!coarse(el, rect)) rects.set(el, rect);
    }
    // A fixed or sticky box is on screen wherever the reader is: apart from `visible`, and never the anchor.
    let pinned = new Set<ViewportTarget>();
    const seen = new Map<Element, boolean>();
    for (const el of rects.keys()) if (isPinned(win, el, seen)) pinned.add(el);
    // Everything on screen pinned (a shell the checks missed): nothing is, or the reader would be nowhere.
    if (pinned.size === rects.size) pinned = new Set();
    const shownIds = order.filter((id) => {
      const el = targets.get(id);
      return el !== undefined && rects.has(el);
    });
    const visible = shownIds.filter((id) => !pinned.has(targets.get(id) as ViewportTarget));
    const fixed = shownIds.filter((id) => pinned.has(targets.get(id) as ViewportTarget));
    const pin = fixed.length > 0 ? { fixed } : {};
    let top: { el: ViewportTarget; rect: DOMRect } | undefined;
    for (const [el, rect] of rects) {
      // Under the scroller's edge counts as scrolled out, the edge the offset is measured from.
      if (pinned.has(el) || rect.bottom <= edgeOf(win, el) || rect.height <= 0) continue;
      if (!top || rect.top < top.rect.top) top = { el, rect };
    }
    const id = top && idsOf.get(top.el)?.[0];
    if (!top || id === undefined) return { visible, ...pin };
    const offset = Math.min(1, Math.max(0, (edgeOf(win, top.el) - top.rect.top) / top.rect.height));
    return { visible, ...pin, anchor: { id, offset: Math.round(offset * 1000) / 1000 } };
  };

  let last = JSON.stringify(read());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPush = 0;
  let stopped = false;
  const flush = () => {
    timer = undefined;
    if (stopped) return;
    lastPush = Date.now();
    const v = read();
    const key = JSON.stringify(v);
    if (key === last) return;
    last = key;
    onChange(v);
  };
  const schedule = () => {
    if (stopped || timer !== undefined) return;
    timer = setTimeout(flush, Math.max(0, throttleMs - (Date.now() - lastPush)));
  };

  const observer = Observer
    ? new Observer((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) shown.add(e.target);
          else shown.delete(e.target);
        }
        schedule();
      })
    : undefined;
  for (const el of idsOf.keys()) if (isElement(el)) observer?.observe(el);
  const onScroll = () => schedule();
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
  win.addEventListener('resize', onScroll, { passive: true });

  return {
    now: () => {
      const v = read();
      last = JSON.stringify(v);
      return v;
    },
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      observer?.disconnect();
      doc.removeEventListener('scroll', onScroll, { capture: true });
      win.removeEventListener('resize', onScroll);
    },
  };
}

/**
 * Whether one box pins what is inside it to the window: `position: fixed`, or `sticky` while it is
 * stuck at its offset. Not these: a fixed box that is a scroll container or covers most of the window
 * (an app shell or reader wrapping the article, whose content scrolls inside it), and a sticky box
 * in normal flow (a table header or heading that has not reached its edge scrolls like content).
 */
function pins(win: Window, el: Element): boolean {
  const style = win.getComputedStyle(el);
  const position = style.position;
  if (position !== 'fixed' && position !== 'sticky') return false;
  if (/auto|scroll/.test(`${style.overflowY} ${style.overflowX}`)) return false;
  const r = el.getBoundingClientRect();
  if (position === 'fixed') return !(r.width * r.height >= 0.8 * win.innerWidth * win.innerHeight);
  const near = (offset: string, edge: number) => /^-?[\d.]+px$/.test(offset) && Math.abs(edge - parseFloat(offset)) < 1.5;
  return near(style.top, r.top) || near(style.bottom, win.innerHeight - r.bottom);
}

/** Whether the target sits in a box that pins it (`pins`); `seen` shares the answer per ancestor within one read. */
function isPinned(win: Window, t: ViewportTarget, seen: Map<Element, boolean>): boolean {
  if (typeof win.getComputedStyle !== 'function') return false;
  const start: Element | null = isElement(t) ? t : t.startContainer.nodeType === 1 ? (t.startContainer as Element) : t.startContainer.parentElement;
  const path: Element[] = [];
  let found = false;
  for (let el = start; el !== null && el !== win.document.documentElement; el = el.parentElement) {
    const known = seen.get(el);
    if (known !== undefined) {
      found = known;
      break;
    }
    path.push(el);
    if (pins(win, el)) {
      found = true;
      break;
    }
  }
  // Every element walked has the same answer from here up (an ancestor that pins pins what is under it).
  if (found) for (const el of path) seen.set(el, true);
  else for (const el of path) if (!seen.has(el)) seen.set(el, false);
  return found;
}

function isElement(t: ViewportTarget): t is Element {
  return (t as Node).nodeType === 1;
}
