import { describe, expect, it } from 'vitest';
import { applyImport, buildExport, EXPORT_FORMAT, EXPORT_VERSION, MAX_IMPORT_BYTES, parseImport, previewImport, type ImportPlan } from './portable.ts';
import { readProviderSettings, saveConnection, saveProfile, saveRouting } from './providers.ts';
import { readApiKey, saveApiKey, savePreferences, saveGlossary, readPreferences, readGlossary, DEFAULT_PROFILE } from './settings.ts';
import { readSiteLists } from './sites.ts';

type Api = Parameters<typeof buildExport>[0];

function fakeApi(opts: { syncQuota?: number } = {}) {
  const local = new Map<string, unknown>();
  const sync = new Map<string, unknown>();
  const area = (m: Map<string, unknown>) => ({
    get: (k: string | string[] | null) => Promise.resolve(k === null ? Object.fromEntries(m) : Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => m.has(x)).map((x) => [x, m.get(x)]))),
    set: (o: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(o)) m.set(k, v);
      return Promise.resolve();
    },
    remove: (k: string) => Promise.resolve(void m.delete(k)),
    ...(m === sync && opts.syncQuota !== undefined
      ? { getBytesInUse: (keys?: string | string[] | null) => Promise.resolve([...m].filter(([k]) => keys == null || [keys].flat().includes(k)).reduce((n, [k, v]) => n + (k + JSON.stringify(v)).length, 0)) }
      : {}),
  });
  const api = { storage: { local: area(local), sync: area(sync) }, i18n: { getUILanguage: () => 'en-US' } } as unknown as Api;
  return { api, local, sync };
}

const KEY = 'sk-SECRET-1234567890abcdef';
const conn = (over: Record<string, unknown> = {}) => ({
  id: 'gw',
  label: 'Company gateway',
  presetId: 'custom',
  protocol: 'openai-chat' as const,
  baseUrl: 'https://llm.example.com/v1',
  auth: { style: 'bearer' as const },
  quirks: {},
  status: 'ok' as const,
  lastError: 'boom',
  ...over,
});
const profile = { id: 'gw-m', connectionId: 'gw', model: 'big-model', maxConcurrency: 3, chunkTokens: 900 };

async function seeded() {
  const t = fakeApi();
  await saveConnection(t.api, conn({ extraHeaders: { 'X-Api-Key': 'hdr-SECRET', 'anthropic-version': '2023-06-01' }, queryParams: { key: 'qp-SECRET', alt: 'sse' }, baseUrl: 'https://user:pw-SECRET@llm.example.com/v1?token=url-SECRET&x=1' }));
  await saveProfile(t.api, profile);
  await saveRouting(t.api, { translate: 'gw-m', fallback: ['basic'], siteOverrides: [{ pattern: 'a.com', translate: 'gw-m', localOnly: true }] });
  await saveApiKey(t.api, 'gw', KEY);
  await savePreferences(t.api, { ...(await readPreferences(t.api)), targetLang: 'vi', style: 'faithful' });
  await saveGlossary(t.api, [{ term: 'deploy', rendering: 'deploy' }]);
  t.sync.set('siteAllowlist', ['docs.rs']);
  t.sync.set('siteNever', ['bank.com']);
  return t;
}

describe('export', () => {
  it('has no key in the file unless keys are included', async () => {
    const { api } = await seeded();
    const out = await buildExport(api);
    expect(out.json).not.toContain('SECRET');
    expect(out.file.keysIncluded).toBe(false);
    expect(out.file.keys).toBeUndefined();
    expect(out.omitted.join('|')).toMatch(/X-Api-Key/);
    expect(out.omitted.join('|')).toMatch(/query parameter key/);
    const c = out.file.settings.connections[0];
    if (!c) throw new Error('no connection');
    expect(c.extraHeaders).toEqual({ 'anthropic-version': '2023-06-01' });
    expect(c.queryParams).toEqual({ alt: 'sse' });
    expect(c.baseUrl).toBe('https://llm.example.com/v1?x=1');
    expect(c.status).toBe('unverified');
    expect(c.lastError).toBeUndefined();
  });

  it('includes keys, and everything else untouched, when asked', async () => {
    const { api } = await seeded();
    const out = await buildExport(api, { includeKeys: true });
    expect(out.file.keysIncluded).toBe(true);
    expect(out.file.keys).toEqual({ gw: KEY });
    expect(out.keyCount).toBe(1);
    expect(out.file.settings.connections[0]?.extraHeaders?.['X-Api-Key']).toBe('hdr-SECRET');
    expect(out.file.settings.glossary).toEqual([{ term: 'deploy', rendering: 'deploy' }]);
    expect(out.file.settings.siteAllowlist).toEqual(['docs.rs']);
  });

  it('leaves device-only data out', async () => {
    const t = await seeded();
    t.local.set('spend', { a: 1 });
    t.local.set('privacyNotice', true);
    t.local.set('onboarding', { done: true });
    const json = (await buildExport(t.api, { includeKeys: true })).json;
    for (const k of ['spend', 'privacyNotice', 'onboarding', 'migratedRoute']) expect(json).not.toContain(`"${k}"`);
  });
});

