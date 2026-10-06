// Cost of a job from its `usage` events (DESIGN.md §4.3.5 usage meter; plan M1 "a cost readout
// shows what the page cost"). The same formula as the harness (scripts/eval/pricing.ts).
import type { ModelProfile } from './settings.ts';

export interface UsageTotals {
  /** Includes cached tokens (src/llm/types.ts). */
  input: number;
  cachedInput: number;
  output: number;
}

/** USD; undefined when the profile has no pricing. Cache writes are priced as plain input (as in the harness). */
export function costUsd(pricing: ModelProfile['pricing'], u: UsageTotals): number | undefined {
  if (pricing === undefined) return undefined;
  return ((u.input - u.cachedInput) * pricing.inPerM + u.cachedInput * pricing.cachedInPerM + u.output * pricing.outPerM) / 1e6;
}

/** "$0.0072", "<$0.0001", "$1.23". */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.0001) return '<$0.0001';
  return usd < 0.1 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}
