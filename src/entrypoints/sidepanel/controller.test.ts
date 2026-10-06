import { describe, expect, it } from 'vitest';
import { accessKey, type TabAccess } from '@/shared/access';
import { CONTENT_PORT_NAME, PROTOCOL_VERSION, serve, type ContentApi, type ExtractResult, type PortLike } from '@/shared/protocol';
import { PanelController, type PanelView } from './controller.ts';

type Fn = (...args: never[]) => void;
type Api = ConstructorParameters<typeof PanelController>[0];

/** A fake content script per tab, reachable with tabs.connect while `pages[tabId]` is set. */
interface Page {
  docId: string;
  result: ExtractResult;
  /** A stale or broken content script that never answers hello. */
  mute?: boolean;
}

function fakeWorld() {
  const store: Record<string, TabAccess> = {};
  const pages: Record<number, Page> = {};
  const listeners: Record<string, Fn[]> = {};
  const connects: number[] = [];
  const contentEnds: Record<number, PortLike> = {};
  const on = (name: string) => ({ addListener: (fn: Fn) => (listeners[name] ??= []).push(fn) });
  const fire = (name: string, ...args: unknown[]) => listeners[name]?.forEach((fn) => (fn as (...a: unknown[]) => void)(...args));

  function connect(tabId: number, info: { name: string }): PortLike {
    connects.push(tabId);
    const panelSide = { msg: [] as Fn[], disc: [] as Fn[] };
    const pageSide = { msg: [] as Fn[], disc: [] as Fn[] };
    let open = true;
    const deliver = (to: typeof panelSide, m: unknown) => setTimeout(() => to.msg.forEach((fn) => (fn as (m: unknown) => void)(m)), 0);
    const close = (to: typeof panelSide) => {
      if (!open) return;
      open = false;
      setTimeout(() => to.disc.forEach((fn) => (fn as () => void)()), 0);
    };
    const panelEnd: PortLike = {
      postMessage: (m) => open && deliver(pageSide, structuredClone(m)),
      disconnect: () => close(pageSide),
      onMessage: { addListener: (fn) => panelSide.msg.push(fn) },
      onDisconnect: { addListener: (fn) => panelSide.disc.push(fn) },
    };
    const pageEnd: PortLike = {
      postMessage: (m) => open && deliver(panelSide, structuredClone(m)),
      disconnect: () => close(panelSide),
      onMessage: { addListener: (fn) => pageSide.msg.push(fn) },
      onDisconnect: { addListener: (fn) => pageSide.disc.push(fn) },
    };
    const page = pages[tabId];
    if (!page || info.name !== CONTENT_PORT_NAME) {
      // "Could not establish connection. Receiving end does not exist."
      close(panelSide);
      return panelEnd;
    }
    contentEnds[tabId] = pageEnd;
    serve<ContentApi>(pageEnd, {
      hello: () => (page.mute ? new Promise<never>(() => undefined) : { v: PROTOCOL_VERSION, docId: page.docId, url: 'https://example.com/' }),
      extract: () => page.result,
    });
    return panelEnd;
  }

  let now = 1;
  const api = {
    windows: { getCurrent: () => Promise.resolve({ id: 1 }) },
    tabs: {
      query: () => Promise.resolve([{ id: 10 }]),
      connect,
      onActivated: on('activated'),
      onUpdated: on('updated'),
      onRemoved: on('removed'),
      onDetached: on('detached'),
    },
    storage: {
      session: {
        get: (k: string) => Promise.resolve(k in store ? { [k]: store[k] } : {}),
        onChanged: on('changed'),
      },
    },
  } as unknown as Api;

  /** What the worker does after an injection attempt. */
  function setAccess(tabId: number, access: Omit<TabAccess, 'at'>) {
    const key = accessKey(tabId);
    store[key] = { ...access, at: now++ };
    fire('changed', { [key]: { newValue: store[key] } });
  }
  return { api, pages, connects, contentEnds, setAccess, fire, store };
}

const ok = (n: number): ExtractResult => ({
  ok: true,
  via: 'walk',
  url: 'https://example.com/',
  title: 'T',
  segments: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, kind: 'p', text: 't', inlineMarkup: 't', domPath: `/p[${i + 1}]`, translate: true })),
});

const wait = (ms = 25) => new Promise((r) => setTimeout(r, ms));

async function started(w: ReturnType<typeof fakeWorld>, opts = {}) {
  const c = new PanelController(w.api, { idleGraceMs: 20, lostAfterMs: 30, ...opts });
  const views: PanelView[] = [];
  c.subscribe((v) => views.push(v));
  await c.start();
  await wait();
  return { c, views };
}