describe('round trip', () => {
  it('imports into a fresh profile, keys only when asked', async () => {
    const src = await seeded();
    const text = (await buildExport(src.api, { includeKeys: true })).json;
    const parsed = parseImport(text);
    if (!parsed.ok) throw new Error(parsed.error);

    const fresh = fakeApi();
    const report = await applyImport(fresh.api, parsed.plan, false);
    expect(report.keys).toEqual({ inFile: 1, written: 0, replaced: 0 });
    expect(await readApiKey(fresh.api, 'gw')).toBeUndefined();
    const s = await readProviderSettings(fresh.api);
    expect(s.connections.find((c) => c.id === 'gw')?.label).toBe('Company gateway');
    expect(s.routing.translate).toBe('gw-m');
    expect(s.routing.siteOverrides).toEqual([{ pattern: 'a.com', translate: 'gw-m', localOnly: true }]);
    expect((await readPreferences(fresh.api)).targetLang).toBe('vi');
    expect(await readGlossary(fresh.api)).toEqual([{ term: 'deploy', rendering: 'deploy' }]);
    expect(await readSiteLists(fresh.api)).toEqual({ allow: ['docs.rs'], never: ['bank.com'] });

    await applyImport(fresh.api, parsed.plan, true);
    expect(await readApiKey(fresh.api, 'gw')).toBe(KEY);
  });

  it('merges: nothing the file lacks is removed, and no key is touched without one in the file', async () => {
    const t = fakeApi();
    await saveApiKey(t.api, 'apibox', 'apibox-key');
    await saveApiKey(t.api, 'other', 'other-key');
    await saveGlossary(t.api, [{ term: 'mine', rendering: 'mine' }]);
    await saveConnection(t.api, conn({ id: 'mine-c', label: 'Mine' }));
    const src = await seeded();
    const parsed = parseImport((await buildExport(src.api, { includeKeys: true })).json);
    if (!parsed.ok) throw new Error(parsed.error);
    const preview = await previewImport(t.api, parsed.plan, true);
    expect(preview.keys.written).toBe(1);
    await applyImport(t.api, parsed.plan, true);
    expect(await readApiKey(t.api, 'apibox')).toBe('apibox-key');
    expect(await readApiKey(t.api, 'other')).toBe('other-key');
    expect((await readGlossary(t.api)).map((g) => g.term).sort()).toEqual(['deploy', 'mine']);
    expect((await readProviderSettings(t.api)).connections.some((c) => c.id === 'mine-c')).toBe(true);
  });

  it('counts a key it would replace', async () => {
    const t = fakeApi();
    await saveConnection(t.api, conn());
    await saveApiKey(t.api, 'gw', 'old-key');
    const parsed = parseImport(JSON.stringify({ format: EXPORT_FORMAT, formatVersion: 1, settings: { connections: [conn()] }, keys: { gw: KEY } }));
    if (!parsed.ok) throw new Error(parsed.error);
    expect((await previewImport(t.api, parsed.plan, true)).keys).toEqual({ inFile: 1, written: 1, replaced: 1 });
    expect((await previewImport(t.api, parsed.plan, false)).keys.written).toBe(0);
  });

  it('writes nothing when the sync write would not fit', async () => {
    const t = fakeApi({ syncQuota: 1 });
    const big: ImportPlan = { connections: [conn({ label: 'x'.repeat(9000) })] as never, profiles: [], siteRules: [], keys: {}, notes: [] };
    await expect(applyImport(t.api, big, false)).rejects.toThrow(/limit/);
    expect([...t.sync.keys()].some((k) => k.startsWith('conn:'))).toBe(false);
  });
});

