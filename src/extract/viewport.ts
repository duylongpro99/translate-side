// What is on screen (plan M3-E1, E7; DESIGN.md §4.1 "an IntersectionObserver reports which segment
// IDs are on screen, used for priority and scroll sync"). Runs in the content script, over the
// live elements extractPage found for each segment. An IntersectionObserver keeps the set of
// elements on screen; scroll events (any scroller, so docs sites with an inner scroll pane count)
// move the anchor. Changes are pushed at most every `throttleMs`, and only when they differ.
import type { Viewport } from '@/shared/protocol';

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

/**
 * Watches the elements of `targets` (segment id → live element). `order` is the segments' page
 * order. `onChange` gets each new viewport, starting from the first change after `now()`.
 */
export function watchViewport(win: Window, targets: ReadonlyMap<string, Element>, order: readonly string[], onChange: (v: Viewport) => void, opts: ViewportOptions = {}): ViewportWatch {
  const throttleMs = opts.throttleMs ?? VIEWPORT_THROTTLE_MS;
  const doc = win.document;
  // An element may hold several segments (the `#run[k]` blocks of one container): page order.
  const idsOf = new Map<Element, string[]>();
  for (const id of order) {
    const el = targets.get(id);
    if (!el) continue;
    const ids = idsOf.get(el);
    if (ids) ids.push(id);
    else idsOf.set(el, [id]);
  }

  const onScreen = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return r.width + r.height > 0 && r.bottom > 0 && r.top < win.innerHeight && r.right > 0 && r.left < win.innerWidth;
  };

  // With an observer, the set it reports; without one (old engines, tests), the layout each time.
  const Observer = (win as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  const shown = new Set<Element>();
  for (const el of idsOf.keys()) if (onScreen(el)) shown.add(el);

  const read = (): Viewport => {
    if (!Observer) {
      shown.clear();
      for (const el of idsOf.keys()) if (onScreen(el)) shown.add(el);
    }
    const visible = order.filter((id) => {
      const el = targets.get(id);
      return el !== undefined && shown.has(el);
    });
    let top: { el: Element; rect: DOMRect } | undefined;
    for (const el of shown) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.height <= 0) continue;
      if (!top || rect.top < top.rect.top) top = { el, rect };
    }
    const id = top && idsOf.get(top.el)?.[0];
    if (!top || id === undefined) return { visible };
    const offset = Math.min(1, Math.max(0, -top.rect.top / top.rect.height));
    return { visible, anchor: { id, offset: Math.round(offset * 1000) / 1000 } };
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
  for (const el of idsOf.keys()) observer?.observe(el);
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
