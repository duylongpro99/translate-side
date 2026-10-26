// The selection button (DESIGN.md §3): when the reader selects text on the page, the extension's
// button shows at the end of the selection, and a click on it translates the selection in the side
// panel, the same handover as the context menu. Nothing is read or sent before the click: the
// selection is read when it settles only to decide whether to show the button.
//
// The button lives in a closed shadow root on a fixed host with `all: initial`, so the page's CSS
// can't restyle it, its own CSS can't leak out, and page scripts can't reach it. The host is added to
// the page once and then only restyled, so the panel's change watch (watch.ts) sees one mutation.
// Only a trusted click acts: a page can dispatch synthetic events, but not real ones.
//
// Two scripts of this extension can draw it: the full content script while the panel is connected,
// and the opt-in selection script on every site. They share the page's isolated world, so one
// count-tracked button serves both (`acquireSelectionButton`).
import { deepActiveElement, isEditable, isEditableDocument } from './editable.ts';
import { MAX_SELECTION_CHARS } from '@/shared/snippet';

export interface SelectionButtonOptions {
  /** The button's accessible name. */
  label: string;
  /** Its tooltip. */
  tip: string;
  /** Its icon (a data: URL, so the page needs no web-accessible resource). */
  icon: string;
  /** Called with the selected text and its language (selectionLang) on a trusted click. */
  onClick(text: string, lang: string): void;
  /** How long a selection must stay unchanged before the button shows (ms). */
  settleMs?: number;
}

export interface SelectionWatch {
  stop(): void;
}

/** The host element's tag: a custom name no page styles. */
export const HOST_TAG = 'translate-side-selection';
const SIZE = 28;
const GAP = 4;

/**
 * Form fields and editable regions, whose text is never read (decision D24), wherever the selection or
 * the focus is. A code editor counts too: the extractor reads it as code, but its text can be typed.
 */
const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false" i])';

const inEditable = (node: Node | null): boolean => {
  for (let el = node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null); el; el = el.parentElement) {
    if (el.matches(FIELD) || isEditable(el)) return true;
  }
  return false;
};

/**
 * The language the selected text is marked as: the nearest `lang` attribute around it, else ''.
 * Read on the click and sent with the text, so a selection too short for Chrome's language
 * detector still names its source language (the on-device route needs one).
 */
export function selectionLang(win: Window): string {
  const sel = win.getSelection();
  if (!sel || sel.rangeCount === 0) return '';
  const node = sel.getRangeAt(0).commonAncestorContainer;
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return el?.closest('[lang]')?.getAttribute('lang')?.trim() ?? '';
}

/**
 * The selection the button may offer, or undefined: none in a frame, an editable document, a form
 * field or an editable region (decision D24), and none without a letter (a stray space or a dash).
 * Capped well past MAX_SELECTION_CHARS, so a huge selection is not messaged in full and the panel
 * still sees that it was cut.
 */
export function eligibleSelection(win: Window): string | undefined {
  if (win !== win.top) return undefined;
  const doc = win.document;
  const sel = win.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return undefined;
  if (isEditableDocument(doc)) return undefined;
  if (inEditable(sel.anchorNode) || inEditable(sel.focusNode) || inEditable(deepActiveElement(doc))) return undefined;
  const text = sel.toString();
  if (!/\p{L}/u.test(text)) return undefined;
  return text.length > 2 * MAX_SELECTION_CHARS ? text.slice(0, 2 * MAX_SELECTION_CHARS) : text;
}

/**
 * Where the button goes: just past the end of the selection's last line (its left edge in
 * right-to-left text), kept inside the window.
 */
export function placeButton(
  rect: { top: number; bottom: number; left: number; right: number },
  view: { width: number; height: number },
  rtl = false,
): { left: number; top: number } {
  const end = rtl ? rect.left - GAP - SIZE : rect.right + GAP;
  const left = Math.min(Math.max(GAP, end), view.width - SIZE - GAP);
  const below = rect.bottom + GAP;
  const top = below + SIZE + GAP <= view.height ? below : Math.max(GAP, rect.top - SIZE - GAP);
  return { left, top };
}

const STYLE = `
button {
  all: initial;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  width: ${SIZE}px;
  height: ${SIZE}px;
  padding: 3px;
  border: 1px solid rgb(0 0 0 / 0.14);
  border-radius: 7px;
  background: #fff;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.18);
  cursor: pointer;
}
button:hover { background: #f4f1ea; }
button:focus-visible { outline: 2px solid #2b6cb0; outline-offset: 1px; }
img { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
`;

