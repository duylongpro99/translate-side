import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetch, openaiStream, type ScriptedResponse } from '@/llm/testing';
import type { NormalizedEvent } from '@/llm/types';
import { translateClient } from '@/entrypoints/sidepanel/route';
import {
  cleanConnection,
  cleanProfile,
  cleanRouting,
  cleanSiteRules,
  clearTabOverride,
  isProviderKey,
  matchesSite,
  migrateProviders,
  parseStored,
  readProviderSettings,
  readTabOverride,
  resolveRoute,
  resolveRouteIn,
  saveConnection,
  saveLearnedQuirk,
  saveProfile,
  saveRouting,
  SCHEMA_VERSION,
  seedFromM1,
  setTabOverride,
  toSyncItems,
  type ProviderSettings,
} from './providers.ts';
import {
  ANTHROPIC_CONNECTION,
  ANTHROPIC_HAIKU_PROFILE,
  APIBOX_CONNECTION,
  APIBOX_FLASH_PROFILE,
  APIBOX_PRO_PROFILE,
  APIBOX_QWEN_PROFILE,
  DEFAULT_PROFILE,
  GEMINI_CONNECTION,
  GEMINI_PROFILE,
  SYNC_QUOTA_BYTES_PER_ITEM,
  type ModelProfile,
  type ProviderConnection,
} from './settings.ts';

type Api = Parameters<typeof migrateProviders>[0];

/** chrome.storage areas as Chrome answers them: get(null) is everything, get(key | keys) a subset. */
function area(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(structuredClone(initial)));
  const sets: string[][] = [];
  let failSet = false;
  return {
    data,
    sets,
    failNextSets(on = true) {
      failSet = on;
    },
    get(keys: string | string[] | null) {
      if (keys === null) return Promise.resolve(structuredClone(Object.fromEntries(data)));
      const list = typeof keys === 'string' ? [keys] : keys;
      return Promise.resolve(structuredClone(Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, data.get(k)]))));
    },
    set(items: Record<string, unknown>) {
      if (failSet) return Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
      sets.push(Object.keys(items));
      for (const [k, v] of Object.entries(structuredClone(items))) data.set(k, v);
      return Promise.resolve();
    },
    remove(keys: string | string[]) {
      for (const k of typeof keys === 'string' ? [keys] : keys) data.delete(k);
      return Promise.resolve();
    },
    /** As chrome.storage.sync counts it: key plus JSON value, in UTF-8. */
    getBytesInUse(keys: string | string[] | null) {
      const list = keys === null ? [...data.keys()] : typeof keys === 'string' ? [keys] : keys;
      return Promise.resolve(list.filter((k) => data.has(k)).reduce((n, k) => n + new TextEncoder().encode(k + JSON.stringify(data.get(k))).length, 0));
    },
  };
}

function fakeApi({ sync = {}, local = {}, granted = [] as string[] }: { sync?: Record<string, unknown>; local?: Record<string, unknown>; granted?: string[] } = {}) {
  const s = area(sync);
  const l = area(local);
  const session = area();
  const api = {
    storage: { sync: s, local: l, session },
    permissions: { contains: ({ origins }: { origins: string[] }) => Promise.resolve(origins.every((o) => granted.includes(o))) },
  } as unknown as Api;
  return { api, sync: s, local: l, session };
}

/** What M1 left in storage (commit 0ad81dc ff.): prefs and glossary in sync, the Gemini key in local. */
const M1_SYNC = {
  prefs: { targetLang: 'vi', sourceLang: 'auto' },
  glossary: [{ term: 'LLM', rendering: 'LLM' }],
};
const M1_LOCAL = { 'secret:gemini': 'AIzaSyExampleKey1234', privacyNotice: { version: 1, at: 1 } };
/** M2/M3: the APIBOX key (M2-D11), budget and style in prefs. */
const M3_SYNC = { prefs: { targetLang: 'vi', sourceLang: 'auto', style: 'natural', gloss: 'first', budgetTokens: 400000 } };
const M3_LOCAL = { 'secret:apibox': 'sk-apibox-0123456789', spend: { usd: 0.01 } };

const settings = (over: Partial<ProviderSettings> = {}): ProviderSettings => ({
  schemaVersion: SCHEMA_VERSION,
  connections: [structuredClone(APIBOX_CONNECTION), structuredClone(GEMINI_CONNECTION)],
  profiles: [structuredClone(APIBOX_QWEN_PROFILE), structuredClone(APIBOX_PRO_PROFILE), structuredClone(GEMINI_PROFILE)],
  routing: { translate: APIBOX_QWEN_PROFILE.id },
  ...over,
});

