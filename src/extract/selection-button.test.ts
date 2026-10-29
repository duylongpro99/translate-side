// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SELECTION_CHARS } from '@/shared/snippet';
import { POPUP_MESSAGE } from '@/shared/protocol';
import { acquireSelectionButton, createSelectionPopup, eligibleSelection, HOST_TAG, placeButton, placePopup, POPUP_MAX_HEIGHT, POPUP_MIN_HEIGHT, POPUP_TAG, selectionLang, watchSelection } from './selection-button.ts';

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

/** Selects the whole text of the element. */
const select = (el: Element) => {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection() as Selection;
  sel.removeAllRanges();
  sel.addRange(range);
};

const host = () => document.querySelector<HTMLElement>(HOST_TAG);
const shown = () => host()?.style.display === 'block';

let roots: ShadowRoot[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no layout: every selection's last line ends at (200, 40).
  Range.prototype.getClientRects = () => [rect(20, 20, 120, 30), rect(20, 30, 200, 40)] as unknown as DOMRectList;
  // The button lives in a closed shadow root; keep a handle on it for the click tests.
  const attach = Element.prototype.attachShadow;
  roots = [];
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
    const root = attach.call(this, init);
    roots.push(root);
    return root;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  document.designMode = 'off';
  document.body.replaceChildren();
  for (const el of document.querySelectorAll(`${HOST_TAG}, ${POPUP_TAG}`)) el.remove();
  globalThis.__translateSideSelection = undefined;
});

const OPTS = { label: 'Translate selection', tip: 'Translate the selected text in the side panel', icon: 'data:image/png;base64,AA==' };

describe('eligibleSelection', () => {
  it('offers a selection of page text', () => {
    document.body.innerHTML = '<p id="p">Hello world.</p>';
    select(document.getElementById('p') as Element);
    expect(eligibleSelection(window)).toBe('Hello world.');
  });

  it('offers nothing for an empty selection, or one with no letter in it', () => {
    document.body.innerHTML = '<p id="p">— 42 …</p>';
    expect(eligibleSelection(window)).toBeUndefined();
    select(document.getElementById('p') as Element);
    expect(eligibleSelection(window)).toBeUndefined();
  });

  it.each([
    ['a textarea', '<textarea id="f">Hello</textarea><p id="p">Hello</p>', 'f'],
    ['a password field', '<input id="f" type="password" value="secret"><p id="p">Hello</p>', 'f'],
    ['a text field', '<input id="f" value="Hello"><p id="p">Hello</p>', 'f'],
  ])('offers nothing while focus is in %s', (_name, html, id) => {
    document.body.innerHTML = html;
    (document.getElementById(id) as HTMLElement).focus();
    select(document.getElementById('p') as Element);
    expect(eligibleSelection(window)).toBeUndefined();
  });

  it.each([
    ['contenteditable', '<div contenteditable="true"><p id="p">Hello</p></div>'],
    ['role=textbox', '<div role="textbox"><p id="p">Hello</p></div>'],
    ['a code editor', '<div class="cm-content" contenteditable="true"><div id="p">let hello = 1;</div></div>'],
  ])('offers nothing inside %s', (_name, html) => {
    document.body.innerHTML = html;
    select(document.getElementById('p') as Element);
    expect(eligibleSelection(window)).toBeUndefined();
  });

  it('offers nothing in a document being edited', () => {
    document.body.innerHTML = '<p id="p">Hello</p>';
    document.designMode = 'on';
    select(document.getElementById('p') as Element);
    expect(eligibleSelection(window)).toBeUndefined();
  });

  it('keeps contenteditable="false" inside the page readable', () => {
    document.body.innerHTML = '<div contenteditable="false"><p id="p">Hello</p></div>';
    select(document.getElementById('p') as Element);
    expect(eligibleSelection(window)).toBe('Hello');
  });

  it('cuts a huge selection well past the panel cap, so the panel still says it was cut', () => {
    document.body.innerHTML = `<p id="p">${'word '.repeat(MAX_SELECTION_CHARS)}</p>`;
    select(document.getElementById('p') as Element);
    const text = eligibleSelection(window) as string;
    expect(text.length).toBe(2 * MAX_SELECTION_CHARS);
  });
});

