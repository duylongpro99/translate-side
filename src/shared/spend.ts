// The running total of what translations cost (plan M3-E9, DESIGN §4.3.5 usage meter): every
// `usage` event of every job (pages, selections, retries) adds its tokens and its USD to one record
// in storage.local, shown in settings. Per month as well, the start of the "spend per day and
// month" view; kept local like the keys, since it says what this device spent.
import type { browser } from 'wxt/browser';
import type { UsageTotals } from './cost.ts';

type Browser = typeof browser;

export const SPEND_KEY = 'spend';
/** Months kept in the per-month list (the oldest go first). */
export const SPEND_MONTHS = 12;

export interface SpendTotals {
  /** Epoch ms of the first spend counted (or of the last reset). */
  since: number;
  /** USD of the priced usage. */
  usd: number;
  /** All tokens, priced or not. `input` includes `cachedInput`, as everywhere (src/llm/types.ts). */
  input: number;
  cachedInput: number;
  output: number;
  /** Tokens (input + output) spent on a model with no price: counted, not in `usd`. */
  unpricedTokens: number;
  /** USD per calendar month, "2026-10" → 0.12, local time. */
  months: Record<string, number>;
}

export interface SpendDelta {
  usage: UsageTotals;
  /** Undefined when the model has no price. */
  usd: number | undefined;
  /** The model profile that spent it (M4-E10 usage per profile); absent: not counted per profile. */
  profileId?: string;
  /** The model that answered, shown for a profile removed since. */
  model?: string;
}

export const monthKey = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** A stored record as SpendTotals, or undefined when there is none (or it is not one). */
export function cleanSpend(value: unknown): SpendTotals | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const r = value as Record<string, unknown>;
  const months: Record<string, number> = {};
  if (typeof r.months === 'object' && r.months !== null) {
    for (const [k, v] of Object.entries(r.months)) if (/^\d{4}-\d{2}$/.test(k)) months[k] = num(v);
  }
  return { since: num(r.since), usd: num(r.usd), input: num(r.input), cachedInput: num(r.cachedInput), output: num(r.output), unpricedTokens: num(r.unpricedTokens), months };
}

/** `prev` plus one usage event, at `now`. Pure. */
export function addSpend(prev: SpendTotals | undefined, delta: SpendDelta, now: number): SpendTotals {
  const base = prev ?? { since: now, usd: 0, input: 0, cachedInput: 0, output: 0, unpricedTokens: 0, months: {} };
  let months = base.months;
  if (delta.usd !== undefined) {
    const key = monthKey(now);
    const all = { ...base.months, [key]: (base.months[key] ?? 0) + delta.usd };
    months = Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b)).slice(-SPEND_MONTHS));
  }
  return {
    since: base.since,
    usd: base.usd + (delta.usd ?? 0),
    input: base.input + delta.usage.input,
    cachedInput: base.cachedInput + delta.usage.cachedInput,
    output: base.output + delta.usage.output,
    unpricedTokens: base.unpricedTokens + (delta.usd === undefined ? delta.usage.input + delta.usage.output : 0),
    months,
  };
}

export async function readSpend(api: Browser): Promise<SpendTotals | undefined> {
  const got = await api.storage.local.get(SPEND_KEY);
  return cleanSpend(got[SPEND_KEY]);
}

export async function resetSpend(api: Browser): Promise<void> {
  await api.storage.local.remove(SPEND_KEY);
}

/**
 * Adds usage to the stored total. Writes run one after another (each on what the last wrote), so
 * two streams reporting usage together both count. A failed write loses that one event's count,
 * never the translation.
 */
export class SpendLedger {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly api: Browser,
    private readonly now: () => number = Date.now,
  ) {}

  add(delta: SpendDelta): Promise<void> {
    if (delta.usage.input === 0 && delta.usage.output === 0 && !delta.usd) return this.idle();
    const run = this.chain.then(async () => {
      const next = addSpend(await readSpend(this.api), delta, this.now());
      await this.api.storage.local.set({ [SPEND_KEY]: next });
    });
    this.chain = run.catch(() => {});
    return this.idle();
  }

  /** Resolves when the writes queued so far are done (tests). */
  idle(): Promise<void> {
    return this.chain.then(() => undefined);
  }
}
