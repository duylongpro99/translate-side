// Content ⇄ panel Port protocol (plan M0-E4, decision S1). The panel connects to the content
// script with tabs.connect(tabId); the worker is not on this path. The panel speaks first
// (`hello`), so the content script never pushes into a panel that isn't there yet (S5).
import type { Segment } from '@/engine/types';

/** Bump on any incompatible change to the messages below. */
export const PROTOCOL_VERSION = 1;
/** The version is part of the port name: a content script from another version ignores the port. */
export const CONTENT_PORT_NAME = `translate-side/content/v${PROTOCOL_VERSION}`;

export type ExtractVia = 'walk' | 'readability';

export type ExtractResult =
  | { ok: true; via: ExtractVia; url: string; title: string; lang?: string; segments: Segment[] }
  /** no-content: neither the walk nor Readability found enough text (→ selection hint, decision S3). */
  | { ok: false; reason: 'no-content' | 'denylisted'; url: string };

export interface HelloInfo {
  v: number;
  /** Random per content-script instance: a new document has a new id. */
  docId: string;
  url: string;
}

/** Requests the panel sends to the content script, and their responses. */
export type ContentApi = {
  hello: { req: { v: number }; res: HelloInfo };
  extract: { req: Record<string, never>; res: ExtractResult };
};

type ApiShape = Record<string, { req: unknown; res: unknown }>;

export type ErrorCode = 'version-mismatch' | 'unknown-request' | 'failed' | 'disconnected' | 'timeout';

export type RequestMessage<A extends ApiShape = ContentApi> = {
  [K in keyof A & string]: { kind: 'req'; id: number; name: K; body: A[K]['req'] };
}[keyof A & string];

export type ResponseMessage =
  | { kind: 'res'; id: number; ok: true; body: unknown }
  | { kind: 'res'; id: number; ok: false; error: { code: ErrorCode; message: string } };

export class ProtocolError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/** The parts of a runtime.Port this module uses, so tests can pass a fake. */
export interface PortLike {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(fn: (message: unknown) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

export function isRequestMessage(x: unknown): x is RequestMessage<ApiShape> {
  return isObject(x) && x.kind === 'req' && typeof x.id === 'number' && typeof x.name === 'string';
}

export function isResponseMessage(x: unknown): x is ResponseMessage {
  return isObject(x) && x.kind === 'res' && typeof x.id === 'number' && typeof x.ok === 'boolean';
}

export interface Client<A extends ApiShape> {
  request<K extends keyof A & string>(name: K, body: A[K]['req']): Promise<A[K]['res']>;
  readonly closed: boolean;
}

/** Request/response over a Port. Pending requests reject when the port disconnects or times out. */
export function createClient<A extends ApiShape = ContentApi>(port: PortLike, opts: { timeoutMs?: number } = {}): Client<A> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let nextId = 1;
  let closed = false;

  port.onMessage.addListener((msg) => {
    if (!isResponseMessage(msg)) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.body);
    else p.reject(new ProtocolError(msg.error.code, msg.error.message));
  });
  port.onDisconnect.addListener(() => {
    closed = true;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new ProtocolError('disconnected', 'The page closed the connection.'));
    }
    pending.clear();
  });

  return {
    get closed() {
      return closed;
    },
    request(name, body) {
      if (closed) return Promise.reject(new ProtocolError('disconnected', 'The connection is closed.'));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new ProtocolError('timeout', `No answer to "${name}" within ${timeoutMs} ms.`));
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        port.postMessage({ kind: 'req', id, name, body });
      });
    },
  };
}

export type Handlers<A extends ApiShape> = { [K in keyof A]: (body: A[K]['req']) => A[K]['res'] | Promise<A[K]['res']> };

/** Answers requests arriving on a Port. A thrown error becomes an `ok: false` response. */
export function serve<A extends ApiShape = ContentApi>(port: PortLike, handlers: Handlers<A>): void {
  port.onMessage.addListener((msg) => {
    if (!isRequestMessage(msg)) return;
    const reply = (res: ResponseMessage) => {
      try {
        port.postMessage(res);
      } catch {
        // The panel went away while we were working; nothing to answer.
      }
    };
    const handler = Object.hasOwn(handlers, msg.name) ? (handlers[msg.name] as (b: unknown) => unknown) : undefined;
    if (!handler) {
      reply({ kind: 'res', id: msg.id, ok: false, error: { code: 'unknown-request', message: `Unknown request "${msg.name}".` } });
      return;
    }
    Promise.resolve()
      .then(() => handler(msg.body))
      .then(
        (body) => reply({ kind: 'res', id: msg.id, ok: true, body }),
        (err: unknown) => {
          const code = err instanceof ProtocolError ? err.code : 'failed';
          reply({ kind: 'res', id: msg.id, ok: false, error: { code, message: err instanceof Error ? err.message : String(err) } });
        },
      );
  });
}