describe('PanelController', () => {
  it('connects to a ready tab, says hello, and shows its segments', async () => {
    const w = fakeWorld();
    w.pages[10] = { docId: 'd1', result: ok(3) };
    w.store[accessKey(10)] = { status: 'ready', at: 0 };
    const { c } = await started(w);
    await wait();
    expect(c.view).toMatchObject({ kind: 'ready', docId: 'd1' });
    expect(c.view.kind === 'ready' && c.view.result.segments).toHaveLength(3);
  });

  it('shows "idle" when the tab was never opened with a gesture', async () => {
    const w = fakeWorld();
    const { c } = await started(w, { idleGraceMs: 100 });
    expect(c.view.kind).toBe('loading');
    await wait(150);
    expect(c.view.kind).toBe('idle');
    expect(w.connects).toEqual([]);
  });

  it('follows the worker from injecting to ready', async () => {
    const w = fakeWorld();
    const { c } = await started(w);
    w.setAccess(10, { status: 'injecting' });
    await wait();
    expect(c.view.kind).toBe('loading');
    w.pages[10] = { docId: 'd1', result: ok(1) };
    w.setAccess(10, { status: 'ready' });
    await wait();
    expect(c.view.kind).toBe('ready');
  });

  it('shows "can\'t read this page" for a blocked tab without connecting', async () => {
    const w = fakeWorld();
    w.store[accessKey(10)] = { status: 'blocked', reason: 'restricted', at: 0 };
    const { c } = await started(w);
    expect(c.view).toEqual({ kind: 'blocked', reason: 'restricted' });
    expect(w.connects).toEqual([]);
  });

  it('shows the selection hint when extraction finds no content, and blocked when the content script refuses', async () => {
    const w = fakeWorld();
    w.pages[10] = { docId: 'd1', result: { ok: false, reason: 'no-content', url: 'https://example.com/' } };
    w.store[accessKey(10)] = { status: 'ready', at: 0 };
    const { c } = await started(w);
    await wait();
    expect(c.view).toEqual({ kind: 'empty', url: 'https://example.com/' });

    w.pages[10] = { docId: 'd2', result: { ok: false, reason: 'denylisted', url: 'https://mail.google.com/' } };
    c.retry();
    await wait();
    expect(c.view).toEqual({ kind: 'blocked', reason: 'denylisted' });
  });

  it('routes per tab: each tab keeps its own view, and switching back does not reconnect', async () => {
    const w = fakeWorld();
    w.pages[10] = { docId: 'a', result: ok(1) };
    w.pages[20] = { docId: 'b', result: ok(2) };
    w.store[accessKey(10)] = { status: 'ready', at: 0 };
    w.store[accessKey(20)] = { status: 'ready', at: 0 };
    w.store[accessKey(30)] = { status: 'blocked', reason: 'restricted', at: 0 };
    const { c } = await started(w);
    await wait();
    w.fire('activated', { tabId: 20, windowId: 1 });
    await wait();
    expect(c.view).toMatchObject({ kind: 'ready', docId: 'b' });
    w.fire('activated', { tabId: 30, windowId: 1 });
    await wait();
    expect(c.view.kind).toBe('blocked');
    w.fire('activated', { tabId: 10, windowId: 1 });
    await wait();
    expect(c.view).toMatchObject({ kind: 'ready', docId: 'a' });
    expect(w.connects).toEqual([10, 20]);
    // Another window's activation is not ours.
    w.fire('activated', { tabId: 20, windowId: 2 });
    await wait();
    expect(c.view).toMatchObject({ docId: 'a' });
  });

  it('ignores access changes of background tabs until they are activated', async () => {
    const w = fakeWorld();
    w.pages[10] = { docId: 'a', result: ok(1) };
    w.store[accessKey(10)] = { status: 'ready', at: 0 };
    await started(w);
    await wait();
    w.pages[20] = { docId: 'b', result: ok(1) };
    w.setAccess(20, { status: 'ready' });
    await wait();
    expect(w.connects).toEqual([10]);
  });

  it('re-extracts after a navigation, when the worker re-injects', async () => {
    const w = fakeWorld();
    w.pages[10] = { docId: 'd1', result: ok(1) };
    w.store[accessKey(10)] = { status: 'ready', at: 0 };
    const { c } = await started(w);
    await wait();
    // The page unloads: its end of the port goes away.
    w.pages[10] = { docId: 'd2', result: ok(5) };
    w.contentEnds[10]?.disconnect();
    await wait();
    expect(c.view.kind).toBe('loading');
    w.setAccess(10, { status: 'ready' });
    await wait();
    expect(c.view).toMatchObject({ kind: 'ready', docId: 'd2' });
  });

  it('a repeat injection into the same document keeps the connection', async () => {
    const w = fakeWorld();
    w.pages[10] = { docId: 'd1', result: ok(1) };
    w.store[accessKey(10)] = { status: 'ready', at: 0 };
    await started(w);
    await wait();
    w.setAccess(10, { status: 'ready', detail: 'already injected' });
    await wait();
    expect(w.connects).toEqual([10]);
  });

  it('shows "lost" when the page went away and no re-injection follows', async () => {
    const w = fakeWorld();
    w.pages[10] = { docId: 'd1', result: ok(1) };
    w.store[accessKey(10)] = { status: 'ready', at: 0 };
    const { c } = await started(w);
    await wait();
    delete w.pages[10];
    w.contentEnds[10]?.disconnect();
    await wait(80);
    expect(c.view.kind).toBe('lost');
  });

  it('shows "lost" when the worker reports the grant is gone', async () => {
    const w = fakeWorld();
    w.pages[10] = { docId: 'd1', result: ok(1) };
    w.store[accessKey(10)] = { status: 'ready', at: 0 };
    const { c } = await started(w);
    await wait();
    w.setAccess(10, { status: 'lost', reason: 'no-grant' });
    await wait();
    expect(c.view.kind).toBe('lost');
  });

  it('drops a closed tab', async () => {
    const w = fakeWorld();
    w.pages[10] = { docId: 'd1', result: ok(1) };
    w.store[accessKey(10)] = { status: 'ready', at: 0 };
    const { c } = await started(w);
    await wait();
    w.fire('removed', 10);
    expect(c.view.kind).toBe('idle');
  });

  it('keeps "loading" while a slow page loads, and only then gives the worker lostAfterMs', async () => {
    const w = fakeWorld();
    w.pages[10] = { docId: 'd1', result: ok(1) };
    w.store[accessKey(10)] = { status: 'ready', at: 0 };
    const { c } = await started(w);
    await wait();
    w.fire('updated', 10, { status: 'loading' });
    expect(c.view.kind).toBe('loading');
    w.pages[10] = { docId: 'd2', result: ok(2) };
    w.contentEnds[10]?.disconnect();
    await wait(80); // longer than lostAfterMs (30): no "lost" while the page is loading
    expect(c.view.kind).toBe('loading');
    w.fire('updated', 10, { status: 'complete' });
    w.setAccess(10, { status: 'ready' });
    await wait(80);
    expect(c.view).toMatchObject({ kind: 'ready', docId: 'd2' });
  });

  it('shows "lost" lostAfterMs after a slow page completes without re-injection', async () => {
    const w = fakeWorld();
    w.pages[10] = { docId: 'd1', result: ok(1) };
    w.store[accessKey(10)] = { status: 'ready', at: 0 };
    const { c } = await started(w);
    await wait();
    w.fire('updated', 10, { status: 'loading' });
    delete w.pages[10];
    w.contentEnds[10]?.disconnect();
    await wait(80);
    expect(c.view.kind).toBe('loading');
    w.fire('updated', 10, { status: 'complete' });
    await wait(10);
    expect(c.view.kind).toBe('loading');
    await wait(60);
    expect(c.view.kind).toBe('lost');
  });

  it('restores the view after a same-document navigation keeps the connection', async () => {
    const w = fakeWorld();
    w.pages[10] = { docId: 'd1', result: ok(1) };
    w.store[accessKey(10)] = { status: 'ready', at: 0 };
    const { c } = await started(w);
    await wait();
    w.fire('updated', 10, { status: 'loading' });
    w.fire('updated', 10, { status: 'complete' });
    expect(c.view).toMatchObject({ kind: 'ready', docId: 'd1' });
    expect(w.connects).toEqual([10]);
  });

  it('shows an error when the content script does not answer hello in time', async () => {
    const w = fakeWorld();
    w.pages[10] = { docId: 'd1', result: ok(1), mute: true };
    w.store[accessKey(10)] = { status: 'ready', at: 0 };
    const { c } = await started(w, { helloTimeoutMs: 30, requestTimeoutMs: 10_000 });
    await wait(60);
    expect(c.view).toMatchObject({ kind: 'error', message: expect.stringContaining('hello') });
  });

  it('re-extracts an empty page on the same connection when a new gesture re-injects', async () => {
    const w = fakeWorld();
    w.pages[10] = { docId: 'd1', result: { ok: false, reason: 'no-content', url: 'https://example.com/' } };
    w.store[accessKey(10)] = { status: 'ready', at: 0 };
    const { c } = await started(w);
    await wait();
    expect(c.view.kind).toBe('empty');
    // The page filled in (client-side rendering); the user clicks again.
    const page = w.pages[10];
    if (page) page.result = ok(4);
    w.setAccess(10, { status: 'ready', detail: 'already injected' });
    await wait();
    expect(c.view).toMatchObject({ kind: 'ready', docId: 'd1' });
    expect(w.connects).toEqual([10]);
  });
});
