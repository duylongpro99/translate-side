// The running total of what translations cost (plan M3-E9, M4-E10, DESIGN §4.3.5 usage meter):
// every `usage` event of every job (pages, selections, retries) adds its tokens and its USD to one
// record in storage.local, shown in settings: in all, per month, per day, and per model profile.
// Kept local like the keys, since it says what this device spent.
//
// The optional monthly soft limit (M4-E10) lives next to it (`spendLimit`): once this month's
// spend reaches it, a new translation waits for "Continue anyway", which holds for the rest of
// the month. It is a warning, not a cap: a translation already running finishes.
import type { browser } from 'wxt/browser';
import type { UsageTotals } from './cost.ts';

type Browser = typeof browser;

export const SPEND_KEY = 'spend';
/** Months kept in the per-month list (the oldest go first). */
export const SPEND_MONTHS = 12;
/** Days kept in the per-day list (the oldest go first): enough for this month and the last. */
export const SPEND_DAYS = 62;
export const SPEND_LIMIT_KEY = 'spendLimit';

/** One model profile's share (M4-E10 usage per profile). */
export interface ProfileSpend {
  /** The model it answered with last, shown when the profile is gone. */
  model: string;
  usd: number;
  input: number;
  cachedInput: number;
  output: number;
  /** Tokens (input + output) spent with no price: counted, not in `usd`. */
  unpricedTokens: number;
}

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
  /** USD per calendar day, "2026-10-09" → 0.03, local time (the last SPEND_DAYS days with spend). */
  days: Record<string, number>;
  /** Per model profile id, since the last reset (usage reported without a profile is not in it). */
  profiles: Record<string, ProfileSpend>;
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

export const dayKey = (at: number) => `${monthKey(at)}-${String(new Date(at).getDate()).padStart(2, '0')}`;

/** The last `keep` entries of a date-keyed record, in date order. */
const latest = (record: Record<string, number>, keep: number) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)).slice(-keep));

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** A stored record as SpendTotals, or undefined when there is none (or it is not one). */
export function cleanSpend(value: unknown): SpendTotals | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const r = value as Record<string, unknown>;
  const months: Record<string, number> = {};
  if (typeof r.months === 'object' && r.months !== null) {
    for (const [k, v] of Object.entries(r.months)) if (/^\d{4}-\d{2}$/.test(k)) months[k] = num(v);
  }
  const days: Record<string, number> = {};
  if (typeof r.days === 'object' && r.days !== null) {
    for (const [k, v] of Object.entries(r.days)) if (/^\d{4}-\d{2}-\d{2}$/.test(k)) days[k] = num(v);
  }
  const profiles: Record<string, ProfileSpend> = {};
  if (typeof r.profiles === 'object' && r.profiles !== null) {
    for (const [id, raw] of Object.entries(r.profiles)) {
      if (typeof raw !== 'object' || raw === null) continue;
      const p = raw as Record<string, unknown>;
      profiles[id] = { model: typeof p.model === 'string' ? p.model : '', usd: num(p.usd), input: num(p.input), cachedInput: num(p.cachedInput), output: num(p.output), unpricedTokens: num(p.unpricedTokens) };
    }
  }
  return { since: num(r.since), usd: num(r.usd), input: num(r.input), cachedInput: num(r.cachedInput), output: num(r.output), unpricedTokens: num(r.unpricedTokens), months, days, profiles };
}

/** `prev` plus one usage event, at `now`. Pure. */
export function addSpend(prev: SpendTotals | undefined, delta: SpendDelta, now: number): SpendTotals {
  const base = prev ?? { since: now, usd: 0, input: 0, cachedInput: 0, output: 0, unpricedTokens: 0, months: {}, days: {}, profiles: {} };
  let { months, days, profiles } = base;
  const unpriced = delta.usd === undefined ? delta.usage.input + delta.usage.output : 0;
  if (delta.usd !== undefined) {
    const month = monthKey(now);
    const day = dayKey(now);
    months = latest({ ...base.months, [month]: (base.months[month] ?? 0) + delta.usd }, SPEND_MONTHS);
    days = latest({ ...base.days, [day]: (base.days[day] ?? 0) + delta.usd }, SPEND_DAYS);
  }
  if (delta.profileId !== undefined) {
    const p = base.profiles[delta.profileId] ?? { model: '', usd: 0, input: 0, cachedInput: 0, output: 0, unpricedTokens: 0 };
    profiles = {
      ...base.profiles,
      [delta.profileId]: {
        model: delta.model ?? p.model,
        usd: p.usd + (delta.usd ?? 0),
        input: p.input + delta.usage.input,
        cachedInput: p.cachedInput + delta.usage.cachedInput,
        output: p.output + delta.usage.output,
        unpricedTokens: p.unpricedTokens + unpriced,
      },
    };
  }
  return {
    since: base.since,
    usd: base.usd + (delta.usd ?? 0),
    input: base.input + delta.usage.input,
    cachedInput: base.cachedInput + delta.usage.cachedInput,
    output: base.output + delta.usage.output,
    unpricedTokens: base.unpricedTokens + unpriced,
    months,
    days,
    profiles,
  };
}

