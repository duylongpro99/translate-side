// The page's half of the side-by-side link (plan M5-E1, DESIGN.md §3 "Hover link" and "Scroll
// sync"), in the content script over the live elements extractPage found for each segment:
// - hover: which segment's block the pointer is over (`watchHover`), and drawing the highlight the
//   panel asks for (`createHighlighter`);
// - scroll: putting a segment's block at the top of the window (`scrollToSegment`).
// The page is never changed: the highlight is a CSS Custom Highlight (a range painted by a
// ::highlight() rule), so no element, class or attribute is added and layout does not move.
import type { ViewportTarget } from './viewport.ts';

/** The highlight's name in `CSS.highlights`. */
export const HIGHLIGHT_NAME = 'translate-side-link';
const STYLE_ID = 'translate-side-link-style';

type Highlights = { set(name: string, h: unknown): void; delete(name: string): void };
type Win = Window & { CSS?: { highlights?: Highlights }; Highlight?: new (...ranges: Range[]) => unknown };

export interface Highlighter {
  /** Paints the target (or clears the highlight). Returns whether anything is shown. */
  show(target: ViewportTarget | undefined): boolean;
  clear(): void;
}

/** A Range over what the target covers: the text of an element, or the Range itself. */
export function rangeOf(doc: Document, target: ViewportTarget): Range {
  if ((target as Node).nodeType !== 1) return target as Range;
  const r = doc.createRange();
  r.selectNodeContents(target as Element);
  return r;
}

export function createHighlighter(win: Window): Highlighter {
  const w = win as Win;
  const highlights = w.CSS?.highlights;
  const Highlight = w.Highlight;
  const doc = win.document;
  let styled = false;
  const clear = () => highlights?.delete(HIGHLIGHT_NAME);
  return {
    clear,
    show(target) {
      clear();
      if (!target || !highlights || !Highlight) return false;
      if (!styled) {
        // A <style> in <head>: the change watch ignores <head>, and a content script's style is not blocked by the page's CSP.
        const style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(255, 200, 0, 0.45); color: inherit; }`;
        (doc.head ?? doc.documentElement).append(style);
        styled = true;
      }
      const range = rangeOf(doc, target);
      if (range.collapsed) return false;
      highlights.set(HIGHLIGHT_NAME, new Highlight(range));
      return true;
    },
  };
}

/**
 * The segment whose block holds a point of the page, the most specific one: a segment that has its
 * own text Range wins over the element it shares with others; of the elements that contain the
 * node, the deepest. Undefined over no segment.
 */
export function segmentAt(doc: Document, targets: ReadonlyMap<string, ViewportTarget>, order: readonly string[], node: Node | null, x: number, y: number): string | undefined {
  if (!node) return undefined;
  const ranges = order.filter((id) => {
    const t = targets.get(id);
    return t !== undefined && (t as Node).nodeType !== 1;
  });
  if (ranges.length > 0) {
    const caret = caretAt(doc, x, y);
    if (caret) {
      for (const id of ranges) {
        try {
          if ((targets.get(id) as Range).isPointInRange(caret.node, caret.offset)) return id;
        } catch {
          // The caret is in another tree than the range: not it.
        }
      }
    }
  }
  let best: { id: string; el: Element } | undefined;
  for (const id of order) {
    const t = targets.get(id);
    if (!t || (t as Node).nodeType !== 1) continue;
    const el = t as Element;
    if (!el.contains(node)) continue;
    // Deeper wins; the first of segments that share one element.
    if (!best || (best.el !== el && best.el.contains(el))) best = { id, el };
  }
  return best?.id;
}

function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | undefined {
  const d = doc as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null };
  const pos = d.caretPositionFromPoint?.(x, y);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const r = d.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : undefined;
}

export interface HoverWatch {
  stop(): void;
}

/**
 * Reports the segment under the pointer, when it changes (`onHover(undefined)`: off every block,
 * or the pointer left the page). The pointer is read at most once per animation frame.
 */
export function watchHover(win: Window, targets: ReadonlyMap<string, ViewportTarget>, order: readonly string[], onHover: (id: string | undefined) => void): HoverWatch {
  const doc = win.document;
  let last: string | undefined;
  let at: { node: Node | null; x: number; y: number } | undefined;
  let frame: number | undefined;
  const report = (id: string | undefined) => {
    if (id === last) return;
    last = id;
    onHover(id);
  };
  const resolve = () => {
    frame = undefined;
    if (at) report(segmentAt(doc, targets, order, at.node, at.x, at.y));
  };
  const onMove = (e: MouseEvent) => {
    at = { node: e.target as Node | null, x: e.clientX, y: e.clientY };
    frame ??= win.requestAnimationFrame(resolve);
  };
  const onLeave = () => {
    at = undefined;
    report(undefined);
  };
  doc.addEventListener('mousemove', onMove, { capture: true, passive: true });
  doc.documentElement.addEventListener('mouseleave', onLeave);
  return {
    stop() {
      doc.removeEventListener('mousemove', onMove, { capture: true });
      doc.documentElement.removeEventListener('mouseleave', onLeave);
      if (frame !== undefined) win.cancelAnimationFrame(frame);
    },
  };
}

/** The nearest ancestor that scrolls (an inner pane of a docs site), else the window's scroller. */
function scrollerOf(win: Window, from: Node): Element | undefined {
  for (let el = from.nodeType === 1 ? (from as Element) : from.parentElement; el; el = el.parentElement) {
    if (el === win.document.documentElement || el === win.document.body) return undefined;
    const overflow = win.getComputedStyle(el).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight) return el;
  }
  return undefined;
}

/**
 * Scrolls so that `offset` (0–1) of the segment's block is at the top of the window: the same
 * point of the same block the panel shows (by segment id, not by pixel ratio). Returns whether
 * the page scrolled: false for a segment that is not laid out (hidden, gone) or already there.
 */
export function scrollToSegment(win: Window, target: ViewportTarget | undefined, offset: number): boolean {
  if (!target || typeof target.getBoundingClientRect !== 'function') return false;
  if ((target as Node).nodeType === 1 && !(target as Element).isConnected) return false;
  const rect = target.getBoundingClientRect();
  if (rect.height <= 0 && rect.width <= 0) return false;
  const delta = Math.round(rect.top + Math.min(1, Math.max(0, offset)) * rect.height);
  if (Math.abs(delta) < 1) return false;
  const scroller = scrollerOf(win, (target as Range).commonAncestorContainer ?? (target as Node));
  if (scroller) scroller.scrollBy({ top: delta, behavior: 'instant' });
  else win.scrollBy({ top: delta, behavior: 'instant' });
  return true;
}
