// Which block the pointer is over on each tab's page, as the content script last reported it (plan
// M5-E1, DESIGN.md §3 "Hover link"): the panel highlights that block. Absent: over no block.
export type HoverListener = (tabId: number, docId: string, id: string | undefined) => void;

export class HoverStore {
  private readonly byTab = new Map<number, { docId: string; id: string }>();
  private readonly listeners = new Set<HoverListener>();

  set(tabId: number, docId: string, id: string | undefined): void {
    if (id === undefined) this.byTab.delete(tabId);
    else this.byTab.set(tabId, { docId, id });
    for (const fn of this.listeners) fn(tabId, docId, id);
  }

  /** The segment the pointer is over on the tab's page, if it was reported for `docId`. */
  get(tabId: number, docId: string): string | undefined {
    const h = this.byTab.get(tabId);
    return h?.docId === docId ? h.id : undefined;
  }

  drop(tabId: number): void {
    this.byTab.delete(tabId);
  }

  subscribe(fn: HoverListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
