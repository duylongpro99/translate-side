import { describe, expect, it } from 'vitest';
import { PRICES, costUsd as harnessCost, type Price } from '../../scripts/eval/pricing.ts';
import { costUsd, formatUsd } from './cost.ts';
import {
  GEMINI_CONNECTION,
  GEMINI_ORIGIN,
  GEMINI_PROFILE,
  maskKey,
  originPattern,
  readApiKey,
  readPreferences,
  removeApiKey,
  resolveConnection,
  resolveProfile,
  saveApiKey,
  savePreferences,
  secretKey,
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

  it("prices the profile exactly as the harness does (scripts/eval/pricing.ts)", () => {
    const p = PRICES[GEMINI_PROFILE.model];
    expect(p).toBeDefined();
    expect(GEMINI_PROFILE.pricing).toEqual({ inPerM: p?.input, cachedInPerM: p?.cachedInput, outPerM: p?.output });
    const u = { input: 3340, cachedInput: 1000, output: 2868 };
    expect(costUsd(GEMINI_PROFILE.pricing, u)).toBeCloseTo(harnessCost(p as Price, u), 15);
    expect(costUsd(undefined, u)).toBeUndefined();
  });

  it('routes translate, and analyze to the translate profile (stub)', () => {
    expect(resolveProfile('translate').profile).toBe(GEMINI_PROFILE);
    // §4.3.1: an unset analyze route defaults to translate.
    expect(resolveProfile('analyze').profile).toBe(GEMINI_PROFILE);
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
    expect(await readPreferences(api)).toEqual({ targetLang: 'vi', sourceLang: 'auto' });
    await savePreferences(api, { targetLang: 'ja', sourceLang: 'de' });
    expect(sync.data).toEqual({ prefs: { targetLang: 'ja', sourceLang: 'de' } });
    expect(await readPreferences(api)).toEqual({ targetLang: 'ja', sourceLang: 'de' });
  });

  it('formats the cost readout', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.00727)).toBe('$0.0073');
    expect(formatUsd(0.00001)).toBe('<$0.0001');
    expect(formatUsd(1.234)).toBe('$1.23');
  });
});
