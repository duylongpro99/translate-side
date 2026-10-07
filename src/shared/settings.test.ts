import { describe, expect, it } from 'vitest';
import { PRICES, costUsd as harnessCost, type Price } from '../../scripts/eval/pricing.ts';
import { costUsd, formatUsd } from './cost.ts';
import { APIBOX_DEEPSEEK_QUIRKS } from '@/llm/presets';
import {
  APIBOX_CONNECTION,
  APIBOX_FLASH_PROFILE,
  APIBOX_PRO_PROFILE,
  DEFAULT_CONNECTION,
  DEFAULT_HOST,
  DEFAULT_ORIGIN,
  DEFAULT_PROFILE,
  GEMINI_CONNECTION,
  GEMINI_ORIGIN,
  GEMINI_PROFILE,
  GLOSSARY_KEY,
  SYNC_QUOTA_BYTES,
  SYNC_QUOTA_BYTES_PER_ITEM,
  cleanGlossary,
  maskKey,
  originPattern,
  readApiKey,
  readGlossary,
  readPreferences,
  removeApiKey,
  resolveConnection,
  resolveProfile,
  saveApiKey,
  saveGlossary,
  savePreferences,
  secretKey,
  syncItemBytes,
} from './settings.ts';

type Api = Parameters<typeof readApiKey>[0];

function fakeApi({ granted = [] as string[], ui = 'vi-VN' } = {}) {
  const area = () => {
    const data = new Map<string, unknown>();
    return {
      get data() {
        return Object.fromEntries(data);
      },
      get: (k: string) => Promise.resolve(data.has(k) ? { [k]: structuredClone(data.get(k)) } : {}),
      set: (o: Record<string, unknown>) => Promise.resolve(void Object.entries(structuredClone(o)).forEach(([k, v]) => data.set(k, v))),
      remove: (k: string) => Promise.resolve(void data.delete(k)),
    };
  };
  const local = area();
  const sync = area();
  const api = {
    storage: { local, sync },
    permissions: { contains: ({ origins }: { origins: string[] }) => Promise.resolve(origins.every((o) => granted.includes(o))) },
    i18n: { getUILanguage: () => ui },
  } as unknown as Api;
  return { api, local, sync };
}

