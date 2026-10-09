// Which model answered a call (plan M4-E9). A fallback chain (fallback.ts) may hand a request to
// another profile's model, so `producedBy.model` and a usage event's model are read from the call
// as it streams (LLMClient.servedBy), not from the client the prompt was built for.

import type { LLMClient, NormalizedEvent, NormalizedRequest } from '../llm/types.ts';

/** `client.stream(req)`, telling `onModel` which model answers it (LLMClient.servedBy) as its events arrive. */
export async function* servedStream(client: LLMClient, req: NormalizedRequest, onModel: (model: string) => void): AsyncGenerator<NormalizedEvent> {
  for await (const event of client.stream(req)) {
    onModel(client.servedBy?.(req) ?? req.model);
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