describe('placeButton', () => {
  const view = { width: 400, height: 300 };
  it('goes just past the end of the last line, below it', () => {
    expect(placeButton({ top: 30, bottom: 40, left: 20, right: 200 }, view)).toEqual({ left: 204, top: 44 });
  });
  it('stays inside the window at the end edge', () => {
    expect(placeButton({ top: 30, bottom: 40, left: 20, right: 398 }, view).left).toBe(400 - 28 - 4);
  });
  it('goes above the line when there is no room below', () => {
    expect(placeButton({ top: 270, bottom: 285, left: 20, right: 200 }, view)).toEqual({ left: 204, top: 270 - 28 - 4 });
  });
  it('goes past the left end of the line in right-to-left text, still inside the window', () => {
    expect(placeButton({ top: 30, bottom: 40, left: 100, right: 380 }, view, true)).toEqual({ left: 100 - 4 - 28, top: 44 });
    expect(placeButton({ top: 30, bottom: 40, left: 10, right: 380 }, view, true).left).toBe(4);
  });
});

describe('watchSelection', () => {
  it('shows the button once the selection settles, at the end of its last line', () => {
    document.body.innerHTML = '<p id="p">Hello world.</p>';
    const watch = watchSelection(window, { ...OPTS, onClick: vi.fn() });
    select(document.getElementById('p') as Element);
    document.dispatchEvent(new Event('selectionchange'));
    expect(shown()).toBe(false);
    vi.advanceTimersByTime(200);
    expect(shown()).toBe(true);
    expect([host()?.style.left, host()?.style.top]).toEqual(['204px', '44px']);
    watch.stop();
    expect(host()).toBeNull();
  });

  it('shows after the mouse or a key lets go of a selection', () => {
    document.body.innerHTML = '<p id="p">Hello world.</p>';
    const watch = watchSelection(window, { ...OPTS, onClick: vi.fn() });
    select(document.getElementById('p') as Element);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(shown()).toBe(true);
    watch.stop();
  });

  it('draws nothing for a selection it may not offer', () => {
    document.body.innerHTML = '<textarea id="f">Hello</textarea>';
    const watch = watchSelection(window, { ...OPTS, onClick: vi.fn() });
    (document.getElementById('f') as HTMLElement).focus();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    vi.advanceTimersByTime(300);
    expect(host()).toBeNull();
    watch.stop();
  });

  it.each([
    ['a scroll', () => window.dispatchEvent(new Event('scroll'))],
    ['a resize', () => window.dispatchEvent(new Event('resize'))],
    ['Esc', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))],
    ['a press elsewhere', () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))],
    [
      'the selection collapsing',
      () => {
        window.getSelection()?.removeAllRanges();
        document.dispatchEvent(new Event('selectionchange'));
      },
    ],
  ])('hides on %s', (_name, act) => {
    document.body.innerHTML = '<p id="p">Hello world.</p>';
    const watch = watchSelection(window, { ...OPTS, onClick: vi.fn() });
    select(document.getElementById('p') as Element);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(shown()).toBe(true);
    act();
    expect(shown()).toBe(false);
    watch.stop();
  });

  it('shows at the left end of a right-to-left selection', () => {
    document.body.innerHTML = '<p id="p" dir="rtl">مرحبا بالعالم</p>';
    const watch = watchSelection(window, { ...OPTS, onClick: vi.fn() });
    select(document.getElementById('p') as Element);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    vi.advanceTimersByTime(200);
    // The last line runs from 20 to 200: the button sits left of it.
    expect(host()?.style.left).toBe('4px');
    watch.stop();
  });

  it.each([
    ['Esc', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
    }],
    ['a right-click', () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));
      document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 2 }));
    }],
  ])('stays away after %s until the reader selects again', (_name, act) => {
    document.body.innerHTML = '<p id="p">Hello world.</p>';
    const watch = watchSelection(window, { ...OPTS, onClick: vi.fn() });
    select(document.getElementById('p') as Element);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(shown()).toBe(true);
    act();
    vi.advanceTimersByTime(300);
    expect(shown()).toBe(false);
    // A new selection with the mouse brings it back.
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    select(document.getElementById('p') as Element);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(shown()).toBe(true);
    watch.stop();
  });

  it('names the button, keeps the selection on press and ignores a synthetic click', () => {
    document.body.innerHTML = '<p id="p">Hello world.</p>';
    const onClick = vi.fn();
    const watch = watchSelection(window, { ...OPTS, onClick });
    select(document.getElementById('p') as Element);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    vi.advanceTimersByTime(200);
    const button = roots[0]?.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe(OPTS.label);
    expect(button.title).toBe(OPTS.tip);
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true });
    button.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(shown()).toBe(true);
    // A page script can dispatch a click, but not a trusted one.
    button.click();
    expect(onClick).not.toHaveBeenCalled();
    watch.stop();
  });
});

