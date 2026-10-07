// Which thinking setting a request gets (Quirks.reasoning, decision S2; per-chunk policy M2-D16).
import type { NormalizedRequest, Quirks } from './types.ts';

type Reasoning = NonNullable<Quirks['reasoning']>;

/** The setting `req` is sent with: the base one, or the last `byChunk` entry its chunk has reached. */
export function reasoningFor(reasoning: Quirks['reasoning'], req: Pick<NormalizedRequest, 'chunkIndex'>): Omit<Reasoning, 'byChunk'> | undefined {
  if (reasoning === undefined) return undefined;
  const { byChunk, ...base } = reasoning;
  const index = req.chunkIndex;
  if (index === undefined || byChunk === undefined) return base;
  const entry = byChunk.filter((e) => index >= e.fromChunk).at(-1);
  return entry === undefined ? base : { ...base, lowest: entry.lowest, reserveTokens: entry.reserveTokens };
}

/** The reserve a client reports: the largest one the policy can send, so no chunk's call is cut short. */
export function reserveTokensOf(reasoning: Quirks['reasoning']): number {
  if (reasoning === undefined) return 0;
  return Math.max(reasoning.reserveTokens, ...(reasoning.byChunk ?? []).map((e) => e.reserveTokens));
}