export async function readSpend(api: Browser): Promise<SpendTotals | undefined> {
  const got = await api.storage.local.get(SPEND_KEY);
  return cleanSpend(got[SPEND_KEY]);
}

/** Zeroes the totals (this month too) and re-arms the soft limit: a "Continue anyway" given this month no longer holds. */
export async function resetSpend(api: Browser): Promise<void> {
  await api.storage.local.remove(SPEND_KEY);
  const limit = await readSpendLimit(api);
  if (limit?.continuedFor !== undefined) await api.storage.local.set({ [SPEND_LIMIT_KEY]: { monthlyUsd: limit.monthlyUsd } });
}

// ---- Estimates (M4-E10: "estimated spend per day and month") -----------------------------------

export interface SpendEstimate {
  today: number;
  /** This calendar month so far. */
  month: number;
  /** USD per day on average over this month's days so far (today counted in full). */
  perDay: number;
  /** This month at that rate: what the month will cost if it goes on like this. */
  monthProjected: number;
}

const daysInMonth = (at: number) => {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
};

/** Today, this month and the month's projection, from the stored totals. Pure. */
export function estimateSpend(spend: SpendTotals | undefined, now: number): SpendEstimate {
  const month = spend?.months[monthKey(now)] ?? 0;
  const today = spend?.days[dayKey(now)] ?? 0;
  // Counted from the 1st, or from the reset when that was later this month.
  const first = new Date(now);
  first.setDate(1);
  first.setHours(0, 0, 0, 0);
  const from = Math.max(first.getTime(), spend?.since ?? now);
  const fromDay = new Date(from).getDate();
  const elapsed = Math.max(1, new Date(now).getDate() - (monthKey(from) === monthKey(now) ? fromDay : 1) + 1);
  const perDay = month / elapsed;
  const left = daysInMonth(now) - new Date(now).getDate();
  return { today, month, perDay, monthProjected: month + perDay * left };
}

// ---- The monthly soft limit (M4-E10) ----------------------------------------------------------

export interface SpendLimit {
  /** USD per calendar month. */
  monthlyUsd: number;
  /** "2026-10": the month "Continue anyway" was chosen for; the warning holds off until the next. */
  continuedFor?: string;
}

export function cleanSpendLimit(value: unknown): SpendLimit | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const r = value as Record<string, unknown>;
  if (typeof r.monthlyUsd !== 'number' || !Number.isFinite(r.monthlyUsd) || r.monthlyUsd <= 0) return undefined;
  return { monthlyUsd: r.monthlyUsd, ...(typeof r.continuedFor === 'string' && /^\d{4}-\d{2}$/.test(r.continuedFor) ? { continuedFor: r.continuedFor } : {}) };
}

export async function readSpendLimit(api: Browser): Promise<SpendLimit | undefined> {
  return cleanSpendLimit((await api.storage.local.get(SPEND_LIMIT_KEY))[SPEND_LIMIT_KEY]);
}

/** Sets the limit (a new amount asks again this month), or removes it (undefined). */
export async function saveSpendLimit(api: Browser, monthlyUsd: number | undefined): Promise<void> {
  if (monthlyUsd === undefined) return api.storage.local.remove(SPEND_LIMIT_KEY);
  const clean = cleanSpendLimit({ monthlyUsd });
  if (!clean) throw new Error('The limit must be an amount above $0');
  await api.storage.local.set({ [SPEND_LIMIT_KEY]: clean });
}

/** "Continue anyway": no more warnings until the month changes. */
export async function continuePastLimit(api: Browser, now: number = Date.now()): Promise<void> {
  const limit = await readSpendLimit(api);
  if (!limit) return;
  await api.storage.local.set({ [SPEND_LIMIT_KEY]: { ...limit, continuedFor: monthKey(now) } });
}

/** The limit a new translation must stop for, now; undefined when there is none, it is not reached, or the user went on this month. */
export interface LimitReached {
  limitUsd: number;
  monthUsd: number;
}

export function limitReached(spend: SpendTotals | undefined, limit: SpendLimit | undefined, now: number): LimitReached | undefined {
  if (!limit || limit.continuedFor === monthKey(now)) return undefined;
  const monthUsd = spend?.months[monthKey(now)] ?? 0;
  return monthUsd >= limit.monthlyUsd ? { limitUsd: limit.monthlyUsd, monthUsd } : undefined;
}

/** `limitReached` on the stored records; storage that can't be read never stops a translation. */
export async function checkSpendLimit(api: Browser, now: number = Date.now()): Promise<LimitReached | undefined> {
  try {
    const [spend, limit] = await Promise.all([readSpend(api), readSpendLimit(api)]);
    return limitReached(spend, limit, now);
  } catch {
    return undefined;
  }
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
