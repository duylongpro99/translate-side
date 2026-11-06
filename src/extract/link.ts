// The page's half of the side-by-side link (plan M5-E1, DESIGN.md §3 "Hover link" and "Scroll
// sync"), in the content script over the live elements extractPage found for each segment:
// - hover: which segment's block the pointer is over (`watchHover`), and drawing the highlight the
//   panel asks for (`createHighlighter`);
// - scroll: putting a segment's block at the top of the window (`scrollToSegment`);
// - selection: which sentences of which blocks the reader selected (`watchSelectionLink`), so the
//   panel highlights the matching sentences of their translations.
// The page's elements are never changed: the highlight is a CSS Custom Highlight (a range painted
// by a ::highlight() rule), so no class or attribute is added and layout does not move. The one
// thing added is a <style> in <head> holding that rule, put back if the page drops it and removed
// when the link ends.
import { eligibleSelection } from './selection-button.ts';
import type { ViewportTarget } from './viewport.ts';
import type { SelectedBlock } from '@/shared/protocol';
import { touchedSentences } from '@/shared/sentences';

/** The highlight's name in `CSS.highlights`. */
export const HIGHLIGHT_NAME = 'translate-side-link';
const STYLE_ID = 'translate-side-link-style';

type Highlights = { set(name: string, h: unknown): void; delete(name: string): void };
type Win = Window & { CSS?: { highlights?: Highlights }; Highlight?: new (...ranges: Range[]) => unknown };

