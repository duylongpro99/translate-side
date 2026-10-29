// The selection button (DESIGN.md §3): when the reader selects text on the page, the extension's
// button shows at the end of the selection, and a click on it translates the selection in a popup
// next to it (an extension page in an iframe, src/entrypoints/selection-popup). Nothing is read or
// sent before the click: the selection is read when it settles only to decide whether to show the button.
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
import { POPUP_MESSAGE } from '@/shared/protocol';

export interface SelectionButtonOptions {
  /** The button's accessible name. */
  label: string;
  /** Its tooltip. */
  tip: string;
  /** Its icon (a data: URL, so the page needs no web-accessible resource). */
  icon: string;
  /**
   * Called with the selected text and its language (selectionLang) on a trusted click, and the id of
   * the popup the click opens (when `popupUrl` is set).
   */
  onClick(text: string, lang: string, popup?: string): void;
  /** The popup page; the click opens it at `${popupUrl}#${id}`. Absent: no popup, the click only calls onClick. */
  popupUrl?: string;
  /** The popup's accessible name (its frame's title). */
  popupLabel?: string;
  /** How long a selection must stay unchanged before the button shows (ms). */
  settleMs?: number;
}

export interface SelectionWatch {
  stop(): void;
}

/** The host element's tag: a custom name no page styles. */
export const HOST_TAG = 'translate-side-selection';
/** The popup's host: its own element, so the button's keeps its one fixed box. */
export const POPUP_TAG = 'translate-side-popup';
const SIZE = 28;
const GAP = 4;
export const POPUP_WIDTH = 360;
export const POPUP_MIN_HEIGHT = 96;
export const POPUP_MAX_HEIGHT = 420;

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

/**
 * Where the popup goes: under the selection's last line, from its start (its end in right-to-left
 * text), else above it, kept inside the window.
 */
export function placePopup(
  rect: { top: number; bottom: number; left: number; right: number },
  size: { width: number; height: number },
  view: { width: number; height: number },
  rtl = false,
): { left: number; top: number; width: number } {
  const width = Math.min(size.width, view.width - 2 * GAP);
  const start = rtl ? rect.right - width : rect.left;
  const left = Math.min(Math.max(GAP, start), view.width - width - GAP);
  const below = rect.bottom + GAP;
  const above = rect.top - GAP - size.height;
  const top = below + size.height + GAP <= view.height || above < GAP ? Math.max(GAP, Math.min(below, view.height - size.height - GAP)) : above;
  return { left, top, width };
}

const POPUP_STYLE = `
iframe {
  all: initial;
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border: 1px solid rgb(0 0 0 / 0.14);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 6px 24px rgb(0 0 0 / 0.22);
  color-scheme: normal;
}
`;

/** `scheme://host` of a URL: URL.origin is "null" for a scheme it doesn't know, such as chrome-extension: outside Chrome. */
const originOf = (url: string) => url.slice(0, url.indexOf('/', url.indexOf('//') + 2));

export interface SelectionPopup {
  /** Opens the popup page (`url`, with `#id`) next to `range`, replacing a popup already open. */
  open(url: string, id: string, range: Range, rtl: boolean): void;
  /** Closes it: its frame is dropped, which ends its page and any translation still running in it. */
  close(): void;
  /** Places it again by its selection (the page scrolled or the window changed). */
  place(): void;
  /** Whether the event happened on the popup. */
  contains(e: Event): boolean;
  stop(): void;
}

/**
 * The selection button's popup: an extension page in an iframe, in a closed shadow root on its own
 * fixed host, built on first use and then only restyled. Once the frame has loaded, the content
 * script hands the page a private MessageChannel port, posted only to the extension's origin with the
 * popup's id, which the page around it never sees; the popup's height and close requests come back on
 * that port alone. The popup stays hidden until it answers there. The popup page never navigates
 * itself, so a second load means some other page is in the frame now: the popup closes.
 */
