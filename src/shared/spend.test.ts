import { describe, expect, it } from 'vitest';
import { addSpend, cleanSpend, monthKey, readSpend, resetSpend, SPEND_KEY, SPEND_MONTHS, SpendLedger } from './spend.ts';

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