describe('schema (plan M4-E2)', () => {
  it('keeps a stored connection and profile as they are, and drops what a request could not use', () => {
    expect(cleanConnection(APIBOX_CONNECTION)).toEqual(APIBOX_CONNECTION);
    expect(cleanProfile(APIBOX_QWEN_PROFILE)).toEqual(APIBOX_QWEN_PROFILE);
    expect(cleanConnection({ ...APIBOX_CONNECTION, protocol: 'grpc' })).toBeNull();
    expect(cleanConnection({ ...APIBOX_CONNECTION, auth: { style: 'cookie' } })).toBeNull();
    expect(cleanConnection({ ...APIBOX_CONNECTION, id: '' })).toBeNull();
    expect(cleanProfile({ ...APIBOX_QWEN_PROFILE, model: '' })).toBeNull();
    expect(cleanProfile('x')).toBeNull();
  });

  it('fills defaults and the §4.3.1 optional fields; unknown fields are dropped', () => {
    const c = cleanConnection({ id: 'c', protocol: 'auto', baseUrl: 'https://gw.example', auth: { style: 'custom-header', headerName: 'X-Key' }, extraHeaders: { 'X-Org': 'a', bad: 3 }, detectedProtocols: ['openai-chat', 'auto', 'x'], junk: 1 });
    expect(c).toEqual({ id: 'c', label: 'c', presetId: 'custom', protocol: 'auto', baseUrl: 'https://gw.example', auth: { style: 'custom-header', headerName: 'X-Key' }, extraHeaders: { 'X-Org': 'a' }, quirks: {}, detectedProtocols: ['openai-chat'], status: 'unverified' });
    const p = cleanProfile({ id: 'p', connectionId: 'c', model: 'qwen3:8b', maxConcurrency: 0, chunkTokens: 'big', pricing: { inPerM: 1, outPerM: 2 }, protocolOverride: 'auto' });
    expect(p).toEqual({ id: 'p', connectionId: 'c', model: 'qwen3:8b', maxConcurrency: 2, chunkTokens: 1200, pricing: { inPerM: 1, cachedInPerM: 1, outPerM: 2 } });
  });

  it('routing needs translate; fallback keeps unknown ids (M5 adds a terminal "basic"); site rules are trimmed hosts', () => {
    expect(cleanRouting({ analyze: 'a' })).toBeNull();
    expect(cleanRouting({ translate: 't', analyze: '', review: 'r', fallback: ['p2', 3, 'basic'] })).toEqual({ translate: 't', review: 'r', fallback: ['p2', 'basic'] });
    expect(cleanSiteRules([{ pattern: ' *.Corp.Example.com ', translate: 'local', localOnly: true }, { pattern: '', translate: 'x' }, { pattern: 'a.com' }, { pattern: 'b.com', translate: 'p', localOnly: 'yes' }])).toEqual([
      { pattern: '*.corp.example.com', translate: 'local', localOnly: true },
      { pattern: 'b.com', translate: 'p' },
    ]);
  });

  it('round-trips through sync items: one item per record, routing and site rules apart, the version with them', () => {
    const s = settings({ routing: { translate: 'apibox-qwen3.8-flash', fallback: ['gemini-flash-lite'], siteOverrides: [{ pattern: 'x.com', translate: 'gemini-flash-lite', localOnly: true }] } });
    const items = toSyncItems(s);
    expect(Object.keys(items).sort()).toEqual(['conn:apibox', 'conn:gemini', 'profile:apibox-deepseek-v4-pro', 'profile:apibox-qwen3.8-flash', 'profile:gemini-flash-lite', 'routing', 'schemaVersion', 'siteRules']);
    expect(items.routing).toEqual({ translate: 'apibox-qwen3.8-flash', fallback: ['gemini-flash-lite'] });
    expect(parseStored({ ...items, prefs: {}, glossary: [] })).toEqual(s);
    expect(parseStored({ prefs: {} })).toBeNull();
    // A record under the wrong key is not trusted.
    // (Nothing trusted left: the built-in default applies, not the misfiled record.)
    expect(parseStored({ schemaVersion: 1, 'conn:other': { ...APIBOX_CONNECTION, label: 'Misfiled' }, routing: { translate: 'p' } })?.connections.map((c) => c.label)).toEqual(['APIBOX']);
    expect(Object.keys(items).every(isProviderKey)).toBe(true);
    expect(isProviderKey('prefs') || isProviderKey('glossary') || isProviderKey('secret:apibox')).toBe(false);
  });

  it('keeps each item well under the sync per-item quota (plan M4 §8)', () => {
    for (const [k, v] of Object.entries(toSyncItems(settings()))) expect(new TextEncoder().encode(k + JSON.stringify(v)).length).toBeLessThan(SYNC_QUOTA_BYTES_PER_ITEM / 8);
  });
});

