// Keyboard use of the translated blocks (plan M5-E10): one Tab stop for the whole list, arrows (or
// J/K) between blocks, and a letter for each of a block's actions (src/shared/shortcuts.ts). The
// keys act only on a focused block or one of its buttons, never on a field, and never with a
// modifier held, so they do not clash with the page's or the browser's own shortcuts.

export const BLOCK_SELECTOR = '[data-id]';
const ACTION_BY_KEY: Record<string, string> = { o: 'seg-original', r: 'seg-retranslate', e: 'seg-explain', c: 'seg-copy' };

export const blocksIn = (root: ParentNode): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)];

const blockOf = (node: EventTarget | null, root: HTMLElement): HTMLElement | undefined => {
  const block = node instanceof Element ? node.closest<HTMLElement>(BLOCK_SELECTOR) : null;
  return block && root.contains(block) ? block : undefined;
};

/**
 * Roving tabindex: `active` (else the first block) is the list's one Tab stop, and only its
 * buttons are tabbable, so Tab crosses the list in two steps instead of one per button.
 */
export function rove(root: HTMLElement, active: HTMLElement | undefined = root.querySelector<HTMLElement>('[data-roving]') ?? undefined): void {
  const blocks = blocksIn(root);
  const current = active && blocks.includes(active) ? active : blocks[0];
  for (const block of blocks) {
    const on = block === current;
    block.tabIndex = on ? 0 : -1;
    if (on) block.setAttribute('data-roving', '');
    else block.removeAttribute('data-roving');
    for (const button of block.querySelectorAll<HTMLElement>('button')) button.tabIndex = on ? 0 : -1;
  }
}

/** Puts keyboard focus on `block` and brings it clear of the panel's sticky header. */
export function focusBlock(root: HTMLElement, block: HTMLElement, covered: number): void {
  rove(root, block);
  block.focus({ preventScroll: true });
  const rect = block.getBoundingClientRect();
  const view = block.ownerDocument.defaultView;
  if (!view) return;
  if (rect.top < covered + 4) view.scrollBy({ top: rect.top - covered - 8, behavior: 'instant' });
  else if (rect.bottom > view.innerHeight) view.scrollBy({ top: Math.min(rect.bottom - view.innerHeight + 8, rect.top - covered - 8), behavior: 'instant' });
}

/** What the sticky header and job bar cover at the top of the panel. */
export const coveredBy = (doc: Document): number => Math.max(0, ...[...doc.querySelectorAll('.panel__header, .job')].map((e) => e.getBoundingClientRect().bottom));

/** Handles a keydown inside the list. Returns whether it was one of the list's keys. */
export function handleBlockKey(e: KeyboardEvent, root: HTMLElement): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return false;
  // A block's own text field (the inline editor) keeps every key it is typed.
  if (e.target instanceof Element && e.target.matches('textarea, input, select, [contenteditable]')) return false;
  const block = blockOf(e.target, root);
  if (!block) return false;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const blocks = blocksIn(root);
  const at = blocks.indexOf(block);
  const go = (to: number) => {
    const target = blocks[Math.max(0, Math.min(blocks.length - 1, to))];
    if (target) focusBlock(root, target, coveredBy(root.ownerDocument));
  };
  if (key === 'ArrowDown' || key === 'j') go(at + 1);
  else if (key === 'ArrowUp' || key === 'k') go(at - 1);
  else if (key === 'Home' && e.target === block) go(0);
  else if (key === 'End' && e.target === block) go(blocks.length - 1);
  else if (key in ACTION_BY_KEY && !e.shiftKey) {
    const button = block.querySelector<HTMLButtonElement>(`[data-testid="${ACTION_BY_KEY[key]}"]`);
    if (!button || button.disabled) return false;
    button.click();
  } else return false;
  e.preventDefault();
  return true;
}
