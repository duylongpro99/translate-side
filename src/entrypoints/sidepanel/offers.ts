// Pages the panel has read but does not translate on its own (plan M5-E3, DESIGN §8 "never
// auto-translate by default"): a page reached by a navigation on a site that is not allowlisted
// waits for a one-click **Translate this page**; a page on the never-translate list is not sent.

export interface PageOffer {
  /** The document it was read from. */
  docId: string;
  url: string;
  /** `ask`: Translate this page (and Always translate on this site). `never`: the user turned the site off. */
  reason: 'ask' | 'never';
  /** The page's host, for "Always translate on this site"; null on a page with no web host. */
  site: string | null;
}

type Listener = (tabId: number, offer: PageOffer | undefined) => void;

export class OfferStore {
  private readonly byTab = new Map<number, PageOffer>();
  private readonly listeners = new Set<Listener>();

  get(tabId: number): PageOffer | undefined {
    return this.byTab.get(tabId);
  }

  set(tabId: number, offer: PageOffer): void {
    this.byTab.set(tabId, offer);
    for (const fn of this.listeners) fn(tabId, offer);
  }

  clear(tabId: number): void {
    if (!this.byTab.delete(tabId)) return;
    for (const fn of this.listeners) fn(tabId, undefined);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