describe('migration from M1–M3 storage (plan M4 §3 #7)', () => {
  it('an M1 user (Gemini key only) keeps their key and translates with Gemini, nothing re-entered', async () => {
    const f = fakeApi({ sync: M1_SYNC, local: M1_LOCAL });
    const s = await migrateProviders(f.api);
    expect(s.connections.map((c) => c.id)).toEqual(['gemini']);
    expect(s.profiles.map((p) => p.id)).toEqual([GEMINI_PROFILE.id]);
    expect(s.routing).toEqual({ translate: GEMINI_PROFILE.id });
    // Stored: the version, this device's keyed records and the derived route — never `routing`.
    expect([...f.sync.data.keys()].sort()).toEqual(['conn:gemini', 'glossary', 'migratedRoute', 'prefs', 'profile:gemini-flash-lite', 'schemaVersion']);
    expect(f.sync.data.get('migratedRoute')).toEqual({ translate: GEMINI_PROFILE.id });
    expect(f.sync.data.get('conn:gemini')).toEqual(GEMINI_CONNECTION);
    expect(f.sync.data.get('prefs')).toEqual(M1_SYNC.prefs);
    expect(f.sync.data.get('glossary')).toEqual(M1_SYNC.glossary);
    expect(JSON.stringify(Object.fromEntries(f.sync.data))).not.toContain('AIzaSy');
    expect(Object.fromEntries(f.local.data)).toEqual(M1_LOCAL);
    const route = await resolveRoute(f.api, 'translate');
    expect(route).toMatchObject({ ok: true, profile: GEMINI_PROFILE, connection: GEMINI_CONNECTION, source: 'routing' });
  });

  it('an M2/M3 user (APIBOX key) sees the same connection and model as before', async () => {
    const f = fakeApi({ sync: M3_SYNC, local: M3_LOCAL });
    const s = await migrateProviders(f.api);
    expect(s.connections).toEqual([APIBOX_CONNECTION]);
    expect(s.routing).toEqual({ translate: DEFAULT_PROFILE.id });
    expect(f.sync.data.has('routing') || f.sync.data.has('migratedRoute')).toBe(false);
    expect(await resolveRoute(f.api, 'translate')).toMatchObject({ ok: true, profile: APIBOX_QWEN_PROFILE, connection: APIBOX_CONNECTION });
  });

  it('a user with both keys stays on the default; Anthropic is seeded only with its key', async () => {
    const both = await seedFromM1(fakeApi({ local: { ...M1_LOCAL, ...M3_LOCAL } }).api);
    expect(Object.keys(both).filter((k) => k.startsWith('conn:'))).toEqual(['conn:apibox', 'conn:gemini']);
    expect(both).not.toHaveProperty('migratedRoute');
    const anthropic = await seedFromM1(fakeApi({ local: { 'secret:anthropic': 'sk-ant-0123456789abcd' } }).api);
    expect(Object.keys(anthropic).sort()).toEqual(['conn:anthropic', 'migratedRoute', `profile:${ANTHROPIC_HAIKU_PROFILE.id}`, 'schemaVersion']);
    expect(anthropic.migratedRoute).toEqual({ translate: ANTHROPIC_HAIKU_PROFILE.id });
    expect(parseStored(anthropic)?.connections).toEqual([ANTHROPIC_CONNECTION]);
  });

  it('a fresh install writes only the version; the default connection and route apply at read time', async () => {
    const f = fakeApi();
    const s = await migrateProviders(f.api);
    expect([...f.sync.data.keys()]).toEqual(['schemaVersion']);
    expect(s.connections).toEqual([APIBOX_CONNECTION]);
    expect(s.profiles.map((p) => p.id)).toEqual([APIBOX_QWEN_PROFILE.id, APIBOX_PRO_PROFILE.id, APIBOX_FLASH_PROFILE.id]);
    expect(s.routing).toEqual({ translate: DEFAULT_PROFILE.id });
  });

  it("a fresh device that migrates before sync has pulled never overwrites the user's routing (review B-4)", async () => {
    // Device A: the user's own routing, site rules and records.
    const a = fakeApi({ local: M3_LOCAL });
    await migrateProviders(a.api);
    await saveConnection(a.api, GEMINI_CONNECTION);
    await saveProfile(a.api, GEMINI_PROFILE);
    await saveRouting(a.api, { translate: GEMINI_PROFILE.id, siteOverrides: [{ pattern: 'x.com', translate: DEFAULT_PROFILE.id }] });
    // Device B: fresh, even with an M1 Gemini key; it migrates first, then sync merges item by
    // item, last write wins — in either order.
    for (const bFirst of [true, false]) {
      const b = fakeApi({ local: M1_LOCAL });
      if (!bFirst) for (const [k, v] of a.sync.data) b.sync.data.set(k, structuredClone(v));
      await migrateProviders(b.api);
      expect(b.sync.sets.flat()).not.toContain('routing');
      expect(b.sync.sets.flat()).not.toContain('siteRules');
      if (bFirst) for (const [k, v] of a.sync.data) b.sync.data.set(k, structuredClone(v));
      const s = await readProviderSettings(b.api);
      expect(s.routing).toEqual({ translate: GEMINI_PROFILE.id, siteOverrides: [{ pattern: 'x.com', translate: DEFAULT_PROFILE.id }] });
    }
    // A user routing beats a migrated route on the same device too.
    const c = fakeApi({ local: M1_LOCAL });
    await migrateProviders(c.api);
    await saveRouting(c.api, { translate: DEFAULT_PROFILE.id });
    expect((await readProviderSettings(c.api)).routing.translate).toBe(DEFAULT_PROFILE.id);
  });

  it('is idempotent: a second run reads, writes nothing and returns the same settings', async () => {
    const f = fakeApi({ sync: M1_SYNC, local: M1_LOCAL });
    const first = await migrateProviders(f.api);
    const snapshot = structuredClone(Object.fromEntries(f.sync.data));
    expect(f.sync.sets).toHaveLength(1);
    const second = await migrateProviders(f.api);
    expect(second).toEqual(first);
    expect(f.sync.sets).toHaveLength(1);
    expect(Object.fromEntries(f.sync.data)).toEqual(snapshot);
    // A key added after the migration changes nothing: the migrated route stays.
    await f.local.set({ 'secret:apibox': 'sk-later-0123456789' });
    expect((await readProviderSettings(f.api)).routing.translate).toBe(GEMINI_PROFILE.id);
    expect(f.sync.sets).toHaveLength(1);
  });

  it('concurrent first reads in one context migrate once', async () => {
    const f = fakeApi({ local: M3_LOCAL });
    const [a, b] = await Promise.all([migrateProviders(f.api), resolveRoute(f.api, 'translate')]);
    expect(a.routing.translate).toBe(DEFAULT_PROFILE.id);
    expect(b.ok).toBe(true);
    expect(f.sync.sets).toHaveLength(1);
  });

  it('never overwrites items another device synced before the version', async () => {
    const mine: ProviderConnection = { ...APIBOX_CONNECTION, label: 'Work APIBOX', quirks: { supportsTemperature: false } };
    const other: ModelProfile = { ...APIBOX_PRO_PROFILE, id: 'custom-pro', maxConcurrency: 1 };
    const f = fakeApi({ sync: { 'conn:apibox': mine, 'profile:custom-pro': other, routing: { translate: 'custom-pro' } }, local: M3_LOCAL });
    const s = await migrateProviders(f.api);
    expect(f.sync.sets[0]).not.toContain('conn:apibox');
    expect(f.sync.data.get('conn:apibox')).toEqual(mine);
    expect(s.connections).toEqual([mine]);
    expect(s.profiles[0]).toEqual(other);
    expect(s.profiles).toHaveLength(4);
    expect(s.routing).toEqual({ translate: 'custom-pro' });
  });

  it('reads a newer schema as it is and never rewrites it', async () => {
    const f = fakeApi({ sync: { schemaVersion: 7, 'conn:x': { ...APIBOX_CONNECTION, id: 'x', future: true }, routing: { translate: 'p' } } });
    const s = await migrateProviders(f.api);
    expect(s.schemaVersion).toBe(7);
    expect(s.connections.map((c) => c.id)).toEqual(['x']);
    expect(f.sync.sets).toHaveLength(0);
  });

  it('a failed write (sync quota) still yields the migrated settings, and the next read tries again', async () => {
    const f = fakeApi({ local: M1_LOCAL });
    f.sync.failNextSets();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await migrateProviders(f.api)).routing.translate).toBe(GEMINI_PROFILE.id);
    expect(f.sync.data.size).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    f.sync.failNextSets(false);
    await migrateProviders(f.api);
    expect(f.sync.data.get('schemaVersion')).toBe(1);
  });
});

