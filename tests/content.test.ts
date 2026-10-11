// @vitest-environment jsdom
// Content script (M0-E3/E4): idempotent injection and the panel handshake.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTENT_PORT_NAME, createClient, PROTOCOL_VERSION, type ContentApi, type PortLike } from '../src/shared/protocol.ts';

type Fn = (m?: unknown) => void;

const h = vi.hoisted(() => {
  const state = { connectListeners: [] as ((port: unknown) => void)[], runtimeId: 'ext' as string | undefined, page: false, rerendered: false, away: false };
  const api = {
    runtime: {
      get id() {
        return state.runtimeId;
      },
      onConnect: { addListener: (fn: (port: unknown) => void) => state.connectListeners.push(fn) },
    },
  };
  return { state, api };
});

vi.mock('wxt/browser', () => ({ browser: h.api }));
vi.mock('@/extract', () => ({
  // With `page`, two paragraphs: the first on screen (jsdom has no layout: a fixed rect).
  extractPage: (doc: Document, targets?: Map<string, Element>) => {
    if (!h.state.page) return { ok: false, reason: 'no-content', url: 'https://example.com/' };
    if (h.state.away) return { ok: false, reason: 'no-content', url: 'https://example.com/other' };
    doc.body.innerHTML = '<p>One</p><p>Two</p>';
    const [a, b] = [...doc.querySelectorAll('p')];
    if (a && b) {
      a.getBoundingClientRect = () => ({ top: 0, bottom: 50, left: 0, right: 100, width: 100, height: 50 }) as DOMRect;
      b.getBoundingClientRect = () => ({ top: 5000, bottom: 5050, left: 0, right: 100, width: 100, height: 50 }) as DOMRect;
      targets?.set('a', a);
      targets?.set('b', b);
    }
    const seg = (id: string, text = id) => ({ id, kind: 'p', text, inlineMarkup: text, domPath: '/p', translate: true });
    // After a re-render: block "a" moved (a new path, so a new fresh id) and a block "c" came in.
    if (h.state.rerendered) {
      targets?.delete('a');
      if (a) targets?.set('moved', a);
      return { ok: true, via: 'walk', url: 'https://example.com/#x', title: 'T', segments: [seg('moved', 'a'), seg('b'), seg('c')] };
    }
    return { ok: true, via: 'walk', url: 'https://example.com/', title: 'T', segments: [seg('a'), seg('b')] };
  },
}));

const { default: content } = await import('../src/entrypoints/content.ts');
const main = () => (content.main as (ctx?: unknown) => unknown)(undefined);

/** The page ends' disconnect listeners: each test hangs up, so no change watch outlives it. */
const hangUps: Fn[] = [];

/** Connect like the panel does: returns the panel's end. */
function connect(name = CONTENT_PORT_NAME): PortLike {
  const toPage: Fn[] = [];
  const toPanel: Fn[] = [];
  const panelEnd: PortLike = {
    postMessage: (m) => setTimeout(() => toPage.forEach((fn) => fn(structuredClone(m))), 0),
    disconnect: () => undefined,
    onMessage: { addListener: (fn) => toPanel.push(fn) },
    onDisconnect: { addListener: () => undefined },
  };
  const pageEnd = {
    name,
    postMessage: (m: unknown) => setTimeout(() => toPanel.forEach((fn) => fn(structuredClone(m))), 0),
    disconnect: () => undefined,
    onMessage: { addListener: (fn: Fn) => toPage.push(fn) },
    onDisconnect: { addListener: (fn: Fn) => hangUps.push(fn) },
  };
  h.state.connectListeners.forEach((fn) => fn(pageEnd));
  return panelEnd;
}

beforeEach(() => {
  globalThis.__translateSide = undefined;
  h.state.page = false;
  h.state.rerendered = false;
  h.state.away = false;
  h.state.connectListeners.length = 0;
  h.state.runtimeId = 'ext';
});
afterEach(() => hangUps.splice(0).forEach((fn) => fn()));