/** Shows the button for each settled selection until stopped. */
export function watchSelection(win: Window, opts: SelectionButtonOptions): SelectionWatch {
  const doc = win.document;
  const settleMs = opts.settleMs ?? 200;
  let host: HTMLElement | undefined;
  let button: HTMLButtonElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Esc or a context menu put the button away until the reader selects again: the key or mouse
  // release that follows would otherwise bring it straight back.
  let dismissed = false;

  const build = () => {
    host = doc.createElement(HOST_TAG);
    host.style.cssText = `all: initial; position: fixed; z-index: 2147483647; display: none; width: ${SIZE}px; height: ${SIZE}px;`;
    const root = host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = STYLE;
    button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', opts.label);
    button.title = opts.tip;
    const img = doc.createElement('img');
    img.src = opts.icon;
    img.alt = '';
    button.append(img);
    // Pressing the button must not clear the selection it is about.
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      const text = eligibleSelection(win);
      const lang = text ? selectionLang(win) : '';
      hide();
      if (text) opts.onClick(text, lang);
    });
    root.append(style, button);
    doc.documentElement.append(host);
  };

  const hide = () => {
    clearTimeout(timer);
    if (host) host.style.display = 'none';
  };

  const update = () => {
    const sel = win.getSelection();
    const text = eligibleSelection(win);
    const rects = text && sel ? sel.getRangeAt(sel.rangeCount - 1).getClientRects() : undefined;
    const last = rects?.[rects.length - 1];
    if (!last || dismissed) return hide();
    if (!host?.isConnected) build();
    const end = sel?.focusNode?.nodeType === 1 ? (sel.focusNode as Element) : sel?.focusNode?.parentElement;
    const rtl = end ? win.getComputedStyle(end).direction === 'rtl' : false;
    const { left, top } = placeButton(last, { width: win.innerWidth, height: win.innerHeight }, rtl);
    const style = (host as HTMLElement).style;
    style.left = `${left}px`;
    style.top = `${top}px`;
    style.display = 'block';
  };

  const later = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(update, ms);
  };
  const ours = (e: Event) => host !== undefined && e.composedPath().includes(host);
  const onSelectionChange = () => {
    const sel = win.getSelection();
    if (!sel || sel.isCollapsed) hide();
    else later(settleMs);
  };
  const onRelease = (e: Event) => {
    if (!ours(e)) later(0);
  };
  const dismiss = () => {
    dismissed = true;
    hide();
  };
  const onPress = (e: MouseEvent) => {
    if (ours(e)) return;
    // Only a plain primary press can start a new selection; the others open a context menu.
    dismissed = e.button !== 0 || e.ctrlKey;
    hide();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') dismiss();
    else if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) dismissed = false;
  };

  const listeners: [EventTarget, string, EventListener, AddEventListenerOptions][] = [
    [doc, 'selectionchange', onSelectionChange, {}],
    [doc, 'mouseup', onRelease, { capture: true }],
    [doc, 'keyup', onRelease, { capture: true }],
    [doc, 'mousedown', onPress as EventListener, { capture: true }],
    [doc, 'contextmenu', dismiss, { capture: true }],
    [doc, 'keydown', onKey as EventListener, { capture: true }],
    [win, 'scroll', hide, { capture: true, passive: true }],
    [win, 'resize', hide, { passive: true }],
  ];
  for (const [target, type, fn, o] of listeners) target.addEventListener(type, fn, o);

  return {
    stop() {
      hide();
      for (const [target, type, fn, o] of listeners) target.removeEventListener(type, fn, o);
      host?.remove();
      host = undefined;
    },
  };
}

declare global {
  // The page's one selection button, shared by this extension's scripts in the isolated world.
  var __translateSideSelection: { watch: SelectionWatch; users: number; alive: () => boolean } | undefined;
}

/**
 * Starts the page's selection button, or joins the one already running. The returned function
 * leaves it; the button stops when the last user leaves. A button left by a copy whose extension
 * was reloaded (`alive` says false) is replaced: its clicks would go nowhere.
 */
export function acquireSelectionButton(win: Window, opts: SelectionButtonOptions, alive: () => boolean = () => true): () => void {
  const old = globalThis.__translateSideSelection;
  if (old && !old.alive()) {
    old.watch.stop();
    globalThis.__translateSideSelection = undefined;
  }
  const shared = (globalThis.__translateSideSelection ??= { watch: watchSelection(win, opts), users: 0, alive });
  shared.users++;
  let left = false;
  return () => {
    if (left) return;
    left = true;
    shared.users--;
    if (shared.users > 0) return;
    shared.watch.stop();
    if (globalThis.__translateSideSelection === shared) globalThis.__translateSideSelection = undefined;
  };
}