describe('routing resolution (plan M4-E8, DESIGN §4.3.5)', () => {
  const local: ModelProfile = { id: 'ollama-qwen', connectionId: 'ollama', model: 'qwen3:8b', maxConcurrency: 1, chunkTokens: 800 };
  const ollama: ProviderConnection = { id: 'ollama', label: 'Home Ollama', presetId: 'ollama', protocol: 'openai-chat', baseUrl: 'http://localhost:11434/v1', auth: { style: 'none' }, quirks: {}, status: 'ok' };
  const s = settings({
    connections: [structuredClone(APIBOX_CONNECTION), structuredClone(GEMINI_CONNECTION), ollama],
    profiles: [structuredClone(APIBOX_QWEN_PROFILE), structuredClone(APIBOX_PRO_PROFILE), structuredClone(GEMINI_PROFILE), local],
    routing: {
      translate: APIBOX_QWEN_PROFILE.id,
      siteOverrides: [
        { pattern: '*.corp.example.com', translate: 'ollama-qwen', localOnly: true },
        { pattern: 'news.example.org', translate: GEMINI_PROFILE.id },
        { pattern: '*.example.org', translate: APIBOX_PRO_PROFILE.id },
      ],
    },
  });
  const id = (r: ReturnType<typeof resolveRouteIn>) => (r.ok ? `${r.source}:${r.profile.id}` : `error:${r.source}`);

  it('site rule → tab override → routing.translate', () => {
    expect(id(resolveRouteIn(s, 'translate', { url: 'https://wiki.corp.example.com/a', tabProfileId: GEMINI_PROFILE.id }))).toBe('site:ollama-qwen');
    expect(id(resolveRouteIn(s, 'translate', { url: 'https://other.com/', tabProfileId: GEMINI_PROFILE.id }))).toBe(`tab:${GEMINI_PROFILE.id}`);
    expect(id(resolveRouteIn(s, 'translate', { url: 'https://other.com/' }))).toBe(`routing:${APIBOX_QWEN_PROFILE.id}`);
    expect(id(resolveRouteIn(s, 'translate'))).toBe(`routing:${APIBOX_QWEN_PROFILE.id}`);
  });

  it('the first matching site rule wins, in stored order; local-only is reported', () => {
    expect(id(resolveRouteIn(s, 'translate', { url: 'https://news.example.org/x' }))).toBe(`site:${GEMINI_PROFILE.id}`);
    expect(id(resolveRouteIn(s, 'translate', { url: 'https://blog.example.org/x' }))).toBe(`site:${APIBOX_PRO_PROFILE.id}`);
    const r = resolveRouteIn(s, 'translate', { url: 'https://corp.example.com/' });
    expect(r).toMatchObject({ ok: true, localOnly: true, rule: { pattern: '*.corp.example.com' } });
    expect(resolveRouteIn(s, 'translate', { url: 'https://other.com/' })).toMatchObject({ localOnly: false });
  });

  it('matches hosts: exact, or *. for the domain and its subdomains; never a lookalike suffix', () => {
    expect(matchesSite('example.com', 'https://example.com/a')).toBe(true);
    expect(matchesSite('example.com', 'https://www.example.com/a')).toBe(false);
    expect(matchesSite('*.example.com', 'https://example.com/')).toBe(true);
    expect(matchesSite('*.example.com', 'https://a.b.example.com/')).toBe(true);
    expect(matchesSite('*.example.com', 'https://badexample.com/')).toBe(false);
    expect(matchesSite('*.Example.COM', 'https://WWW.example.com/')).toBe(true);
    expect(matchesSite('example.com', 'not a url')).toBe(false);
  });

  it('analyze defaults to translate (overrides included); its own route wins, except under a local-only site rule', () => {
    expect(id(resolveRouteIn(s, 'analyze'))).toBe(`routing:${APIBOX_QWEN_PROFILE.id}`);
    expect(id(resolveRouteIn(s, 'analyze', { tabProfileId: GEMINI_PROFILE.id }))).toBe(`tab:${GEMINI_PROFILE.id}`);
    const own = { ...s, routing: { ...s.routing, analyze: APIBOX_PRO_PROFILE.id } };
    expect(id(resolveRouteIn(own, 'analyze', { tabProfileId: GEMINI_PROFILE.id }))).toBe(`routing:${APIBOX_PRO_PROFILE.id}`);
    expect(id(resolveRouteIn(own, 'analyze', { url: 'https://news.example.org/' }))).toBe(`routing:${APIBOX_PRO_PROFILE.id}`);
    // A cloud analyze profile never sees a local-only site's text.
    expect(id(resolveRouteIn(own, 'analyze', { url: 'https://x.corp.example.com/' }))).toBe('site:ollama-qwen');
    // review (M7) follows the same rule.
    expect(id(resolveRouteIn(s, 'review'))).toBe(`routing:${APIBOX_QWEN_PROFILE.id}`);
  });

  it('a site rule to a missing profile is an error, not a fall-through; a stale tab override is ignored', () => {
    const broken = { ...s, routing: { ...s.routing, siteOverrides: [{ pattern: 'x.com', translate: 'gone', localOnly: true }] } };
    const r = resolveRouteIn(broken, 'translate', { url: 'https://x.com/', tabProfileId: GEMINI_PROFILE.id });
    expect(r).toMatchObject({ ok: false, source: 'site' });
    expect(id(resolveRouteIn(s, 'translate', { tabProfileId: 'gone' }))).toBe(`routing:${APIBOX_QWEN_PROFILE.id}`);
    expect(resolveRouteIn({ ...s, routing: { translate: 'gone' } }, 'translate')).toMatchObject({ ok: false, source: 'routing' });
    expect(resolveRouteIn({ ...s, connections: [] }, 'translate')).toMatchObject({ ok: false, message: expect.stringMatching(/no connection/) });
  });

  it('resolveRoute reads the stored routing, site rules and the tab override (storage.session, cleared on close)', async () => {
    const f = fakeApi({ local: M3_LOCAL });
    await migrateProviders(f.api);
    await saveConnection(f.api, GEMINI_CONNECTION);
    await saveProfile(f.api, GEMINI_PROFILE);
    await saveRouting(f.api, { translate: DEFAULT_PROFILE.id, fallback: [GEMINI_PROFILE.id, 'basic'], siteOverrides: [{ pattern: 'x.com', translate: APIBOX_PRO_PROFILE.id }] });
    expect(f.sync.data.get('routing')).toEqual({ translate: DEFAULT_PROFILE.id, fallback: [GEMINI_PROFILE.id, 'basic'] });
    expect(f.sync.data.get('siteRules')).toEqual([{ pattern: 'x.com', translate: APIBOX_PRO_PROFILE.id }]);
    await setTabOverride(f.api, 4, GEMINI_PROFILE.id);
    expect(await readTabOverride(f.api, 4)).toBe(GEMINI_PROFILE.id);
    expect(f.session.data.get('tabRoute:4')).toBe(GEMINI_PROFILE.id);
    expect(id(await resolveRoute(f.api, 'translate', { tabId: 4, url: 'https://y.com/' }))).toBe(`tab:${GEMINI_PROFILE.id}`);
    expect(id(await resolveRoute(f.api, 'translate', { tabId: 4, url: 'https://x.com/' }))).toBe(`site:${APIBOX_PRO_PROFILE.id}`);
    expect(id(await resolveRoute(f.api, 'translate', { tabId: 5, url: 'https://y.com/' }))).toBe(`routing:${DEFAULT_PROFILE.id}`);
    await clearTabOverride(f.api, 4);
    expect(id(await resolveRoute(f.api, 'translate', { tabId: 4, url: 'https://y.com/' }))).toBe(`routing:${DEFAULT_PROFILE.id}`);
    // Removing the last site rule empties its item, in the same write as the routing (review B-5).
    const before = f.sync.sets.length;
    await saveRouting(f.api, { translate: DEFAULT_PROFILE.id });
    expect(f.sync.sets.slice(before)).toEqual([['routing', 'siteRules']]);
    expect(f.sync.data.get('siteRules')).toEqual([]);
    expect((await readProviderSettings(f.api)).routing).toEqual({ translate: DEFAULT_PROFILE.id });
  });

  it('saves keep the fields a newer schema added to the stored record, and never take unknown fields from the input (review B-2)', async () => {
    const f = fakeApi({ sync: { schemaVersion: 1, 'conn:apibox': { ...APIBOX_CONNECTION, rateLimit: { rpm: 60 } }, [`profile:${DEFAULT_PROFILE.id}`]: { ...DEFAULT_PROFILE, region: 'eu' }, routing: { translate: DEFAULT_PROFILE.id, onMeter: 'brief' } } });
    await saveConnection(f.api, { ...APIBOX_CONNECTION, label: 'Work', apiKey: 'sk-should-never-sync', junk: 1 } as ProviderConnection);
    expect(f.sync.data.get('conn:apibox')).toEqual({ ...APIBOX_CONNECTION, label: 'Work', rateLimit: { rpm: 60 } });
    await saveProfile(f.api, { ...DEFAULT_PROFILE, maxConcurrency: 1, secret: 'x' } as ModelProfile);
    expect(f.sync.data.get(`profile:${DEFAULT_PROFILE.id}`)).toEqual({ ...DEFAULT_PROFILE, maxConcurrency: 1, region: 'eu' });
    await saveRouting(f.api, { translate: DEFAULT_PROFILE.id, analyze: DEFAULT_PROFILE.id });
    expect(f.sync.data.get('routing')).toEqual({ translate: DEFAULT_PROFILE.id, analyze: DEFAULT_PROFILE.id, onMeter: 'brief' });
    await saveLearnedQuirk(f.api, { connectionId: 'apibox', profileId: APIBOX_PRO_PROFILE.id }, 'supportsTemperature', { supportsTemperature: false });
    expect(f.sync.data.get('conn:apibox')).toMatchObject({ rateLimit: { rpm: 60 }, quirks: { supportsTemperature: false } });
  });

  it('saves refuse what would not fit chrome.storage.sync: an item, the total, the item count (review B-3)', async () => {
    const f = fakeApi();
    await expect(saveConnection(f.api, { ...APIBOX_CONNECTION, extraHeaders: { 'X-Big': 'x'.repeat(9000) } })).rejects.toThrow(/sync limit of 8192 bytes for one setting/);
    // Total: 13 items of ~8,000 bytes already synced (e.g. glossary and others) leave no room.
    const full = fakeApi({ sync: { schemaVersion: 1, ...Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`other${i}`, 'x'.repeat(7900)])) } });
    await expect(saveConnection(full.api, { ...APIBOX_CONNECTION, label: 'y'.repeat(500) })).rejects.toThrow(/102400-byte limit/);
    expect(full.sync.data.has('conn:apibox')).toBe(false);
    // Replacing an item counts only the difference.
    const roomy = fakeApi({ sync: { schemaVersion: 1, ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`other${i}`, 'x'.repeat(7900)])), 'conn:apibox': APIBOX_CONNECTION } });
    await saveConnection(roomy.api, { ...APIBOX_CONNECTION, label: 'Work' });
    expect(roomy.sync.data.get('conn:apibox')).toMatchObject({ label: 'Work' });
    // Item count: 512 at most.
    const many = fakeApi({ sync: { schemaVersion: 1, ...Object.fromEntries(Array.from({ length: 511 }, (_, i) => [`k${i}`, 1])) } });
    await expect(saveProfile(many.api, { ...APIBOX_PRO_PROFILE, id: 'new' })).rejects.toThrow(/512 items/);
    await expect(saveProfile(f.api, { ...APIBOX_QWEN_PROFILE, model: '' })).rejects.toThrow(/not a valid/);
    await expect(saveRouting(f.api, { translate: '' })).rejects.toThrow(/translate/);
  });
});