describe('validation', () => {
  const file = (settings: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ format: EXPORT_FORMAT, formatVersion: EXPORT_VERSION, settings, ...extra });
  const plan = (text: string): ImportPlan => {
    const r = parseImport(text);
    if (!r.ok) throw new Error(r.error);
    return r.plan;
  };

  it('refuses what is not a settings file', () => {
    expect(parseImport('nope')).toEqual({ ok: false, error: 'This file is not valid JSON.' });
    expect(parseImport('[]').ok).toBe(false);
    expect(parseImport('{"format":"other","formatVersion":1,"settings":{}}').ok).toBe(false);
    expect(parseImport(file({}, { formatVersion: 99 }))).toMatchObject({ ok: false, error: expect.stringContaining('newer') });
    expect(parseImport(file({}, { formatVersion: 'x' })).ok).toBe(false);
    expect(parseImport(JSON.stringify({ format: EXPORT_FORMAT, formatVersion: 1 })).ok).toBe(false);
    expect(parseImport('x'.repeat(MAX_IMPORT_BYTES + 1)).ok).toBe(false);
  });

  it('skips invalid records and says so', () => {
    const p = plan(
      file({
        connections: [
          conn(),
          conn({ id: 'js', baseUrl: 'javascript:alert(1)' }),
          conn({ id: 'crlf', extraHeaders: { 'X-A': 'a\r\nHost: evil' } }),
          conn({ id: 'bad id!' }),
          { nope: true },
          conn({ id: 'gw' }),
        ],
        profiles: [profile, { id: 'p2' }],
        prefs: { targetLang: 'not a lang!', style: 'wild', budgetTokens: -1, captions: 'yes', altText: true },
      }),
    );
    expect(p.connections.map((c) => c.id)).toEqual(['gw']);
    expect(p.profiles.map((x) => x.id)).toEqual(['gw-m']);
    expect(p.prefs).toEqual({ altText: true });
    expect(p.notes.length).toBeGreaterThanOrEqual(8);
  });

  it('copes with a hostile shape', () => {
    const p = plan('{"format":"translate-side-settings","formatVersion":1,"settings":{"connections":[{"__proto__":{"x":1},"id":"gw","protocol":"openai-chat","baseUrl":"https://a.b","auth":{"style":"none"}}],"routing":{"translate":"__proto__"}},"keys":{"__proto__":"k","gw":"  good  ","bad":"line\\nbreak"}}');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(p.keys).toEqual({ gw: 'good', ['__proto__']: 'k' });
    expect(Object.keys(p.keys)).toContain('__proto__');
  });

  it('keeps the current routing when the file routes to an unknown model', async () => {
    const t = fakeApi();
    await saveRouting(t.api, { translate: DEFAULT_PROFILE.id });
    const p = plan(file({ routing: { translate: 'ghost' }, siteRules: [{ pattern: 'a.com', translate: 'ghost' }] }));
    const report = await applyImport(t.api, p, false);
    expect(report.routing).toBe('kept');
    expect((await readProviderSettings(t.api)).routing.translate).toBe(DEFAULT_PROFILE.id);
    expect(report.notes.join('|')).toMatch(/ghost/);
  });

  it('writes a key only for a connection the file or this browser has', async () => {
    const t = fakeApi();
    const p = plan(file({ connections: [conn()] }, { keys: { gw: KEY, ghost: 'zzz' } }));
    await applyImport(t.api, p, true);
    expect(await readApiKey(t.api, 'gw')).toBe(KEY);
    expect(await readApiKey(t.api, 'ghost')).toBeUndefined();
  });

  it('a site on both lists stays never-translate', async () => {
    const t = fakeApi();
    await applyImport(t.api, plan(file({ siteAllowlist: ['x.com'], siteNever: ['x.com'] })), false);
    expect(await readSiteLists(t.api)).toEqual({ allow: [], never: ['x.com'] });
  });
});