describe('settings v0 (plan M1-E9, decision M1-D13)', () => {
  it('hard-wires one Gemini connection on the openai-chat adapter with bearer auth', () => {
    expect(GEMINI_CONNECTION).toMatchObject({ protocol: 'openai-chat', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', auth: { style: 'bearer' } });
    expect(GEMINI_PROFILE).toMatchObject({ model: 'gemini-3.5-flash-lite', maxConcurrency: 2, connectionId: GEMINI_CONNECTION.id });
    expect(originPattern(GEMINI_CONNECTION.baseUrl)).toBe(GEMINI_ORIGIN);
  });

  it('defaults to APIBOX with ds/deepseek-v4-pro, thinking off, flash kept; origin and host come from the base URL (M2-D11, M2-D14)', () => {
    expect(DEFAULT_CONNECTION).toBe(APIBOX_CONNECTION);
    expect(DEFAULT_PROFILE).toBe(APIBOX_PRO_PROFILE);
    expect(APIBOX_CONNECTION).toMatchObject({ protocol: 'openai-chat', baseUrl: 'https://api.ai-box.vn/v1', auth: { style: 'bearer' } });
    expect(APIBOX_CONNECTION.quirks).toEqual({ reasoning: { control: 'effort', lowest: 'off', reserveTokens: 0 } });
    expect(APIBOX_CONNECTION.quirks).toBe(APIBOX_DEEPSEEK_QUIRKS);
    expect(APIBOX_PRO_PROFILE).toMatchObject({ model: 'ds/deepseek-v4-pro', maxConcurrency: 2, connectionId: APIBOX_CONNECTION.id });
    expect(APIBOX_FLASH_PROFILE).toMatchObject({ model: 'ds/deepseek-flash', maxConcurrency: 2, connectionId: APIBOX_CONNECTION.id });
    expect(DEFAULT_ORIGIN).toBe('https://api.ai-box.vn/*');
    expect(DEFAULT_HOST).toBe('api.ai-box.vn');
  });

  it("prices each profile exactly as the harness does (scripts/eval/pricing.ts)", () => {
    const u = { input: 3340, cachedInput: 1000, output: 2868 };
    for (const profile of [GEMINI_PROFILE, APIBOX_FLASH_PROFILE, APIBOX_PRO_PROFILE]) {
      const p = PRICES[profile.model];
      expect(p).toBeDefined();
      expect(profile.pricing).toEqual({ inPerM: p?.input, cachedInPerM: p?.cachedInput, outPerM: p?.output });
      expect(costUsd(profile.pricing, u)).toBeCloseTo(harnessCost(p as Price, u), 15);
    }
    expect(costUsd(undefined, u)).toBeUndefined();
  });

  it('routes translate, and analyze to the translate profile (stub)', () => {
    expect(resolveProfile('translate')).toEqual({ profile: APIBOX_PRO_PROFILE, connection: APIBOX_CONNECTION });
    // §4.3.1: an unset analyze route defaults to translate.
    expect(resolveProfile('analyze').profile).toBe(APIBOX_PRO_PROFILE);
    expect(() => resolveProfile('review')).toThrow(/review/);
  });

  it('stores the key trimmed in storage.local under secret:<connectionId>, never in sync', async () => {
    const { api, local, sync } = fakeApi();
    await saveApiKey(api, 'gemini', '  AIzaSyExampleKey1234  ');
    expect(local.data).toEqual({ 'secret:gemini': 'AIzaSyExampleKey1234' });
    expect(sync.data).toEqual({});
    expect(secretKey('gemini')).toBe('secret:gemini');
    expect(await readApiKey(api, 'gemini')).toBe('AIzaSyExampleKey1234');
    await removeApiKey(api, 'gemini');
    expect(await readApiKey(api, 'gemini')).toBeUndefined();
  });

  it('masks a saved key as prefix…last4 and shows nothing of a short one', () => {
    expect(maskKey('sk-ant-0123456789abcd')).toBe('sk-…abcd');
    expect(maskKey('AIzaSyExampleKey1234')).toBe('AIz…1234');
    expect(maskKey('short')).toBe('••••');
  });

  it('resolves the connection with the key and a host-permission port for the Gemini origin', async () => {
    const none = fakeApi();
    expect(await resolveConnection(none.api, GEMINI_CONNECTION)).toBeNull();
    const { api } = fakeApi({ granted: [GEMINI_ORIGIN] });
    await saveApiKey(api, GEMINI_CONNECTION.id, 'AIzaSyExampleKey1234');
    const conn = await resolveConnection(api, GEMINI_CONNECTION);
    expect(conn).toMatchObject({ protocol: 'openai-chat', apiKey: 'AIzaSyExampleKey1234', auth: { style: 'bearer' } });
    expect(await conn?.hasHostPermission()).toBe(true);
    // Quirks are a copy: the adapter flips them in place.
    expect(conn?.quirks).not.toBe(GEMINI_CONNECTION.quirks);
  });

  it('defaults the target to the browser language and the source to auto; a saved override is read back', async () => {
    const { api, sync } = fakeApi({ ui: 'vi-VN' });
    expect(await readPreferences(api)).toEqual({ targetLang: 'vi', sourceLang: 'auto', style: 'natural', gloss: 'first' });
    await savePreferences(api, { targetLang: 'ja', sourceLang: 'de', style: 'simplified', gloss: 'off' });
    expect(sync.data).toEqual({ prefs: { targetLang: 'ja', sourceLang: 'de', style: 'simplified', gloss: 'off' } });
    expect(await readPreferences(api)).toEqual({ targetLang: 'ja', sourceLang: 'de', style: 'simplified', gloss: 'off' });
  });

  it('reads M1-era prefs (no style or gloss) and unknown values as the defaults: Natural, gloss on first use (M2-D1)', async () => {
    const { api, sync } = fakeApi({ ui: 'vi-VN' });
    await sync.set({ prefs: { targetLang: 'de', sourceLang: 'auto' } });
    expect(await readPreferences(api)).toEqual({ targetLang: 'de', sourceLang: 'auto', style: 'natural', gloss: 'first' });
    await sync.set({ prefs: { targetLang: 'de', sourceLang: 'auto', style: 'poetic', gloss: 'always' } });
    expect(await readPreferences(api)).toMatchObject({ style: 'natural', gloss: 'first' });
  });

  it('formats the cost readout', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.00727)).toBe('$0.0073');
    expect(formatUsd(0.00001)).toBe('<$0.0001');
    expect(formatUsd(1.234)).toBe('$1.23');
  });
});