describe('content script', () => {
  it('is registered at runtime only, never in the manifest', () => {
    expect(content.registration).toBe('runtime');
  });

  it('answers "already" on a repeat injection and registers its listener once', () => {
    expect(main()).toBe('injected');
    expect(main()).toBe('already');
    expect(h.state.connectListeners).toHaveLength(1);
  });

  it('replaces a copy left by a reloaded extension (dead runtime)', () => {
    expect(main()).toBe('injected');
    h.state.runtimeId = undefined;
    expect(main()).toBe('injected');
  });

  it('says hello with the protocol version and a per-document id, then extracts', async () => {
    main();
    const client = createClient<ContentApi>(connect());
    const hello = await client.request('hello', { v: PROTOCOL_VERSION });
    expect(hello.v).toBe(PROTOCOL_VERSION);
    expect(hello.docId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await client.request('extract', {})).toMatchObject({ ok: false, reason: 'no-content' });
  });

  it('refuses a panel speaking another protocol version', async () => {
    main();
    const client = createClient<ContentApi>(connect());
    await expect(client.request('hello', { v: PROTOCOL_VERSION + 1 })).rejects.toMatchObject({ code: 'version-mismatch' });
  });

  it('ignores ports that are not its own', async () => {
    main();
    const client = createClient<ContentApi>(connect('something-else'), { timeoutMs: 30 });
    await expect(client.request('hello', { v: PROTOCOL_VERSION })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('returns what is on screen with the page, then pushes viewport changes (plan M3-E1)', async () => {
    h.state.page = true;
    main();
    const events: unknown[] = [];
    const client = createClient<ContentApi>(connect(), { onEvent: (e) => events.push(e) });
    await client.request('hello', { v: PROTOCOL_VERSION });
    expect(await client.request('extract', {})).toMatchObject({ ok: true, visible: ['a'], anchor: { id: 'a', offset: 0 } });
    const [a, b] = [...document.querySelectorAll('p')];
    if (!a || !b) throw new Error('no page');
    a.getBoundingClientRect = () => ({ top: -5000, bottom: -4950, left: 0, right: 100, width: 100, height: 50 }) as DOMRect;
    b.getBoundingClientRect = () => ({ top: -10, bottom: 40, left: 0, right: 100, width: 100, height: 50 }) as DOMRect;
    document.dispatchEvent(new Event('scroll'));
    await vi.waitFor(() => expect(events).toEqual([{ kind: 'evt', name: 'viewport', body: { visible: ['b'], anchor: { id: 'b', offset: 0.2 } } }]));
  });

  it('reads the page again when it changes and pushes it, keeping the ids of unchanged blocks (plan M5-E2)', async () => {
    h.state.page = true;
    main();
    const events: { name: string; body: { segments?: { id: string; text: string }[]; visible?: string[] } }[] = [];
    const client = createClient<ContentApi>(connect(), { onEvent: (e) => events.push(e as never) });
    await client.request('hello', { v: PROTOCOL_VERSION });
    await client.request('extract', {});
    // Reads that find the same page push nothing.
    document.body.append(document.createElement('div'));
    await new Promise((r) => setTimeout(r, 700));
    expect(events.filter((e) => e.name === 'changed')).toEqual([]);
    h.state.rerendered = true;
    document.body.append(document.createElement('div'));
    await vi.waitFor(() => expect(events.filter((e) => e.name === 'changed')).toHaveLength(1), { timeout: 2000 });
    const changed = events.find((e) => e.name === 'changed')?.body;
    expect(changed?.segments?.map((s) => [s.id, s.text])).toEqual([
      ['a', 'a'],
      ['b', 'b'],
      ['c', 'c'],
    ]);
    // The viewport follows the kept id.
    expect(changed?.visible).toEqual(['a']);
  });

  it('a route change to a page that cannot be read is pushed once, as not ok; the next good read is pushed (review N8)', async () => {
    h.state.page = true;
    main();
    const events: { name: string; body: { ok: boolean; url: string } }[] = [];
    const client = createClient<ContentApi>(connect(), { onEvent: (e) => events.push(e as never) });
    await client.request('hello', { v: PROTOCOL_VERSION });
    await client.request('extract', {});
    h.state.away = true;
    document.body.append(document.createElement('div'));
    await vi.waitFor(() => expect(events.filter((e) => e.name === 'changed')).toHaveLength(1), { timeout: 2000 });
    // More unreadable reads on the same address push nothing more.
    document.body.append(document.createElement('div'));
    await new Promise((r) => setTimeout(r, 700));
    h.state.away = false;
    document.body.append(document.createElement('div'));
    await vi.waitFor(() => expect(events.filter((e) => e.name === 'changed')).toHaveLength(2), { timeout: 2000 });
    expect(events.filter((e) => e.name === 'changed').map((e) => [e.body.ok, e.body.url])).toEqual([
      [false, 'https://example.com/other'],
      [true, 'https://example.com/'],
    ]);
  });
});
