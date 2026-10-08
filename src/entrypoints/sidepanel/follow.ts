// One-way scroll follow, page → panel (plan M3-E7; DESIGN.md §3 "Scroll sync"; bidirectional sync
// and the hover link are M5). The content script reports the topmost segment on screen and how far
// the page is scrolled into it (Viewport.anchor); the panel scrolls so that the same point of that
// segment's block sits just under its sticky header and job bar.
import { useEffect } from 'preact/hooks';
import type { Viewport } from '@/shared/protocol';
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

/** Scrolls the panel to the anchor's block, if it has one. Returns whether it did. */
export function scrollToAnchor(doc: Document, anchor: Viewport['anchor'], find: (id: string) => HTMLElement | undefined = blockFinder(doc)): boolean {
  if (!anchor) return false;
  const block = find(anchor.id);
  const win = doc.defaultView;
  if (!block || !win) return false;
  // Whatever stays stuck at the top hides the start of the content.
  const covered = Math.max(0, ...[...doc.querySelectorAll('.panel__header, .job')].map((e) => e.getBoundingClientRect().bottom));
  const top = followTop(block.getBoundingClientRect(), anchor.offset, win.scrollY, covered);
  if (Math.abs(top - win.scrollY) >= 1) win.scrollTo({ top, behavior: 'instant' });
  return true;
}

/** While `on`, follows the anchor of `tabId`'s `docId`: at once, then on every viewport change. */
export function useScrollFollow(viewports: ViewportStore | undefined, tabId: number | undefined, docId: string | undefined, on: boolean): void {
  useEffect(() => {
    if (!on || !viewports || tabId === undefined || docId === undefined) return;
    let frame: number | undefined;
    let latest = viewports.get(tabId, docId)?.anchor;
    const find = blockFinder(document);
    // One scroll per frame, to the latest anchor.
    const follow = () => {
      frame = undefined;
      scrollToAnchor(document, latest, find);
    };
    const schedule = () => {
      frame ??= requestAnimationFrame(follow);
    };
    schedule();
    const unsubscribe = viewports.subscribe((t, d, v) => {
      if (t !== tabId || d !== docId || !v.anchor) return;
      latest = v.anchor;
      schedule();
    });
    return () => {
      unsubscribe();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [viewports, tabId, docId, on]);
}