describe('selectionLang', () => {
  it("is the nearest lang around the selected text, the page's when nothing nearer says, '' when none does", () => {
    document.documentElement.lang = 'en';
    document.body.innerHTML = '<p id="a">English</p><blockquote lang="ja"><p id="b">日本語</p></blockquote>';
    select(document.getElementById('b') as Element);
    expect(selectionLang(window)).toBe('ja');
    select(document.getElementById('a') as Element);
    expect(selectionLang(window)).toBe('en');
    document.documentElement.removeAttribute('lang');
    expect(selectionLang(window)).toBe('');
  });
});

describe('acquireSelectionButton', () => {
  it('draws one button for both scripts and stops it when the last one leaves', () => {
    document.body.innerHTML = '<p id="p">Hello world.</p>';
    const leaveA = acquireSelectionButton(window, { ...OPTS, onClick: vi.fn() });
    const leaveB = acquireSelectionButton(window, { ...OPTS, onClick: vi.fn() });
    select(document.getElementById('p') as Element);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(document.querySelectorAll(HOST_TAG)).toHaveLength(1);
    leaveA();
    leaveA();
    expect(shown()).toBe(true);
    leaveB();
    expect(host()).toBeNull();
    expect(globalThis.__translateSideSelection).toBeUndefined();
  });

  it('replaces a button left by a reloaded extension instead of joining it', () => {
    document.body.innerHTML = '<p id="p">Hello world.</p>';
    let alive = true;
    const stale = vi.fn();
    acquireSelectionButton(window, { ...OPTS, onClick: stale }, () => alive);
    alive = false;
    const fresh = vi.fn();
    const leave = acquireSelectionButton(window, { ...OPTS, onClick: fresh });
    expect(globalThis.__translateSideSelection?.users).toBe(1);
    select(document.getElementById('p') as Element);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(document.querySelectorAll(HOST_TAG)).toHaveLength(1);
    leave();
    expect(host()).toBeNull();
  });
});

describe('placePopup', () => {
  const view = { width: 1000, height: 800 };
  it('goes under the last line, from its start', () => {
    expect(placePopup(rect(100, 50, 300, 70), { width: 360, height: 200 }, view)).toEqual({ left: 100, top: 74, width: 360 });
  });

  it('from its end in right-to-left text, kept inside the window', () => {
    expect(placePopup(rect(500, 50, 700, 70), { width: 360, height: 200 }, view, true)).toEqual({ left: 340, top: 74, width: 360 });
    expect(placePopup(rect(900, 50, 990, 70), { width: 360, height: 200 }, view)).toEqual({ left: 636, top: 74, width: 360 });
  });

  it('above the line when there is no room under it, and never off the window', () => {
    expect(placePopup(rect(100, 700, 300, 720), { width: 360, height: 200 }, view)).toEqual({ left: 100, top: 496, width: 360 });
    // No room either way: as low as fits.
    expect(placePopup(rect(100, 100, 300, 720), { width: 360, height: 200 }, { width: 1000, height: 760 })).toEqual({ left: 100, top: 556, width: 360 });
    // A window narrower than the popup: the popup narrows.
    expect(placePopup(rect(10, 50, 100, 70), { width: 360, height: 200 }, { width: 300, height: 800 })).toEqual({ left: 4, top: 74, width: 292 });
  });
});

