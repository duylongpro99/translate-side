import { describe, expect, it } from 'vitest';
import { PRICES, costUsd as harnessCost, type Price } from '../../scripts/eval/pricing.ts';
import { costUsd, formatUsd } from './cost.ts';
import { APIBOX_DEEPSEEK_QUIRKS } from '@/llm/presets';
import { checkScript, TARGET_SCRIPTS } from '@/engine/index';
import {
  APIBOX_CONNECTION,
  APIBOX_FLASH_PROFILE,
  APIBOX_PRO_PROFILE,
  APIBOX_QWEN_PROFILE,
  DEFAULT_CONNECTION,
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
  protocolOf,
  saveApiKey,
  saveGlossary,
  savePreferences,
  secretKey,
  syncItemBytes,
  withProfileQuirks,
  DEFAULT_BUDGET_TOKENS,
  MAX_BUDGET_TOKENS,
  cleanBudget,
  defaultPreferences,
  LANGUAGES,
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

  it('defaults to APIBOX with qwen3.8-flash and its per-chunk thinking; v4-pro and flash kept; origin and host from the base URL (M2-D11, M2-D16)', () => {
    expect(DEFAULT_CONNECTION).toBe(APIBOX_CONNECTION);
    expect(DEFAULT_PROFILE).toBe(APIBOX_QWEN_PROFILE);
    expect(APIBOX_CONNECTION).toMatchObject({ protocol: 'openai-chat', baseUrl: 'https://api.ai-box.vn/v1', auth: { style: 'bearer' } });
    expect(APIBOX_CONNECTION.quirks).toEqual({ reasoning: { control: 'effort', lowest: 'off', reserveTokens: 0 } });
    expect(APIBOX_CONNECTION.quirks).toBe(APIBOX_DEEPSEEK_QUIRKS);
    expect(APIBOX_QWEN_PROFILE).toMatchObject({ model: 'qwen3.8-flash', maxConcurrency: 2, connectionId: APIBOX_CONNECTION.id });
    expect(APIBOX_QWEN_PROFILE.quirks).toEqual({
      maxTokensParam: 'max_completion_tokens',
      reasoning: { control: 'effort', lowest: 'off', reserveTokens: 0, byChunk: [{ fromChunk: 1, lowest: 'minimal', reserveTokens: 6000 }] },
    });
    expect(APIBOX_PRO_PROFILE).toMatchObject({ model: 'ds/deepseek-v4-pro', maxConcurrency: 2, connectionId: APIBOX_CONNECTION.id });
    expect(APIBOX_PRO_PROFILE.quirks).toBeUndefined();
    expect(APIBOX_FLASH_PROFILE).toMatchObject({ model: 'ds/deepseek-flash', maxConcurrency: 2, connectionId: APIBOX_CONNECTION.id });
    expect(originPattern(DEFAULT_CONNECTION.baseUrl)).toBe('https://api.ai-box.vn/*');
  });

  it("puts a profile's quirks over the connection's, key by key", () => {
    const conn = { id: 'apibox', protocol: 'openai-chat' as const, baseUrl: APIBOX_CONNECTION.baseUrl, auth: { style: 'bearer' as const }, apiKey: 'k', quirks: { ...APIBOX_DEEPSEEK_QUIRKS, supportsJsonMode: true }, hasHostPermission: async () => true };
    const qwen = withProfileQuirks(conn, APIBOX_QWEN_PROFILE);
    expect(qwen.quirks).toEqual({ supportsJsonMode: true, maxTokensParam: 'max_completion_tokens', reasoning: APIBOX_QWEN_PROFILE.quirks?.reasoning });
    expect(conn.quirks.reasoning).toBe(APIBOX_DEEPSEEK_QUIRKS.reasoning);
    expect(withProfileQuirks(conn, APIBOX_PRO_PROFILE)).toBe(conn);
  });

  it("prices each profile exactly as the harness does (scripts/eval/pricing.ts)", () => {
    const u = { input: 3340, cachedInput: 1000, output: 2868 };
    for (const profile of [GEMINI_PROFILE, APIBOX_FLASH_PROFILE, APIBOX_PRO_PROFILE, APIBOX_QWEN_PROFILE]) {
      const p = PRICES[profile.model];
      expect(p).toBeDefined();
      expect(profile.pricing).toEqual({ inPerM: p?.input, cachedInPerM: p?.cachedInput, outPerM: p?.output });
      expect(costUsd(profile.pricing, u)).toBeCloseTo(harnessCost(p as Price, u), 15);
    }
    expect(costUsd(undefined, u)).toBeUndefined();
  });

  it('picks the protocol: the profile override, else the connection, else the detected one for auto', () => {
    expect(protocolOf(APIBOX_CONNECTION)).toBe('openai-chat');
    expect(protocolOf(APIBOX_CONNECTION, { ...APIBOX_QWEN_PROFILE, protocolOverride: 'anthropic-messages' })).toBe('anthropic-messages');
    expect(protocolOf({ ...APIBOX_CONNECTION, protocol: 'auto' })).toBeUndefined();
    expect(protocolOf({ ...APIBOX_CONNECTION, protocol: 'auto', detectedProtocols: ['anthropic-messages', 'openai-chat'] })).toBe('anthropic-messages');
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
    // Extra headers and query parameters ride along; an auto connection with nothing detected can't resolve.
    const extra = await resolveConnection(api, { ...GEMINI_CONNECTION, extraHeaders: { 'X-Org': 'a' }, queryParams: { v: '1' } });
    expect(extra).toMatchObject({ extraHeaders: { 'X-Org': 'a' }, queryParams: { v: '1' } });
    await expect(resolveConnection(api, { ...GEMINI_CONNECTION, protocol: 'auto' })).rejects.toThrow(/no protocol/);
  });

  it('defaults the target to the browser language and the source to auto; a saved override is read back', async () => {
    const { api, sync } = fakeApi({ ui: 'vi-VN' });
    expect(await readPreferences(api)).toEqual({ targetLang: 'vi', sourceLang: 'auto', style: 'natural', gloss: 'first', budgetTokens: 400000 });
    await savePreferences(api, { targetLang: 'ja', sourceLang: 'de', style: 'simplified', gloss: 'off', budgetTokens: 400000 });
    expect(sync.data).toEqual({ prefs: { targetLang: 'ja', sourceLang: 'de', style: 'simplified', gloss: 'off', budgetTokens: 400000 } });
    expect(await readPreferences(api)).toEqual({ targetLang: 'ja', sourceLang: 'de', style: 'simplified', gloss: 'off', budgetTokens: 400000 });
  });

  it('reads M1-era prefs (no style or gloss) and unknown values as the defaults: Natural, gloss on first use (M2-D1)', async () => {
    const { api, sync } = fakeApi({ ui: 'vi-VN' });
    await sync.set({ prefs: { targetLang: 'de', sourceLang: 'auto' } });
    expect(await readPreferences(api)).toEqual({ targetLang: 'de', sourceLang: 'auto', style: 'natural', gloss: 'first', budgetTokens: 400000 });
    await sync.set({ prefs: { targetLang: 'de', sourceLang: 'auto', style: 'poetic', gloss: 'always', budgetTokens: 400000 } });
    expect(await readPreferences(api)).toMatchObject({ style: 'natural', gloss: 'first' });
  });

  it('formats the cost readout', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.00727)).toBe('$0.0073');
    expect(formatUsd(0.00001)).toBe('<$0.0001');
    expect(formatUsd(1.234)).toBe('$1.23');
  });
});

