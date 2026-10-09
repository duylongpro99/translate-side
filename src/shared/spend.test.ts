import { describe, expect, it } from 'vitest';
import { addSpend, checkSpendLimit, cleanSpend, cleanSpendLimit, continuePastLimit, dayKey, estimateSpend, limitReached, monthKey, readSpend, readSpendLimit, resetSpend, saveSpendLimit, SPEND_DAYS, SPEND_KEY, SPEND_LIMIT_KEY, SPEND_MONTHS, SpendLedger } from './spend.ts';

type Api = ConstructorParameters<typeof SpendLedger>[0];

function fakeApi() {
  const local = new Map<string, unknown>();
  const api = {
    storage: {
      local: {
        // Slow reads: two adds racing would lose one without the ledger's chain.
        get: (k: string) => new Promise((r) => setTimeout(() => r(local.has(k) ? { [k]: structuredClone(local.get(k)) } : {}), 5)),
        set: (o: Record<string, unknown>) => (Object.entries(o).forEach(([k, v]) => local.set(k, v)), Promise.resolve()),
        remove: (k: string) => (local.delete(k), Promise.resolve()),
      },
    },
  } as unknown as Api;
  return { api, local };
}

const at = Date.UTC(2026, 9, 8, 12);
const use = (input: number, output: number, cachedInput = 0) => ({ input, cachedInput, output });

describe('running total of spend (plan M3-E9)', () => {
  it('adds tokens and USD, per month too; usage without a price counts tokens only', () => {
    let s = addSpend(undefined, { usage: use(1000, 500, 200), usd: 0.01 }, at);
    s = addSpend(s, { usage: use(100, 50), usd: undefined }, at + 1);
    expect(s).toMatchObject({ since: at, usd: 0.01, input: 1100, cachedInput: 200, output: 550, unpricedTokens: 150 });
    expect(s.months).toEqual({ [monthKey(at)]: 0.01 });
  });

  it(`keeps the last ${SPEND_MONTHS} months`, () => {
    let s;
    for (let m = 0; m < 15; m++) s = addSpend(s, { usage: use(1, 1), usd: 1 }, new Date(2025, m, 15).getTime());
    expect(Object.keys(s?.months ?? {})).toHaveLength(SPEND_MONTHS);
    expect(Object.keys(s?.months ?? {})[0]).toBe('2025-04');
    expect(s?.usd).toBe(15);
  });

  it('cleanSpend drops junk and keeps a valid record', () => {
    expect(cleanSpend(null)).toBeUndefined();
    expect(cleanSpend({ usd: -3, input: 'x', months: { bad: 1, '2026-10': 2 } })).toEqual({ since: 0, usd: 0, input: 0, cachedInput: 0, output: 0, unpricedTokens: 0, months: { '2026-10': 2 }, days: {}, profiles: {} });
  });

  it('the ledger persists to storage.local; two adds at once both count; reset clears', async () => {
    const { api, local } = fakeApi();
    const ledger = new SpendLedger(api, () => at);
    void ledger.add({ usage: use(10, 5), usd: 0.5 });
    await ledger.add({ usage: use(20, 5), usd: 0.25 });
    expect(local.get(SPEND_KEY)).toMatchObject({ usd: 0.75, input: 30, output: 10 });
    expect(await readSpend(api)).toMatchObject({ usd: 0.75 });
    await resetSpend(api);
    expect(await readSpend(api)).toBeUndefined();
  });
});

