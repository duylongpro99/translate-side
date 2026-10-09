// Which link answered a call (plan M4-E9). A fallback chain (fallback.ts) may hand a request to
// another profile, so `producedBy.model` and a usage event's model and client id are read from
// the call as it streams (LLMClient.servedBy), not from the client the prompt was built for.

import type { LLMClient, NormalizedEvent, NormalizedRequest, Served } from '../llm/types.ts';

/** Who answers `req` now: the chain's link (servedBy), else the request's model and the client's id. */
export function servedOf(client: LLMClient, req: NormalizedRequest): Served {
  return client.servedBy?.(req) ?? { model: req.model, ...(client.id === undefined ? {} : { id: client.id }) };
}

/** `client.stream(req)`, telling `onServed` who answers it as each event arrives (before it is passed on). */
export async function* servedStream(client: LLMClient, req: NormalizedRequest, onServed: (served: Served) => void): AsyncGenerator<NormalizedEvent> {
  for await (const event of client.stream(req)) {
    onServed(servedOf(client, req));
    yield event;
  }
}

/** A `producedBy` whose model is read when an event is made (translate-chunk.ts copies it). */
export function producedByOf(strategy: string, stage: string, prepared: { readonly model: string }): { strategy: string; stage: string; readonly model: string } {
  return {
    strategy,
    stage,
    get model() {
      return prepared.model;
    },
  };
}