describe('the panel route (src/entrypoints/sidepanel/route.ts)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const ORIGIN = 'https://api.ai-box.vn/*';

  it('builds the client for the routed profile of the page and tab', async () => {
    const f = fakeApi({ local: M3_LOCAL, granted: [ORIGIN] });
    await migrateProviders(f.api);
    await saveRouting(f.api, { translate: DEFAULT_PROFILE.id, siteOverrides: [{ pattern: 'x.com', translate: APIBOX_PRO_PROFILE.id }] });
    const site = await translateClient(f.api, { tabId: 1, url: 'https://x.com/a' });
    expect(site).toMatchObject({ ok: true, profile: { id: APIBOX_PRO_PROFILE.id }, connection: { id: 'apibox', label: 'APIBOX', origin: ORIGIN } });
    expect(site.ok && site.client.model).toBe(APIBOX_PRO_PROFILE.model);
    const plain = await translateClient(f.api, { tabId: 1, url: 'https://y.com/' });
    expect(plain.ok && plain.client.model).toBe(DEFAULT_PROFILE.model);
  });

  it('resolves the analyze role through routing: its own client when routed elsewhere, none when it is translate', async () => {
    const f = fakeApi({ local: M3_LOCAL, granted: [ORIGIN] });
    await migrateProviders(f.api);
    // Unset analyze → translate's client serves it (no second client).
    expect(await translateClient(f.api, { analyze: true })).not.toHaveProperty('analyze');
    await saveRouting(f.api, { translate: DEFAULT_PROFILE.id, analyze: APIBOX_FLASH_PROFILE.id });
    const r = await translateClient(f.api, { analyze: true });
    expect(r.ok && r.client.model).toBe(DEFAULT_PROFILE.model);
    expect(r.ok && r.analyze?.client.model).toBe(APIBOX_FLASH_PROFILE.model);
    expect(r.ok && r.analyze?.profile.pricing).toEqual(APIBOX_FLASH_PROFILE.pricing);
    // Not asked (single-pass, a segment retry): no analyze client.
    expect(await translateClient(f.api)).not.toHaveProperty('analyze');
    // Routed to the translate profile itself: one client.
    await saveRouting(f.api, { translate: DEFAULT_PROFILE.id, analyze: DEFAULT_PROFILE.id });
    expect(await translateClient(f.api, { analyze: true })).not.toHaveProperty('analyze');
  });

  it('an analyze route that cannot run stops with its own connection, never falling back to translate', async () => {
    const f = fakeApi({ local: M3_LOCAL, granted: [ORIGIN] });
    await migrateProviders(f.api);
    await saveConnection(f.api, GEMINI_CONNECTION);
    await saveProfile(f.api, GEMINI_PROFILE);
    await saveRouting(f.api, { translate: DEFAULT_PROFILE.id, analyze: GEMINI_PROFILE.id });
    expect(await translateClient(f.api, { analyze: true })).toMatchObject({ ok: false, error: { kind: 'auth', message: 'Add your Google Gemini API key in settings' }, connection: { id: 'gemini' } });
  });

  it('says what is wrong: no key, no access, a route to nothing', async () => {
    const noKey = fakeApi({ local: M1_LOCAL });
    await migrateProviders(noKey.api);
    // The M1 user's Gemini route: the key is there, the permission is not.
    expect(await translateClient(noKey.api)).toMatchObject({ ok: false, error: { kind: 'cors', cause: 'permission' }, connection: { id: 'gemini', origin: 'https://generativelanguage.googleapis.com/*' } });
    const fresh = fakeApi({ granted: [ORIGIN] });
    expect(await translateClient(fresh.api)).toMatchObject({ ok: false, error: { kind: 'auth', message: 'Add your APIBOX API key in settings' } });
    await saveRouting(fresh.api, { translate: 'gone' });
    expect(await translateClient(fresh.api)).toMatchObject({ ok: false, error: { kind: 'bad_request' } });
  });

  it('§4.2.4: a quirk the adapter learns is saved on the stored connection, and the next client starts with it', async () => {
    const f = fakeApi({ local: M3_LOCAL, granted: [ORIGIN] });
    await migrateProviders(f.api);
    // The v4-pro profile sets no maxTokensParam of its own: the flip is the connection's.
    await saveRouting(f.api, { translate: APIBOX_PRO_PROFILE.id });
    const bad: ScriptedResponse = { status: 400, body: JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }) };
    const fetch1 = mockFetch([bad, { status: 200, body: openaiStream({ text: ['ok'] }) }]);
    vi.stubGlobal('fetch', fetch1.fetch);
    const r = await translateClient(f.api);
    if (!r.ok) throw new Error('no client');
    const events: NormalizedEvent[] = [];
    const req = { model: APIBOX_PRO_PROFILE.model, system: 'You translate.', messages: [{ role: 'user' as const, content: 'Hello' }], maxOutputTokens: 64, signal: new AbortController().signal };
    for await (const e of r.client.stream(req)) events.push(e);
    expect(events.some((e) => e.type === 'text')).toBe(true);
    expect(fetch1.requests).toHaveLength(2);
    await vi.waitFor(() => expect((f.sync.data.get('conn:apibox') as ProviderConnection).quirks).toEqual({ ...APIBOX_CONNECTION.quirks, maxTokensParam: 'max_completion_tokens' }));
    // The profile is untouched; the next client sends max_completion_tokens at once.
    expect(f.sync.data.get(`profile:${APIBOX_PRO_PROFILE.id}`)).toEqual(APIBOX_PRO_PROFILE);
    const fetch2 = mockFetch([{ status: 200, body: openaiStream({ text: ['ok'] }) }]);
    vi.stubGlobal('fetch', fetch2.fetch);
    const r2 = await translateClient(f.api);
    if (!r2.ok) throw new Error('no client');
    for await (const e of r2.client.stream(req)) void e;
    expect(fetch2.requests).toHaveLength(1);
    expect(fetch2.requests[0]?.body).toMatchObject({ max_completion_tokens: 64 });
  });
});