describe('personal glossary (plan M2-E6): storage.sync with a quota guard', () => {
  const withBytes = (inUse: number) => {
    const f = fakeApi();
    const sync = f.api.storage.sync as unknown as Record<string, unknown>;
    sync.getBytesInUse = (keys: string | null) => Promise.resolve(keys === null ? inUse : syncItemBytes(GLOSSARY_KEY, f.sync.data[GLOSSARY_KEY] ?? []));
    return f;
  };

  it('saves to the sync key "glossary" and reads it back, trimmed; "keep as is" is a rendering equal to the term', async () => {
    const { api, sync } = fakeApi();
    expect(await readGlossary(api)).toEqual([]);
    const saved = await saveGlossary(api, [{ term: ' deploy ', rendering: '' }, { term: 'executor', rendering: ' bộ thực thi ', note: ' core ' }]);
    expect(saved).toMatchObject({ ok: true, entries: [{ term: 'deploy', rendering: 'deploy' }, { term: 'executor', rendering: 'bộ thực thi', note: 'core' }] });
    expect(sync.data).toEqual({ glossary: [{ term: 'deploy', rendering: 'deploy' }, { term: 'executor', rendering: 'bộ thực thi', note: 'core' }] });
    expect(await readGlossary(api)).toEqual(sync.data.glossary);
  });

  it('drops blank and repeated terms (case-insensitive) and ignores junk in storage', async () => {
    expect(cleanGlossary([{ term: '', rendering: 'x' }, { term: 'A', rendering: '1' }, { term: 'a', rendering: '2' }, null, 'x', { term: 3 }])).toEqual([{ term: 'A', rendering: '1' }]);
    const { api, sync } = fakeApi();
    await sync.set({ glossary: 'not a list' });
    expect(await readGlossary(api)).toEqual([]);
  });

  it('counts bytes as Chrome does: key + JSON, UTF-8', () => {
    expect(syncItemBytes('k', 'é')).toBe(1 + 4);
    expect(SYNC_QUOTA_BYTES_PER_ITEM).toBe(8192);
    expect(SYNC_QUOTA_BYTES).toBe(102400);
  });

  it('refuses, without writing, a glossary over the per-item quota, and warns from 80%', async () => {
    const { api, sync } = fakeApi();
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ term: `term-${i}`, rendering: `rendering number ${i} with some text` }));
    const tooBig = await saveGlossary(api, many(400));
    expect(tooBig).toMatchObject({ ok: false, reason: 'item-quota' });
    expect(sync.data).toEqual({});
    let n = 1;
    while (syncItemBytes(GLOSSARY_KEY, cleanGlossary(many(n + 1))) < SYNC_QUOTA_BYTES_PER_ITEM * 0.85) n++;
    const near = await saveGlossary(api, many(n));
    expect(near).toMatchObject({ ok: true });
    expect(near.ok && near.warning).toMatch(/uses 8\d% of the space/);
    const small = await saveGlossary(api, many(2));
    expect(small.ok && small.warning).toBeUndefined();
  });

  it('refuses a save that would push synced settings over the total quota', async () => {
    const { api, sync } = withBytes(SYNC_QUOTA_BYTES - 50);
    const got = await saveGlossary(api, [{ term: 'a fairly long glossary term', rendering: 'and an even longer rendering for it, to pass fifty bytes' }]);
    expect(got).toMatchObject({ ok: false, reason: 'total-quota' });
    expect(sync.data).toEqual({});
    const fine = withBytes(1000);
    expect(await saveGlossary(fine.api, [{ term: 'deploy', rendering: 'deploy' }])).toMatchObject({ ok: true });
  });

  it('reports a storage error instead of throwing', async () => {
    const { api } = fakeApi();
    (api.storage.sync as unknown as Record<string, unknown>).set = () => Promise.reject(new Error('QUOTA_BYTES_PER_ITEM quota exceeded'));
    expect(await saveGlossary(api, [{ term: 'x', rendering: 'x' }])).toEqual({ ok: false, reason: 'error', message: 'QUOTA_BYTES_PER_ITEM quota exceeded' });
  });
});