export interface Highlighter {
  /** Ends the link: clears the highlight and removes the rule's <style>. */
  dispose(): void;
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
  let style: HTMLStyleElement | undefined;
  const clear = () => highlights?.delete(HIGHLIGHT_NAME);
  return {
    clear,
    dispose() {
      clear();
      style?.remove();
      style = undefined;
    },
    show(target) {
      clear();
      if (!target || !highlights || !Highlight) return false;
      // A <style> in <head>: the change watch ignores <head>, and a content script's style is not
      // blocked by the page's CSP. An SPA that replaced <head> took it along: put it back.
      if (!style?.isConnected) {
        style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(255, 200, 0, 0.45); color: inherit; }`;
        (doc.head ?? doc.documentElement).append(style);
      }
      const range = rangeOf(doc, target);
      if (range.collapsed) return false;
      highlights.set(HIGHLIGHT_NAME, new Highlight(range));
      return true;
    },
  };
}

/**
 * What `segmentAt` searches, worked out once per read (not on every pointer frame): the segments
 * with a text Range of their own, and the ones with an element, in page order. An element that
 * several segments share says nothing about which of them the pointer is on (on the Readability
 * path, the ancestor several made-up blocks share, up to the whole article): it is `shared`, and
 * counts only while it is no taller than the window (as in viewport.ts `coarse`).
 */
export interface LinkIndex {
  targets: ReadonlyMap<string, ViewportTarget>;
  ranges: { id: string; range: Range }[];
  elements: { id: string; el: Element }[];
  shared: ReadonlySet<Element>;
}

export function indexTargets(targets: ReadonlyMap<string, ViewportTarget>, order: readonly string[]): LinkIndex {
  const ranges: LinkIndex['ranges'] = [];
  const elements: LinkIndex['elements'] = [];
  const seen = new Map<Element, number>();
  for (const id of order) {
    const t = targets.get(id);
    if (!t) continue;
    if ((t as Node).nodeType === 1) {
      elements.push({ id, el: t as Element });
      seen.set(t as Element, (seen.get(t as Element) ?? 0) + 1);
    } else ranges.push({ id, range: t as Range });
  }
  return { targets, ranges, elements, shared: new Set([...seen].filter(([, n]) => n > 1).map(([el]) => el)) };
}

/** The segment's place on the page, unless it is a shared element too tall to say anything about it. */
export function placeOf(win: Window, index: LinkIndex, id: string): ViewportTarget | undefined {
  const t = index.targets.get(id);
  if (!t) return undefined;
  if ((t as Node).nodeType === 1 && index.shared.has(t as Element) && typeof (t as Element).getBoundingClientRect === 'function' && (t as Element).getBoundingClientRect().height > win.innerHeight) return undefined;
  return t;
}

/**
 * The segment whose block holds a point of the page, the most specific one: a segment that has its
 * own text Range wins over an element; of the elements that contain the node, the deepest. An
 * element shared by several segments that is taller than the window is skipped. Undefined over no segment.
 */
export function segmentAt(win: Window, index: LinkIndex, node: Node | null, x: number, y: number): string | undefined {
  if (!node) return undefined;
  if (index.ranges.length > 0) {
    const caret = caretAt(win.document, x, y);
    if (caret) {
      for (const { id, range } of index.ranges) {
        try {
          if (range.isPointInRange(caret.node, caret.offset)) return id;
        } catch {
          // The caret is in another tree than the range: not it.
        }
      }
    }
  }
  let best: { id: string; el: Element } | undefined;
  for (const { id, el } of index.elements) {
    if (!el.contains(node)) continue;
    if (index.shared.has(el) && el.getBoundingClientRect().height > win.innerHeight) continue;
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
export function watchHover(win: Window, index: LinkIndex, onHover: (id: string | undefined) => void): HoverWatch {
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
    if (at) report(segmentAt(win, index, at.node, at.x, at.y));
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
export function scrollerOf(win: Window, from: Node): Element | undefined {
  for (let el = from.nodeType === 1 ? (from as Element) : from.parentElement; el; el = el.parentElement) {
    if (el === win.document.documentElement || el === win.document.body) return undefined;
    const overflow = win.getComputedStyle?.(el).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight) return el;
  }
  return undefined;
}

/** Top edge, in window coordinates, of what scrolls the target: 0 for the window, else the pane's. */
export function edgeOf(win: Window, target: ViewportTarget): number {
  const scroller = scrollerOf(win, (target as Range).commonAncestorContainer ?? (target as Node));
  return scroller ? Math.max(0, scroller.getBoundingClientRect().top) : 0;
}

/**
 * Scrolls so that `offset` (0–1) of the segment's block is at the top of the window: the same
 * point of the same block the panel shows (by segment id, not by pixel ratio). Returns whether
 * the page scrolled: false for a segment that is not laid out (hidden, gone) or already there.
 */
export function scrollToSegment(win: Window, target: ViewportTarget | undefined, offset: number): boolean {
  const along = Number.isFinite(offset) ? Math.min(1, Math.max(0, offset)) : 0;
  if (!target || typeof target.getBoundingClientRect !== 'function') return false;
  if ((target as Node).nodeType === 1 && !(target as Element).isConnected) return false;
  const rect = target.getBoundingClientRect();
  if (rect.height <= 0 && rect.width <= 0) return false;
  const scroller = scrollerOf(win, (target as Range).commonAncestorContainer ?? (target as Node));
  // The point goes to the top edge of what scrolls: the window's, or an inner pane's own (the
  // viewport's anchor offset is measured from the same edge, `edgeOf`).
  const edge = edgeOf(win, target);
  const delta = Math.round(rect.top + along * rect.height - edge);
  if (Math.abs(delta) < 1) return false;
  if (scroller) scroller.scrollBy({ top: delta, behavior: 'instant' });
  else win.scrollBy({ top: delta, behavior: 'instant' });
  return true;
}

/** The language a node's text is marked as: the nearest `lang` around it, else the document's. */
function langAround(doc: Document, node: Node): string | undefined {
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return el?.closest('[lang]')?.getAttribute('lang')?.trim() || doc.documentElement.lang || undefined;
}

/**
 * The text of a block that is its own (without the blocks nested in it, `skip`), and where the part
 * `cut` of it starts and ends in that text. Empty when the cut holds none of the block's own text.
 */
function ownText(block: Range, cut: Range, skip: readonly Element[]): { text: string; start: number; end: number } {
  const common = block.commonAncestorContainer;
  const root = common.nodeType === 3 ? (common.parentNode ?? common) : common;
  const walker = (root.ownerDocument ?? (root as Document)).createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  let text = '';
  let start = -1;
  let end = -1;
  // A nested block cut out of the text leaves a space, so the sentences on each side of it stay apart.
  let gap = false;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!block.intersectsNode(node)) continue;
    if (skip.some((el) => el.contains(node))) {
      gap = text.length > 0;
      continue;
    }
    if (gap) text += ' ';
    gap = false;
    // The node's part inside the block, then inside the cut. A cut's end that lies in another node
    // or on an element boundary leaves this node wholly before or after it.
    const a = node === block.startContainer ? block.startOffset : 0;
    const b = node === block.endContainer ? block.endOffset : node.data.length;
    let x = node === cut.startContainer ? Math.max(a, cut.startOffset) : cut.comparePoint(node, a) < 0 ? b : a;
    const y = node === cut.endContainer ? Math.min(b, cut.endOffset) : cut.comparePoint(node, b) > 0 ? a : b;
    if (x > y) x = y;
    if (x < y) {
      if (start < 0) start = text.length + (x - a);
      end = text.length + (y - a);
    }
    text += node.data.slice(a, b);
  }
  return start < 0 ? { text, start: 0, end: 0 } : { text, start, end };
}

/**
 * The blocks the window's selection reaches into, in page order, each with the sentences of its
 * own text that the selection touches. Nothing for a selection the selection button would not
 * offer (in a form field, an editable region, a frame, without a letter). An element that several
 * segments share says nothing about which of them is selected; a block's own text leaves out the
 * blocks nested in it, which count for themselves, so offsets are always within one segment's text.
 */
export function selectedBlocks(win: Window, index: LinkIndex): SelectedBlock[] {
  if (eligibleSelection(win) === undefined) return [];
  const sel = win.getSelection();
  if (!sel || sel.rangeCount === 0) return [];
  const doc = win.document;
  const blocks: SelectedBlock[] = [];
  for (let r = 0; r < sel.rangeCount; r++) {
    const s = sel.getRangeAt(r);
    for (const [id, target] of index.targets) {
      const el = (target as Node).nodeType === 1 ? (target as Element) : undefined;
      if ((el && index.shared.has(el)) || blocks.some((b) => b.id === id)) continue;
      const block = rangeOf(doc, target);
      try {
        // The selection ends before the block starts, or starts after it ends: not this one.
        if (block.comparePoint(s.endContainer, s.endOffset) < 0 || block.comparePoint(s.startContainer, s.startOffset) > 0) continue;
      } catch {
        // In another tree (a shadow root, a detached node): not this one.
        continue;
      }
      // The part of the block selected: the selection's ends where they fall inside it, else the block's.
      const cut = doc.createRange();
      if (block.comparePoint(s.startContainer, s.startOffset) === 0) cut.setStart(s.startContainer, s.startOffset);
      else cut.setStart(block.startContainer, block.startOffset);
      if (block.comparePoint(s.endContainer, s.endOffset) === 0) cut.setEnd(s.endContainer, s.endOffset);
      else cut.setEnd(block.endContainer, block.endOffset);
      if (cut.collapsed) continue;
      const nested = el ? index.elements.filter((e) => e.el !== el && !index.shared.has(e.el) && el.contains(e.el)).map((e) => e.el) : [];
      const own = ownText(block, cut, nested);
      if (own.end <= own.start) continue;
      const touched = touchedSentences(own.text, own.start, own.end, langAround(doc, block.commonAncestorContainer));
      if (touched) blocks.push({ id, ...touched });
    }
  }
  return blocks;
}

export interface SelectionLinkWatch {
  stop(): void;
}

/**
 * Reports the selected blocks (`selectedBlocks`) whenever they change: shortly after the
 * selection stops moving, and at once when it goes away (an empty list).
 */
export function watchSelectionLink(win: Window, index: LinkIndex, onSelect: (blocks: SelectedBlock[]) => void, settleMs = 80): SelectionLinkWatch {
  const doc = win.document;
  // Nothing reported yet: the first report goes out even when empty, so a panel still showing the
  // highlight of a selection made before a re-read (block ids are kept) hears that it is gone.
  let last: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const report = () => {
    timer = undefined;
    const blocks = selectedBlocks(win, index);
    const key = JSON.stringify(blocks);
    if (key === last) return;
    last = key;
    onSelect(blocks);
  };
  const onChange = () => {
    clearTimeout(timer);
    const sel = win.getSelection();
    if (!sel || sel.isCollapsed) report();
    else timer = setTimeout(report, settleMs);
  };
  doc.addEventListener('selectionchange', onChange);
  // A selection made before this read (or kept across a re-read) counts at once.
  report();
  return {
    stop() {
      clearTimeout(timer);
      doc.removeEventListener('selectionchange', onChange);
    },
  };
}
