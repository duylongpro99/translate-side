// Which thinking setting a request gets (Quirks.reasoning, decision S2; per-chunk policy M2-D16).
import type { Quirks, ReserveQuery } from './types.ts';

type Reasoning = NonNullable<Quirks['reasoning']>;

/**
 * The setting `req` is sent with: the base one (no chunk index, or `baseReasoning`), or the last
 * `byChunk` entry its chunk has reached.
 */
export function reasoningFor(reasoning: Quirks['reasoning'], req: ReserveQuery): Omit<Reasoning, 'byChunk'> | undefined {
  if (reasoning === undefined) return undefined;
  const { byChunk, ...base } = reasoning;
  const index = req.chunkIndex;
  if (index === undefined || byChunk === undefined || req.baseReasoning === true) return base;
  const entry = byChunk.filter((e) => index >= e.fromChunk).at(-1);
  return entry === undefined ? base : { ...base, lowest: entry.lowest, reserveTokens: entry.reserveTokens };
}

/** The reserve of the setting `req` is sent with, so a thinking chunk gets room and the others don't pay for it. */
export function reserveTokensOf(reasoning: Quirks['reasoning'], req: ReserveQuery): number {
  return reasoningFor(reasoning, req)?.reserveTokens ?? 0;
}