describe('usage per profile and per day, the estimate (plan M4-E10)', () => {
  it('counts each profile apart (unpriced tokens too) and each day; usage without a profile is in the total only', () => {
    let s = addSpend(undefined, { usage: use(1000, 500, 100), usd: 0.02, profileId: 'haiku', model: 'claude-haiku-4-5' }, at);
    s = addSpend(s, { usage: use(800, 400), usd: undefined, profileId: 'ollama-qwen', model: 'qwen3:8b' }, at + 1);
    s = addSpend(s, { usage: use(10, 10), usd: 0.01, profileId: 'haiku' }, at + 86_400_000);
    s = addSpend(s, { usage: use(5, 5), usd: 0.001 }, at + 2);
    expect(s.profiles).toEqual({
      haiku: { model: 'claude-haiku-4-5', usd: 0.03, input: 1010, cachedInput: 100, output: 510, unpricedTokens: 0 },
      'ollama-qwen': { model: 'qwen3:8b', usd: 0, input: 800, cachedInput: 0, output: 400, unpricedTokens: 1200 },
    });
    expect(s.days[dayKey(at)]).toBeCloseTo(0.021, 12);
    expect(s.days[dayKey(at + 86_400_000)]).toBeCloseTo(0.01, 12);
    expect(s.usd).toBeCloseTo(0.031, 12);
    expect(cleanSpend(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it(`keeps the last ${SPEND_DAYS} days`, () => {
    let s;
    for (let d = 0; d < SPEND_DAYS + 5; d++) s = addSpend(s, { usage: use(1, 1), usd: 1 }, new Date(2026, 0, 1 + d, 12).getTime());
    expect(Object.keys(s?.days ?? {})).toHaveLength(SPEND_DAYS);
  });

  it('estimates today, this month and the month at this month’s rate', () => {
    const now = new Date(2026, 9, 10, 15).getTime(); // 10 October: 10 days in, 21 left
    let s = addSpend(undefined, { usage: use(1, 1), usd: 1 }, new Date(2026, 9, 2, 9).getTime());
    s = addSpend(s, { usage: use(1, 1), usd: 1 }, new Date(2026, 9, 10, 9).getTime());
    s = addSpend(s, { usage: use(1, 1), usd: 5 }, new Date(2026, 8, 30, 9).getTime());
    const e = estimateSpend({ ...s, since: new Date(2026, 8, 1).getTime() }, now);
    expect(e.today).toBe(1);
    expect(e.month).toBe(2);
    expect(e.perDay).toBeCloseTo(0.2, 12);
    expect(e.monthProjected).toBeCloseTo(2 + 0.2 * 21, 12);
    // Reset on the 6th: the rate counts from then (5 days), not from the 1st.
    expect(estimateSpend({ ...s, since: new Date(2026, 9, 6, 8).getTime() }, now).perDay).toBeCloseTo(0.4, 12);
    expect(estimateSpend(undefined, now)).toEqual({ today: 0, month: 0, perDay: 0, monthProjected: 0 });
  });
});

describe('the monthly soft limit (plan M4-E10)', () => {
  const month = monthKey(at);
  const spent = (usd: number) => addSpend(undefined, { usage: use(1, 1), usd }, at);

  it('cleanSpendLimit keeps an amount above zero and a well-formed month', () => {
    expect(cleanSpendLimit({ monthlyUsd: 5, continuedFor: '2026-10' })).toEqual({ monthlyUsd: 5, continuedFor: '2026-10' });
    expect(cleanSpendLimit({ monthlyUsd: 5, continuedFor: 'soon' })).toEqual({ monthlyUsd: 5 });
    for (const bad of [null, {}, { monthlyUsd: 0 }, { monthlyUsd: -1 }, { monthlyUsd: 'x' }, { monthlyUsd: Infinity }]) expect(cleanSpendLimit(bad)).toBeUndefined();
  });

  it('is reached at the amount, not before; "Continue anyway" holds for this month only', () => {
    expect(limitReached(spent(4.99), { monthlyUsd: 5 }, at)).toBeUndefined();
    expect(limitReached(spent(5), { monthlyUsd: 5 }, at)).toEqual({ limitUsd: 5, monthUsd: 5 });
    expect(limitReached(spent(9), undefined, at)).toBeUndefined();
    expect(limitReached(spent(9), { monthlyUsd: 5, continuedFor: month }, at)).toBeUndefined();
    expect(limitReached(spent(9), { monthlyUsd: 5, continuedFor: '2026-09' }, at)).toEqual({ limitUsd: 5, monthUsd: 9 });
    // Next month starts at zero.
    expect(limitReached(spent(9), { monthlyUsd: 5 }, new Date(2026, 10, 2).getTime())).toBeUndefined();
  });

  it('stored: save, continue, remove; a reset re-arms the limit; storage that fails never stops', async () => {
    const { api, local } = fakeApi();
    await expect(saveSpendLimit(api, 0)).rejects.toThrow('above $0');
    await saveSpendLimit(api, 2);
    await new SpendLedger(api, () => at).add({ usage: use(1, 1), usd: 3 });
    expect(await checkSpendLimit(api, at)).toEqual({ limitUsd: 2, monthUsd: 3 });
    await continuePastLimit(api, at);
    expect(await readSpendLimit(api)).toEqual({ monthlyUsd: 2, continuedFor: month });
    expect(await checkSpendLimit(api, at)).toBeUndefined();
    await resetSpend(api);
    expect(await readSpendLimit(api)).toEqual({ monthlyUsd: 2 });
    await saveSpendLimit(api, undefined);
    expect(local.has(SPEND_LIMIT_KEY)).toBe(false);
    const broken = { storage: { local: { get: () => Promise.reject(new Error('gone')) } } } as unknown as Api;
    expect(await checkSpendLimit(broken, at)).toBeUndefined();
  });
});