describe('createSelectionPopup', () => {
  const URL_ = 'chrome-extension://self/selection-popup.html';
  const ID = 'abc';
  const range = () => {
    document.body.innerHTML = '<p id="p">Hello world.</p>';
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('p') as Element);
    return r;
  };
  const popupHost = () => document.querySelector<HTMLElement>(POPUP_TAG);
  const frame = () => roots.at(-1)?.querySelector('iframe') ?? undefined;
  /** The frame loads: the content script hands the popup page its port. Returns what it posted, and the page's end of the channel. */
  const load = () => {
    const win = frame()?.contentWindow as Window;
    const posted = vi.spyOn(win, 'postMessage').mockImplementation(() => undefined);
    frame()?.dispatchEvent(new Event('load'));
    const [message, origin, transfer] = (posted.mock.calls[0] ?? []) as unknown as [unknown, string, MessagePort[]];
    return { message, origin, port: transfer?.[0] };
  };
  /** The popup page says something on its port; MessagePort delivery is asynchronous. */
  const say = async (port: MessagePort | undefined, data: unknown) => {
    port?.postMessage(data);
    await new Promise((r) => setTimeout(r, 20));
  };

  beforeEach(() => vi.useRealTimers());

  it('frames the popup page with the on-device APIs delegated, and shows it only once the page answers on its port', async () => {
    const popup = createSelectionPopup(window, 'Translation');
    popup.open(URL_, ID, range(), false);
    expect(frame()?.getAttribute('src')).toBe(`${URL_}#${ID}`);
    expect(frame()?.getAttribute('allow')).toBe('translator; language-detector; language-model');
    expect(frame()?.title).toBe('Translation');
    expect(popupHost()?.style.display).toBe('none');
    const { message, origin, port } = load();
    // The port goes to the extension's origin only, with the popup's id, which the page never sees.
    expect(message).toEqual({ type: POPUP_MESSAGE, id: ID });
    expect(origin).toBe('chrome-extension://self');
    await say(port, { type: POPUP_MESSAGE, height: 250.2 });
    expect(popupHost()?.style.display).toBe('block');
    // Under the last line (20, 30)–(200, 40).
    expect([popupHost()?.style.left, popupHost()?.style.top, popupHost()?.style.height]).toEqual(['20px', '44px', '251px']);
    await say(port, { type: POPUP_MESSAGE, height: 5000 });
    expect(popupHost()?.style.height).toBe(`${POPUP_MAX_HEIGHT}px`);
    await say(port, { type: POPUP_MESSAGE, height: 1 });
    expect(popupHost()?.style.height).toBe(`${POPUP_MIN_HEIGHT}px`);
    await say(port, { type: POPUP_MESSAGE, close: true });
    expect(popupHost()?.style.display).toBe('none');
    expect(frame()).toBeUndefined();
    popup.stop();
    expect(popupHost()).toBeNull();
  });

  it('does not hear the page: window messages, even from the frame, change nothing', async () => {
    const popup = createSelectionPopup(window, 'Translation');
    popup.open(URL_, ID, range(), false);
    const { port } = load();
    await say(port, { type: POPUP_MESSAGE, height: 200 });
    window.dispatchEvent(new MessageEvent('message', { source: frame()?.contentWindow ?? null, data: { type: POPUP_MESSAGE, close: true } }));
    window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: POPUP_MESSAGE, height: 400 } }));
    expect(popupHost()?.style.display).toBe('block');
    expect(popupHost()?.style.height).toBe('200px');
    popup.stop();
  });

  it('closes when its frame loads a second time: the popup page never navigates itself', async () => {
    const popup = createSelectionPopup(window, 'Translation');
    popup.open(URL_, ID, range(), false);
    const { port } = load();
    await say(port, { type: POPUP_MESSAGE, height: 200 });
    frame()?.dispatchEvent(new Event('load'));
    expect(popupHost()?.style.display).toBe('none');
    expect(frame()).toBeUndefined();
    popup.stop();
  });

  it('a second open replaces the first frame, and the first one is no longer heard', async () => {
    const popup = createSelectionPopup(window, 'Translation');
    popup.open(URL_, 'a', range(), false);
    const first = load().port;
    popup.open(URL_, 'b', range(), false);
    expect(document.querySelectorAll(POPUP_TAG)).toHaveLength(1);
    expect(roots.at(-1)?.querySelectorAll('iframe')).toHaveLength(1);
    expect(frame()?.getAttribute('src')).toMatch(/#b$/);
    await say(first, { type: POPUP_MESSAGE, height: 300 });
    expect(popupHost()?.style.display).toBe('none');
    popup.stop();
  });
});