describe('token budget per page (plan M2-E7)', () => {
  it('defaults to DEFAULT_BUDGET_TOKENS; keeps whole numbers within 0…MAX_BUDGET_TOKENS; anything else is the default', () => {
    expect(defaultPreferences().budgetTokens).toBe(DEFAULT_BUDGET_TOKENS);
    expect(cleanBudget(0)).toBe(0);
    expect(cleanBudget(1234.6)).toBe(1235);
    expect(cleanBudget(MAX_BUDGET_TOKENS * 2)).toBe(MAX_BUDGET_TOKENS);
    for (const bad of [-1, Number.NaN, Infinity, '5000', undefined, null]) expect(cleanBudget(bad)).toBe(DEFAULT_BUDGET_TOKENS);
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

describe('LANGUAGES against the wrong-script check (review D-N6)', () => {
  /** A correct sentence in each target's own script; Latin-script targets with their diacritics. */
  const SAMPLES: Record<string, string> = {
    en: 'The futures are lazy.',
    vi: 'Các future được đánh giá lười.',
    'zh-CN': '这些 future 是惰性的。',
    'zh-TW': '這些 future 是惰性的。',
    ja: 'これらのフューチャーは遅延評価です。',
    ko: '이 퓨처들은 게으릅니다(遅延).',
    fr: 'Les futures sont paresseuses, ça marche.',
    de: 'Futures sind träge; Größe zählt.',
    es: 'Los futures son perezosos, señor.',
    'pt-BR': 'Os futures são preguiçosos, então.',
    it: 'I future sono pigri, più o meno.',
    ru: 'Футуры ленивы.',
    uk: 'Ф\u2019ючерси ліниві, ґанок.',
    pl: 'Futures są leniwe, zażółć gęślą jaźń.',
    nl: 'Futures zijn lui, één keer.',
    tr: 'Future\u2019lar tembeldir, İstanbul\u2019da.',
    ar: 'العقود الآجلة كسولة.',
    hi: 'फ्यूचर्स आलसी होते हैं।',
    id: 'Future bersifat malas.',
    th: 'ฟิวเจอร์เป็นแบบขี้เกียจ',
  };

  it('has a sample for every language of the list, and never flags a correct translation into it', () => {
    expect(LANGUAGES.map((l) => l.code).sort()).toEqual(Object.keys(SAMPLES).sort());
    for (const { code } of LANGUAGES) expect([code, checkScript('The futures are lazy.', SAMPLES[code] ?? '', code)]).toEqual([code, undefined]);
  });

  it('knows the script of every non-Latin target', () => {
    for (const code of ['zh-CN', 'zh-TW', 'ja', 'ko', 'ru', 'uk', 'ar', 'hi', 'th']) expect([code, TARGET_SCRIPTS[code.split('-')[0] ?? '']]).not.toEqual([code, undefined]);
  });
});
