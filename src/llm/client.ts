// Binds a protocol adapter and a connection to one model: the LLMClient the engine asks for by
// role (DESIGN.md §4.2, §5.3). The shell's routing (§4.3.1) builds these; M4 adds presets.

import { createAnthropicAdapter } from './anthropic.ts';
import { createOpenAIAdapter } from './openai.ts';
import type { AdapterOptions } from './sdk.ts';
import type { LLMClient, Protocol, ProtocolAdapter, ResolvedConnection } from './types.ts';

export function createAdapter(protocol: Protocol, options: AdapterOptions = {}): ProtocolAdapter {
  switch (protocol) {
    case 'anthropic-messages':
      return createAnthropicAdapter(options);
    case 'openai-chat':
      return createOpenAIAdapter(options);
    case 'chrome-builtin':
      throw new Error('chrome-builtin is not implemented yet (M4)');
  }
}

/** A client bound to `model`. `req.model` must equal it (src/llm/types.ts): a mismatch is a programming error. */
export function bindClient(adapter: ProtocolAdapter, conn: ResolvedConnection, model: string): LLMClient {
  return {
    model,
    reasoningReserveTokens: conn.quirks.reasoning?.reserveTokens ?? 0,
    stream(req) {
      if (req.model !== model) throw new Error(`request model ${req.model} differs from the client's ${model}`);
      return adapter.stream(conn, req);
    },
  };
}

export function createClient(conn: ResolvedConnection, model: string, options: AdapterOptions = {}): LLMClient {
  return bindClient(createAdapter(conn.protocol, options), conn, model);
}
