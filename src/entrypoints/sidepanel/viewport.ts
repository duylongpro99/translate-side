// What is on screen in each tab's document, as the content script last reported it (plan M3-E7):
// the panel's scroll follow reads the anchor from here. Jobs keeps its own copy for priority.
import type { Viewport } from '@/shared/protocol';

export type ViewportListener = (tabId: number, docId: string, viewport: Viewport) => void;

export class ViewportStore {
  private readonly byTab = new Map<number, { docId: string; viewport: Viewport }>();
  private readonly listeners = new Set<ViewportListener>();

  set(tabId: number, docId: string, viewport: Viewport): void {
    this.byTab.set(tabId, { docId, viewport });
    for (const fn of this.listeners) fn(tabId, docId, viewport);
  }

  /** The tab's last viewport, if it was reported for `docId`. */
  get(tabId: number, docId: string): Viewport | undefined {
    const v = this.byTab.get(tabId);
    return v?.docId === docId ? v.viewport : undefined;
  }

  drop(tabId: number): void {
    this.byTab.delete(tabId);
  }

  subscribe(fn: ViewportListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