describe('saveLearnedQuirk', () => {
  it('saves only the learned flag, on the profile when the profile sets it, else on the connection', async () => {
    const f = fakeApi({ local: M3_LOCAL });
    await migrateProviders(f.api);
    const merged = { ...APIBOX_CONNECTION.quirks, ...APIBOX_QWEN_PROFILE.quirks, supportsTemperature: false };
    await saveLearnedQuirk(f.api, { connectionId: 'apibox', profileId: APIBOX_QWEN_PROFILE.id }, 'supportsTemperature', merged);
    // The qwen profile's own reasoning policy is not copied onto the connection.
    expect((f.sync.data.get('conn:apibox') as ProviderConnection).quirks).toEqual({ ...APIBOX_CONNECTION.quirks, supportsTemperature: false });
    expect(f.sync.data.get(`profile:${APIBOX_QWEN_PROFILE.id}`)).toEqual(APIBOX_QWEN_PROFILE);
    // maxTokensParam is the qwen profile's own: learned there.
    await saveLearnedQuirk(f.api, { connectionId: 'apibox', profileId: APIBOX_QWEN_PROFILE.id }, 'maxTokensParam', { ...merged, maxTokensParam: 'max_tokens' });
    expect((f.sync.data.get(`profile:${APIBOX_QWEN_PROFILE.id}`) as ModelProfile).quirks?.maxTokensParam).toBe('max_tokens');
    expect((f.sync.data.get('conn:apibox') as ProviderConnection).quirks.maxTokensParam).toBeUndefined();
    // A connection that is not stored (removed meanwhile) is left alone.
    await saveLearnedQuirk(f.api, { connectionId: 'gone' }, 'supportsTemperature', { supportsTemperature: false });
    expect(f.sync.data.has('conn:gone')).toBe(false);
  });

  it('a built-in connection that only applies at read time (fresh install) is written with the learned flag', async () => {
    const f = fakeApi();
    await migrateProviders(f.api);
    expect(f.sync.data.has('conn:apibox')).toBe(false);
    await saveLearnedQuirk(f.api, { connectionId: 'apibox', profileId: APIBOX_PRO_PROFILE.id }, 'supportsTemperature', { supportsTemperature: false });
    expect(f.sync.data.get('conn:apibox')).toEqual({ ...APIBOX_CONNECTION, quirks: { ...APIBOX_CONNECTION.quirks, supportsTemperature: false } });
    expect((await readProviderSettings(f.api)).connections).toEqual([f.sync.data.get('conn:apibox')]);
    // Its built-in profiles still apply, so the default route still resolves.
    expect(await resolveRoute(f.api, 'translate')).toMatchObject({ ok: true, profile: { id: DEFAULT_PROFILE.id }, connection: { quirks: { supportsTemperature: false } } });
  });
});
