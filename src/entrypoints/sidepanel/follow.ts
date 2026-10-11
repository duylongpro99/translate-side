// Scroll sync and the hover link between the page and the panel (plan M3-E7 page → panel, M5-E1
// both ways; DESIGN.md §3 "Scroll sync", "Hover link"). The content script reports the topmost
// segment on screen and how far the page is scrolled into it (Viewport.anchor); the panel scrolls
// so that the same point of that segment's block sits just under its sticky header and job bar.
// The other way, the panel reports its own topmost block the same way and the page scrolls to it.
// Both go by segment id and offset within the block, never by pixel ratio. A scroll one side makes
// because of the other is not passed back: the content script tags the page's echoes, and the
// panel's own scrolls open a short suppression window (shared/guard.ts).
import { useEffect } from 'preact/hooks';
import { createGuard, type Guard } from '@/shared/guard';
import type { ContentCommands, Viewport } from '@/shared/protocol';
import type { HoverStore } from './hover.ts';
import type { ViewportStore } from './viewport.ts';

/** localStorage key of the toggle: a per-viewer convenience, so not in the synced settings. */
export const FOLLOW_KEY = 'translate-side:scroll-follow';

/** On unless the reader turned it off. Storage may throw (blocked site data): then on. */
export function readFollow(storage: () => Storage | undefined = () => globalThis.localStorage): boolean {
  try {
    return storage()?.getItem(FOLLOW_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeFollow(on: boolean, storage: () => Storage | undefined = () => globalThis.localStorage): void {
  try {
    storage()?.setItem(FOLLOW_KEY, on ? '1' : '0');
  } catch {
    // Not kept; the toggle still works for this panel.
  }
}

/**
 * The window scroll position that puts `offset` (0–1) of the block at `blockTop`/`blockHeight`
 * (viewport coordinates) right under `covered` px of sticky chrome. Never negative.
 */
export function followTop(block: { top: number; height: number }, offset: number, scrollY: number, covered: number): number {
  return Math.max(0, Math.round(scrollY + block.top + offset * block.height - covered));
}

/**
 * Finds a segment's block in the panel. The id → block map is built once and rebuilt only when a
 * block is missing or was replaced, not on every scroll frame.
 */
export function blockFinder(doc: Document): (id: string) => HTMLElement | undefined {
  let blocks = new Map<string, HTMLElement>();
  const build = () => {
    blocks = new Map([...doc.querySelectorAll<HTMLElement>('.segments [data-id]')].map((e) => [e.dataset.id ?? '', e]));
  };
  return (id) => {
    let block = blocks.get(id);
    if (!block?.isConnected) {
      build();
      block = blocks.get(id);
    }
    return block;
  };
}

/** What stays stuck at the top of the panel and hides the start of the content. */
function coveredTop(doc: Document): number {
  return Math.max(0, ...[...doc.querySelectorAll('.panel__header, .job')].map((e) => e.getBoundingClientRect().bottom));
}

/**
 * Scrolls the panel to the anchor's block, if it has one. Returns whether it did. `onScroll` is
 * called when the panel actually moved (before its scroll event arrives), so the caller can tell
 * that event from the reader's.
 */
export function scrollToAnchor(doc: Document, anchor: Viewport['anchor'], find: (id: string) => HTMLElement | undefined = blockFinder(doc), onScroll?: () => void): boolean {
  if (!anchor) return false;
  const block = find(anchor.id);
  const win = doc.defaultView;
  if (!block || !win) return false;
  const top = followTop(block.getBoundingClientRect(), anchor.offset, win.scrollY, coveredTop(doc));
  if (Math.abs(top - win.scrollY) >= 1) {
    onScroll?.();
    win.scrollTo({ top, behavior: 'instant' });
  }
  return true;
}

/**
 * The topmost block of the panel that reaches below its sticky chrome, and how far the reader is
 * into it (0 = its top is just under the chrome, 1 = its bottom is): `scrollToAnchor`'s inverse.
 * The blocks are in page order, so it is found by bisection (a few layout reads, not one per block).
 */
export function panelAnchor(doc: Document): Viewport['anchor'] {
  const blocks = [...doc.querySelectorAll<HTMLElement>('.segments [data-id]')];
  const covered = coveredTop(doc);
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((blocks[mid] as HTMLElement).getBoundingClientRect().bottom > covered + 0.5) hi = mid;
    else lo = mid + 1;
  }
  const block = blocks[lo];
  if (!block) return undefined;
  const rect = block.getBoundingClientRect();
  const offset = rect.height > 0 ? Math.min(1, Math.max(0, (covered - rect.top) / rect.height)) : 0;
  return { id: block.dataset.id ?? '', offset: Math.round(offset * 1000) / 1000 };
}

/** Sends a command to the tab's page (the controller's `send`). */
export type SendToPage = <K extends keyof ContentCommands & string>(tabId: number, name: K, body: ContentCommands[K]) => void;

/** Least change of the reader's place in a block (0–1) worth telling the page about. */
const ANCHOR_EPSILON = 0.002;

/**
 * While `on`, keeps the panel and the page at the same place, both ways. Page → panel: follows the
 * anchor of `tabId`'s `docId`, at once and then on every viewport change that is the reader's own
 * (an echo of a scroll the panel asked for is ignored). Panel → page (when `send` is given): the
 * panel's own scrolls, one per animation frame at most, tell the page which block and how far.
 */
export function useScrollFollow(viewports: ViewportStore | undefined, tabId: number | undefined, docId: string | undefined, on: boolean, send?: SendToPage, guard: Guard = SHARED_GUARD): void {
  useEffect(() => {
    if (!on || !viewports || tabId === undefined || docId === undefined) return;
    let frame: number | undefined;
    let latest = viewports.get(tabId, docId)?.anchor;
    const find = blockFinder(document);
    // One scroll per frame, to the latest anchor.
    const follow = () => {
      frame = undefined;
      scrollToAnchor(document, latest, find, () => guard.mark());
    };
    const schedule = () => {
      frame ??= requestAnimationFrame(follow);
    };
    schedule();
    const unsubscribe = viewports.subscribe((t, d, v) => {
      if (t !== tabId || d !== docId || !v.anchor || v.echo) return;
      latest = v.anchor;
      schedule();
    });

    let sendFrame: number | undefined;
    let sent: Viewport['anchor'];
    const tell = () => {
      sendFrame = undefined;
      // The panel scrolled because the page did: not the reader's scroll.
      if (!send || guard.active()) return;
      const anchor = panelAnchor(document);
      if (!anchor || (sent?.id === anchor.id && Math.abs(sent.offset - anchor.offset) < ANCHOR_EPSILON)) return;
      sent = anchor;
      send(tabId, 'scroll', anchor);
    };
    const onScroll = () => {
      sendFrame ??= requestAnimationFrame(tell);
    };
    if (send) window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      unsubscribe();
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (sendFrame !== undefined) cancelAnimationFrame(sendFrame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [viewports, tabId, docId, on, send, guard]);
}

const SHARED_GUARD = createGuard();

const LINKED = 'seg--linked';

/**
 * The hover link (plan M5-E1, DESIGN.md §3): the block of the page the pointer is over is
 * highlighted in the panel (a class on the block, no re-render), and the block of the panel the
 * pointer (or keyboard focus) is on is highlighted on the page (`highlight` command). Neither
 * direction raises an event on the other side, so the two cannot feed each other.
 */
export function useHoverLink(hovers: HoverStore | undefined, tabId: number | undefined, docId: string | undefined, send: SendToPage | undefined, on: boolean): void {
  useEffect(() => {
    if (!on || tabId === undefined || docId === undefined) return;
    const find = blockFinder(document);
    let shown: HTMLElement | undefined;
    const show = (id: string | undefined) => {
      shown?.classList.remove(LINKED);
      shown = id === undefined ? undefined : find(id);
      shown?.classList.add(LINKED);
    };
    const unsubscribe = hovers?.subscribe((t, d, id) => {
      if (t === tabId && (id === undefined || d === docId)) show(id);
    });
    let told: string | undefined;
    const tell = (id: string | undefined) => {
      if (!send || id === told) return;
      told = id;
      send(tabId, 'highlight', id === undefined ? {} : { id });
    };
    const blockOf = (node: EventTarget | null) => (node instanceof Element ? (node.closest<HTMLElement>('.segments [data-id]')?.dataset.id ?? undefined) : undefined);
    const over = (e: Event) => tell(blockOf(e.target));
    const out = (e: MouseEvent | FocusEvent) => tell(blockOf(e.relatedTarget));
    document.addEventListener('mouseover', over, { passive: true });
    document.addEventListener('mouseout', out, { passive: true });
    document.addEventListener('focusin', over, { passive: true });
    document.addEventListener('focusout', out, { passive: true });
    return () => {
      unsubscribe?.();
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      document.removeEventListener('focusin', over);
      document.removeEventListener('focusout', out);
      show(undefined);
      tell(undefined);
    };
  }, [hovers, tabId, docId, send, on]);
}
