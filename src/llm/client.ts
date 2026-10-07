// Binds a protocol adapter and a connection to one model: the LLMClient the engine asks for by
// role (DESIGN.md §4.2, §5.3). The shell's routing (§4.3.1) builds these; M4 adds presets.
//
// The vendor SDKs load lazily, one per protocol, on the first call that needs them (review N5):
// the panel bundle carries no SDK until a translation starts, and only the SDK of the protocol in
// use is ever fetched. Import this file, not ./index.ts (which re-exports the adapters
// statically), from code that should stay light.

import { reserveTokensOf } from './reasoning.ts';
import type { AdapterOptions } from './sdk.ts';
import type { LLMClient, Protocol, ProtocolAdapter, ResolvedConnection } from './types.ts';

const loaders: Record<Exclude<Protocol, 'chrome-builtin'>, (options: AdapterOptions) => Promise<ProtocolAdapter>> = {
  'anthropic-messages': async (options) => (await import('./anthropic.ts')).createAnthropicAdapter(options),
  'openai-chat': async (options) => (await import('./openai.ts')).createOpenAIAdapter(options),
};

/** An adapter whose SDK module is imported on first use. Same contract as the adapter it loads. */
function lazyAdapter(protocol: Exclude<Protocol, 'chrome-builtin'>, options: AdapterOptions): ProtocolAdapter {
  let loaded: Promise<ProtocolAdapter> | undefined;
  const load = () => (loaded ??= loaders[protocol](options).catch((err: unknown) => {
    // A failed chunk load (e.g. the extension was updated under the page) may succeed later.
    loaded = undefined;
    throw err;
  }));
  return {
    protocol,
    async *stream(conn, req) {
      let adapter: ProtocolAdapter;
      try {
        adapter = await load();
      } catch (err) {
        // The contract: failures are one `error` event, never a throw (src/llm/types.ts).
        req.signal.throwIfAborted();
        yield { type: 'error', error: { kind: 'unknown', message: `Could not load the ${protocol} adapter`, raw: err } };
        return;
      }
      req.signal.throwIfAborted();
      yield* adapter.stream(conn, req);
    },
    async listModels(conn) {
      const adapter = await load();
      return adapter.listModels ? adapter.listModels(conn) : [];
    },
    async probe(conn) {
      return (await load()).probe(conn);
    },
  };
}

export function createAdapter(protocol: Protocol, options: AdapterOptions = {}): ProtocolAdapter {
  if (protocol === 'chrome-builtin') throw new Error('chrome-builtin is not implemented yet (M4)');
  return lazyAdapter(protocol, options);
}

/** A client bound to `model`. `req.model` must equal it (src/llm/types.ts): a mismatch is a programming error. */
export function bindClient(adapter: ProtocolAdapter, conn: ResolvedConnection, model: string): LLMClient {
  return {
    model,
    reasoningReserveTokens: reserveTokensOf(conn.quirks.reasoning),
    stream(req) {
      if (req.model !== model) throw new Error(`request model ${req.model} differs from the client's ${model}`);
      return adapter.stream(conn, req);
    },
  };
}

export function createClient(conn: ResolvedConnection, model: string, options: AdapterOptions = {}): LLMClient {
  return bindClient(createAdapter(conn.protocol, options), conn, model);
}