export function createSelectionPopup(win: Window, label: string): SelectionPopup {
  const doc = win.document;
  let host: HTMLElement | undefined;
  let root: ShadowRoot | undefined;
  let open: { frame: HTMLIFrameElement; range: Range; rtl: boolean; height: number; port?: MessagePort } | undefined;

  const place = () => {
    if (!open || !host) return;
    const rects = open.range.getClientRects();
    const last = rects[rects.length - 1] ?? open.range.getBoundingClientRect();
    const { left, top, width } = placePopup(last, { width: POPUP_WIDTH, height: open.height }, { width: win.innerWidth, height: win.innerHeight }, open.rtl);
    Object.assign(host.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${open.height}px` });
  };

  const close = () => {
    if (!open) return;
    open.port?.close();
    open.frame.remove();
    open = undefined;
    if (host) host.style.display = 'none';
  };

  const onPopupMessage = (data: { type?: unknown; height?: unknown; close?: unknown } | null) => {
    if (!open || data?.type !== POPUP_MESSAGE) return;
    if (data.close === true) return close();
    if (typeof data.height === 'number' && Number.isFinite(data.height)) {
      open.height = Math.min(POPUP_MAX_HEIGHT, Math.max(POPUP_MIN_HEIGHT, Math.ceil(data.height)));
      place();
      if (host) host.style.display = 'block';
    }
  };

  return {
    open(url, id, range, rtl) {
      close();
      if (!host?.isConnected) {
        host = doc.createElement(POPUP_TAG);
        host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; display: none;';
        root = host.attachShadow({ mode: 'closed' });
        const style = doc.createElement('style');
        style.textContent = POPUP_STYLE;
        root.append(style);
        doc.documentElement.append(host);
      }
      const frame = doc.createElement('iframe');
      // Chrome's on-device translator, language detector and model, delegated to the frame
      // (Permissions Policy): a cross-origin frame has none of them otherwise.
      frame.setAttribute('allow', 'translator; language-detector; language-model');
      frame.title = label;
      const current: NonNullable<typeof open> = { frame, range, rtl, height: POPUP_MIN_HEIGHT };
      let loads = 0;
      frame.addEventListener('load', () => {
        if (open !== current) return;
        if (++loads > 1) return close();
        const channel = new MessageChannel();
        channel.port1.onmessage = (e) => {
          if (open === current) onPopupMessage(e.data as Parameters<typeof onPopupMessage>[0]);
        };
        current.port = channel.port1;
        frame.contentWindow?.postMessage({ type: POPUP_MESSAGE, id }, originOf(url), [channel.port2]);
      });
      frame.src = `${url}#${id}`;
      open = current;
      root?.append(frame);
      place();
    },
    close,
    place,
    contains: (e) => host !== undefined && e.composedPath().includes(host),
    stop() {
      close();
      host?.remove();
      host = undefined;
    },
  };
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
  const popup = createSelectionPopup(win, opts.popupLabel ?? opts.label);
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
      const sel = win.getSelection();
      const range = text && sel && sel.rangeCount > 0 ? sel.getRangeAt(sel.rangeCount - 1).cloneRange() : undefined;
      const rtl = isRtl();
      hide();
      if (!text) return;
      if (opts.popupUrl === undefined || range === undefined) return opts.onClick(text, lang);
      const id = crypto.randomUUID();
      opts.onClick(text, lang, id);
      popup.open(opts.popupUrl, id, range, rtl);
    });
    root.append(style, button);
    doc.documentElement.append(host);
  };

  const hide = () => {
    clearTimeout(timer);
    if (host) host.style.display = 'none';
  };

  const isRtl = () => {
    const node = win.getSelection()?.focusNode;
    const end = node?.nodeType === 1 ? (node as Element) : node?.parentElement;
    return end ? win.getComputedStyle(end).direction === 'rtl' : false;
  };

  const update = () => {
    const sel = win.getSelection();
    const text = eligibleSelection(win);
    const rects = text && sel ? sel.getRangeAt(sel.rangeCount - 1).getClientRects() : undefined;
    const last = rects?.[rects.length - 1];
    if (!last || dismissed) return hide();
    if (!host?.isConnected) build();
    const { left, top } = placeButton(last, { width: win.innerWidth, height: win.innerHeight }, isRtl());
    const style = (host as HTMLElement).style;
    style.left = `${left}px`;
    style.top = `${top}px`;
    style.display = 'block';
  };

  const later = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(update, ms);
  };
  const ours = (e: Event) => (host !== undefined && e.composedPath().includes(host)) || popup.contains(e);
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
    popup.close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      dismiss();
      popup.close();
    } else if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) dismissed = false;
  };
  // The button goes; the popup follows its selection.
  const onScroll = () => {
    hide();
    popup.place();
  };

  const listeners: [EventTarget, string, EventListener, AddEventListenerOptions][] = [
    [doc, 'selectionchange', onSelectionChange, {}],
    [doc, 'mouseup', onRelease, { capture: true }],
    [doc, 'keyup', onRelease, { capture: true }],
    [doc, 'mousedown', onPress as EventListener, { capture: true }],
    [doc, 'contextmenu', dismiss, { capture: true }],
    [doc, 'keydown', onKey as EventListener, { capture: true }],
    [win, 'scroll', onScroll, { capture: true, passive: true }],
    [win, 'resize', onScroll, { passive: true }],
  ];
  for (const [target, type, fn, o] of listeners) target.addEventListener(type, fn, o);

  return {
    stop() {
      hide();
      for (const [target, type, fn, o] of listeners) target.removeEventListener(type, fn, o);
      host?.remove();
      host = undefined;
      popup.stop();
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
