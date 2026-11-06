// The selection link (DESIGN.md §3 "Selection link"): while the reader has text selected on the
// page, the panel highlights the sentences of the translation that stand for the selected ones.
// The content script reports which sentences of which blocks the selection touches; the panel cuts
// each block's translation into sentences and pairs them (shared/sentences.ts), all on this device.
// The highlight is a CSS Custom Highlight over the translation's text nodes: the blocks are not
// re-rendered and their DOM is not changed. It stays while the selection does, follows the
// translation as it streams in, and goes when the selection does.
import { useEffect } from 'preact/hooks';
import type { SelectedBlock } from '@/shared/protocol';
import { matchSentences, type Span } from '@/shared/sentences';
import { blockFinder, revealBlock } from './follow.ts';

/** The highlight's name in the panel's `CSS.highlights`, painted by a ::highlight() rule in style.css. */
export const SENTENCE_HIGHLIGHT = 'translate-side-sentence';

export type SelectionListener = (tabId: number, docId: string, blocks: readonly SelectedBlock[]) => void;

/** The selected blocks of each tab's page, as its content script last reported them. */
export class SelectionStore {
  private readonly byTab = new Map<number, { docId: string; blocks: readonly SelectedBlock[] }>();
  private readonly listeners = new Set<SelectionListener>();

  set(tabId: number, docId: string, blocks: readonly SelectedBlock[]): void {
    if (blocks.length === 0) this.byTab.delete(tabId);
    else this.byTab.set(tabId, { docId, blocks });
    for (const fn of this.listeners) fn(tabId, docId, blocks);
  }

  /** The tab's selected blocks, if they were reported for `docId`. */
  get(tabId: number, docId: string): readonly SelectedBlock[] {
    const s = this.byTab.get(tabId);
    return s?.docId === docId ? s.blocks : [];
  }

  drop(tabId: number): void {
    this.byTab.delete(tabId);
  }

  subscribe(fn: SelectionListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/** A Range over [start, end) of the text under `root`, its text nodes taken in order. */
export function textRange(root: Node, span: Span): Range | undefined {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const range = doc.createRange();
  let at = 0;
  let started = false;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const next = at + node.data.length;
    if (!started && span.start < next) {
      range.setStart(node, span.start - at);
      started = true;
    }
    if (started && span.end <= next) {
      range.setEnd(node, span.end - at);
      return range;
    }
    at = next;
  }
  return undefined;
}

/** The ranges to highlight in the panel for the selected blocks: in each block's translation, its matching sentences. */
export function sentenceRanges(blocks: readonly SelectedBlock[], find: (id: string) => HTMLElement | undefined): { ranges: Range[]; first?: HTMLElement } {
  const ranges: Range[] = [];
  let first: HTMLElement | undefined;
  for (const block of blocks) {
    const el = find(block.id);
    // Only a translated block: one still waiting shows its original, which has nothing to match.
    const text = el?.querySelector<HTMLElement>('.seg__text');
    if (!el || !text) continue;
    for (const span of matchSentences(text.textContent ?? '', block, text.lang || undefined)) {
      const range = textRange(text, span);
      if (range) ranges.push(range);
    }
    first ??= el;
  }
  return { ranges, ...(first ? { first } : {}) };
}

type Highlights = { set(name: string, h: unknown): void; delete(name: string): void };
type Win = Window & { CSS?: { highlights?: Highlights }; Highlight?: new (...ranges: Range[]) => unknown };

/**
 * Highlights, while `on`, the sentences of the translation matching the reader's selection on
 * `tabId`'s `docId`. A new selection brings its first block into view when `follow` is on (the
 * scroll follow's guard keeps that scroll from moving the page).
 */
export function useSelectionLink(selections: SelectionStore | undefined, tabId: number | undefined, docId: string | undefined, on: boolean, follow: boolean): void {
  useEffect(() => {
    if (!on || !selections || tabId === undefined || docId === undefined) return;
    const win = window as Win;
    const highlights = win.CSS?.highlights;
    const Highlight = win.Highlight;
    if (!highlights || !Highlight) return;
    const find = blockFinder(document);
    let blocks = selections.get(tabId, docId);
    let frame: number | undefined;
    let reveal = false;
    let observer: MutationObserver | undefined;
    const paint = () => {
      frame = undefined;
      highlights.delete(SENTENCE_HIGHLIGHT);
      // Only the paint right after the selection changed may scroll: a block translated later
      // lights up where it is, not pulling the panel back to a selection the reader has left.
      const scroll = reveal && follow;
      reveal = false;
      if (blocks.length === 0) return;
      const { ranges, first } = sentenceRanges(blocks, find);
      if (ranges.length > 0) highlights.set(SENTENCE_HIGHLIGHT, new Highlight(...ranges));
      if (scroll && first) revealBlock(document, first);
    };
    const schedule = () => {
      frame ??= requestAnimationFrame(paint);
    };
    // A block translated or re-rendered while the selection stays: paint it again.
    const watch = () => {
      if (blocks.length === 0) {
        observer?.disconnect();
        observer = undefined;
      } else if (!observer) {
        observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
    };
    const unsubscribe = selections.subscribe((t, d, next) => {
      if (t !== tabId || (next.length > 0 && d !== docId)) return;
      blocks = next;
      reveal = next.length > 0;
      watch();
      schedule();
    });
    watch();
    schedule();
    return () => {
      unsubscribe();
      observer?.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      highlights.delete(SENTENCE_HIGHLIGHT);
    };
  }, [selections, tabId, docId, on, follow]);
}
