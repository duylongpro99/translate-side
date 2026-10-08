// What the panel holds of a selection (plan M3-E4): per tab, the record the worker left, as a
// small observable store. The translation itself is a job (jobs.ts) under the same tab id in a
// second Jobs instance, so it gets progress, Cancel, errors, Fix key and per-segment Retry for free.
import type { Segment } from '@/engine/types';
import { selectionParagraphs, type SnippetRecord } from '@/shared/snippet';

export interface SnippetView {
  /** The job's document id: one per click. */
  docId: string;
  url: string;
  /** From a denylisted site: nothing is shown or sent. */
  blocked?: 'denylisted';
  /** More text was selected than is sent. */
  truncated?: boolean;
  /** What is translated, as segments of one pseudo-page (empty when blocked). */
  segments: Segment[];
}

export const snippetDocId = (record: SnippetRecord) => `snippet:${record.at}`;

export function snippetView(record: SnippetRecord): SnippetView {
  const base = { docId: snippetDocId(record), url: record.url };
  if (record.blocked) return { ...base, blocked: record.blocked, segments: [] };
  const { paragraphs, truncated } = selectionParagraphs(record.text ?? '');
  const segments: Segment[] = paragraphs.map((text, i) => ({
    id: `sel-${record.at}-${i}`,
    kind: 'p',
    text,
    inlineMarkup: text,
    domPath: `/selection/p[${i + 1}]`,
    translate: true,
  }));
  return { ...base, ...(truncated ? { truncated } : {}), segments };
}

type Listener = (tabId: number, view: SnippetView | undefined) => void;

export class SnippetStore {
  private readonly views = new Map<number, SnippetView>();
  private readonly listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(tabId: number): SnippetView | undefined {
    return this.views.get(tabId);
  }

  set(tabId: number, view: SnippetView): void {
    this.views.set(tabId, view);
    for (const fn of this.listeners) fn(tabId, view);
  }

  tabs(): number[] {
    return [...this.views.keys()];
  }

  clear(tabId: number): void {
    if (this.views.delete(tabId)) for (const fn of this.listeners) fn(tabId, undefined);
  }
}
