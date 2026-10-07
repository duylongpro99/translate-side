// Per-job budget (DESIGN.md §5.6) and the output-token ceiling for a translate call (§5.7).

import type { Budget, BudgetLimits } from './types.ts';

/** The failure of a segment no call was made for because the job's budget was spent (§5.6). */
export const BUDGET_MESSAGE = 'The job budget was exhausted before this segment was translated';

export function createBudget(limits: BudgetLimits, now: () => number): Budget {
  const startedAt = now();
  const spent = { input: 0, output: 0, cachedInput: 0 };
  const remainingTokens = (): number =>
    limits.maxTokens === undefined ? Infinity : Math.max(0, limits.maxTokens - spent.input - spent.output);
  return {
    limits,
    spent,
    record(usage) {
      spent.input += usage.input;
      spent.output += usage.output;
      spent.cachedInput += usage.cachedInput ?? 0;
    },
    remainingTokens,
    exhausted() {
      if (limits.maxTokens !== undefined && remainingTokens() <= 0) return true;
      return limits.maxMs !== undefined && now() - startedAt >= limits.maxMs;
    },
  };
}

/**
 * `max_tokens` for one translate call (§5.7, decision S2): 2.0 × estimated source tokens
 * + 12 × segments + the model's reasoning reserve. No per-language multiplier.
 */
export function maxOutputTokens(q: { sourceTokens: number; segments: number; reasoningReserveTokens: number }): number {
  return Math.ceil(2.0 * q.sourceTokens + 12 * q.segments + q.reasoningReserveTokens);
}
