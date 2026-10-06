// @vitest-environment jsdom
// Content script (M0-E3/E4): idempotent injection and the panel handshake.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTENT_PORT_NAME, createClient, PROTOCOL_VERSION, type ContentApi, type PortLike } from '../src/shared/protocol.ts';

type Fn = (m?: unknown) => void;

const h = vi.hoisted(() => {
  const state = { connectListeners: [] as ((port: unknown) => void)[], runtimeId: 'ext' as string | undefined };
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
  extractPage: () => ({ ok: false, reason: 'no-content', url: 'https://example.com/' }),
}));

const { default: content } = await import('../src/entrypoints/content.ts');
const main = () => (content.main as (ctx?: unknown) => unknown)(undefined);

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
    onDisconnect: { addListener: () => undefined },
  };
  h.state.connectListeners.forEach((fn) => fn(pageEnd));
  return panelEnd;
}

beforeEach(() => {
  globalThis.__translateSide = undefined;
  h.state.connectListeners.length = 0;
  h.state.runtimeId = 'ext';
});

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
});
