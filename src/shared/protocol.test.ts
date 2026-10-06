import { describe, expect, it } from 'vitest';
import { createClient, ProtocolError, serve, type PortLike } from './protocol.ts';

type Fn = (m: unknown) => void;

/** Two connected fake ports, delivering messages asynchronously like a real Port. */
function pair(): [PortLike, PortLike] {
  const make = () => ({ msg: [] as Fn[], disc: [] as (() => void)[] });
  const a = make();
  const b = make();
  let open = true;
  const end = (self: typeof a, other: typeof a): PortLike => ({
    postMessage: (m) => {
      if (!open) throw new Error('Attempting to use a disconnected port object');
      const copy: unknown = structuredClone(m);
      setTimeout(() => other.msg.forEach((fn) => fn(copy)), 0);
    },
    disconnect: () => {
      if (!open) return;
      open = false;
      setTimeout(() => other.disc.forEach((fn) => fn()), 0);
    },
    onMessage: { addListener: (fn) => self.msg.push(fn) },
    onDisconnect: { addListener: (fn) => self.disc.push(fn) },
  });
  return [end(a, b), end(b, a)];
}

type TestApi = {
  echo: { req: { n: number }; res: { n: number } };
  boom: { req: Record<string, never>; res: never };
  slow: { req: Record<string, never>; res: string };
};

function setup(timeoutMs = 1000) {
  const [panel, content] = pair();
  serve<TestApi>(content, {
    echo: ({ n }) => ({ n: n + 1 }),
    boom: () => {
      throw new ProtocolError('version-mismatch', 'nope');
    },
    slow: () => new Promise<string>(() => undefined),
  });
  return { client: createClient<TestApi>(panel, { timeoutMs }), panel, content };
}

describe('Port protocol', () => {
  it('matches responses to requests', async () => {
    const { client } = setup();
    const [a, b] = await Promise.all([client.request('echo', { n: 1 }), client.request('echo', { n: 10 })]);
    expect(a).toEqual({ n: 2 });
    expect(b).toEqual({ n: 11 });
  });

  it('carries handler errors with their code', async () => {
    const { client } = setup();
    await expect(client.request('boom', {})).rejects.toMatchObject({ code: 'version-mismatch', message: 'nope' });
  });

  it('answers unknown requests with an error instead of hanging', async () => {
    const { client } = setup();
    const raw = client as unknown as { request(name: string, body: unknown): Promise<unknown> };
    await expect(raw.request('nope', {})).rejects.toMatchObject({ code: 'unknown-request' });
    await expect(raw.request('toString', {})).rejects.toMatchObject({ code: 'unknown-request' });
  });

  it('rejects pending requests when the page side disconnects (navigation)', async () => {
    const { client, content } = setup();
    const p = client.request('slow', {});
    content.disconnect();
    await expect(p).rejects.toMatchObject({ code: 'disconnected' });
    expect(client.closed).toBe(true);
    await expect(client.request('echo', { n: 1 })).rejects.toMatchObject({ code: 'disconnected' });
  });

  it('times out', async () => {
    const { client } = setup(20);
    await expect(client.request('slow', {})).rejects.toMatchObject({ code: 'timeout' });
  });

  it('ignores messages that are not protocol messages', async () => {
    const { client, panel } = setup();
    panel.postMessage('hello?');
    panel.postMessage({ kind: 'req', id: 'x' });
    expect(await client.request('echo', { n: 0 })).toEqual({ n: 1 });
  });
});
