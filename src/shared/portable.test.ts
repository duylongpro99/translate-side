import { describe, expect, it } from 'vitest';
import { applyImport, buildExport, EXPORT_FORMAT, EXPORT_VERSION, MAX_IMPORT_BYTES, parseImport, previewImport, type ImportPlan } from './portable.ts';
import { readProviderSettings, saveConnection, saveProfile, saveRouting } from './providers.ts';
import { readApiKey, saveApiKey, savePreferences, saveGlossary, readPreferences, readGlossary, DEFAULT_PROFILE } from './settings.ts';
import { readSiteLists } from './sites.ts';
import { QUALITY_KEY, readQuality, updateQuality } from './quality.ts';
import { READING_KEY, readReading, updateReading } from './reading.ts';

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
    remove: (k: string | string[]) => Promise.resolve(void [k].flat().forEach((x) => m.delete(x))),
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
    const report = await applyImport(fresh.api, parsed.plan, { withKeys: false });
    expect(report.keys).toEqual({ inFile: 1, wouldWrite: 1, wouldReplace: 0, written: 0, removed: 0 });
    expect(await readApiKey(fresh.api, 'gw')).toBeUndefined();
    const s = await readProviderSettings(fresh.api);
    expect(s.connections.find((c) => c.id === 'gw')?.label).toBe('Company gateway');
    expect(s.routing.translate).toBe('gw-m');
    expect(s.routing.siteOverrides).toEqual([{ pattern: 'a.com', translate: 'gw-m', localOnly: true }]);
    expect((await readPreferences(fresh.api)).targetLang).toBe('vi');
    expect(await readGlossary(fresh.api)).toEqual([{ term: 'deploy', rendering: 'deploy' }]);
    expect(await readSiteLists(fresh.api)).toEqual({ allow: ['docs.rs'], never: ['bank.com'] });

    await applyImport(fresh.api, parsed.plan, { withKeys: true });
    expect(await readApiKey(fresh.api, 'gw')).toBe(KEY);
  });

  it('carries the on-device engine setting, and drops a protocol override on a built-in profile', async () => {
    const src = fakeApi();
    await saveConnection(src.api, conn({ id: 'nano', presetId: 'chrome-builtin', protocol: 'chrome-builtin', baseUrl: '', auth: { style: 'none' } }));
    await saveProfile(src.api, { id: 'nano-m', connectionId: 'nano', model: 'gemini-nano', maxConcurrency: 1, chunkTokens: 600, protocolOverride: 'openai-chat' });
    await saveRouting(src.api, { translate: 'nano-m', fallback: ['basic'], onDevice: 'translator' });
    const parsed = parseImport((await buildExport(src.api, { includeKeys: false })).json);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.plan.profiles.find((p) => p.id === 'nano-m')).not.toHaveProperty('protocolOverride');
    const fresh = fakeApi();
    await applyImport(fresh.api, parsed.plan, { withKeys: false });
    expect((await readProviderSettings(fresh.api)).routing.onDevice).toBe('translator');
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
    const preview = await previewImport(t.api, parsed.plan, { withKeys: true });
    expect(preview.keys.written).toBe(1);
    await applyImport(t.api, parsed.plan, { withKeys: true });
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
    expect((await previewImport(t.api, parsed.plan, { withKeys: true })).keys).toEqual({ inFile: 1, wouldWrite: 1, wouldReplace: 1, written: 1, removed: 0 });
    const off = (await previewImport(t.api, parsed.plan, { withKeys: false })).keys;
    expect(off).toMatchObject({ written: 0, wouldWrite: 1, wouldReplace: 1 });
  });

  it('writes nothing when the sync write would not fit', async () => {
    const t = fakeApi({ syncQuota: 1 });
    const big: ImportPlan = { connections: [conn({ label: 'x'.repeat(9000) })] as never, profiles: [], siteRules: [], keys: {}, notes: [] };
    await expect(applyImport(t.api, big, { withKeys: false })).rejects.toThrow(/limit/);
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
    const report = await applyImport(t.api, p, { withKeys: false });
    expect(report.routing).toBe('kept');
    expect((await readProviderSettings(t.api)).routing.translate).toBe(DEFAULT_PROFILE.id);
    expect(report.notes.join('|')).toMatch(/ghost/);
  });

  it('writes a key only for a connection the file or this browser has', async () => {
    const t = fakeApi();
    const p = plan(file({ connections: [conn()] }, { keys: { gw: KEY, ghost: 'zzz' } }));
    await applyImport(t.api, p, { withKeys: true });
    expect(await readApiKey(t.api, 'gw')).toBe(KEY);
    expect(await readApiKey(t.api, 'ghost')).toBeUndefined();
  });

  it('a site on both lists stays never-translate', async () => {
    const t = fakeApi();
    await applyImport(t.api, plan(file({ siteAllowlist: ['x.com'], siteNever: ['x.com'] })), { withKeys: false });
    expect(await readSiteLists(t.api)).toEqual({ allow: [], never: ['x.com'] });
  });

  it('ignores a key whose connection record in the file was skipped (N5)', async () => {
    const t = fakeApi();
    await saveConnection(t.api, conn());
    await saveApiKey(t.api, 'gw', 'old-key');
    const p = plan(file({ connections: [conn({ baseUrl: 'javascript:x' })] }, { keys: { gw: 'evil-key' } }));
    expect(p.keys).toEqual({});
    expect(p.notes.join('|')).toMatch(/Ignored the key for "gw"/);
  });

  it('bounds auth header names, routing ids and site-rule patterns (N1)', () => {
    const p = plan(
      file({
        connections: [conn({ authByProtocol: { 'openai-chat': { style: 'custom-header', headerName: 'bad header\r\n' } } })],
        routing: { translate: 'ok', analyze: 'bad id!', fallback: ['fine', 'x'.repeat(500), 'basic'] },
        siteRules: [{ pattern: 'ok.com', translate: 'ok' }, { pattern: 'no/slash', translate: 'ok' }, { pattern: 'a.com', translate: 'bad id!' }],
      }),
    );
    expect(p.connections).toEqual([]);
    expect(p.routing).toEqual({ translate: 'ok', fallback: ['fine', 'basic'] });
    expect(p.siteRules).toEqual([{ pattern: 'ok.com', translate: 'ok' }]);
  });
});

describe('a file cannot redirect a saved key (B1)', () => {
  const evil = (over: Record<string, unknown> = {}) => JSON.stringify({ format: EXPORT_FORMAT, formatVersion: 1, settings: { connections: [conn({ baseUrl: 'https://evil.example/v1', ...over })] } });
  const plan = (text: string): ImportPlan => {
    const r = parseImport(text);
    if (!r.ok) throw new Error(r.error);
    return r.plan;
  };
  const setup = async () => {
    const t = fakeApi();
    await saveConnection(t.api, conn());
    await saveApiKey(t.api, 'gw', KEY);
    return t;
  };

  it('shows addresses without credentials or key parameters, as the export does', async () => {
    const t = fakeApi();
    await saveConnection(t.api, conn({ baseUrl: 'https://me:hunter2@llm.example.com/v1?api_key=SAVEDSECRET&v=2' }));
    await saveApiKey(t.api, 'gw', KEY);
    const preview = await previewImport(t.api, plan(evil({ baseUrl: 'https://u:pw@evil.example/v1?token=FILESECRET&v=2' })), { withKeys: false });
    const shown = JSON.stringify([preview.redirects, preview.endpoints]);
    for (const secret of ['hunter2', 'SAVEDSECRET', 'FILESECRET', 'pw@']) expect(shown).not.toContain(secret);
    expect(preview.redirects[0]).toMatchObject({ from: 'https://llm.example.com/v1?v=2', to: 'https://evil.example/v1?v=2', changed: ['address'] });
    expect(preview.endpoints).toEqual(['https://evil.example/v1?v=2']);
  });

  it('names the connection and removes its saved key by default', async () => {
    const t = await setup();
    const p = plan(evil());
    const preview = await previewImport(t.api, p, { withKeys: false });
    expect(preview.redirects).toEqual([{ id: 'gw', label: 'Company gateway', from: 'https://llm.example.com/v1', to: 'https://evil.example/v1', changed: ['address'], keyAction: 'removed' }]);
    expect(await readApiKey(t.api, 'gw')).toBe(KEY); // a preview writes nothing
    const report = await applyImport(t.api, p, { withKeys: false });
    expect(report.keys.removed).toBe(1);
    expect(await readApiKey(t.api, 'gw')).toBeUndefined();
    expect((await readProviderSettings(t.api)).connections.find((c) => c.id === 'gw')?.baseUrl).toBe('https://evil.example/v1');
  });

  it('keeps the key only for a connection the user ticked', async () => {
    const t = await setup();
    const report = await applyImport(t.api, plan(evil()), { withKeys: false, keepKeys: new Set(['gw']) });
    expect(report.redirects[0]?.keyAction).toBe('kept');
    expect(await readApiKey(t.api, 'gw')).toBe(KEY);
  });

  it('catches a change of headers, query parameters and auth, not only the address', async () => {
    const t = await setup();
    const p = plan(evil({ baseUrl: 'https://llm.example.com/v1', extraHeaders: { 'X-Route': 'evil' }, queryParams: { to: 'evil' }, auth: { style: 'custom-header', headerName: 'X-Leak' } }));
    expect((await previewImport(t.api, p, { withKeys: false })).redirects[0]?.changed).toEqual(['auth', 'headers', 'query parameters']);
    await applyImport(t.api, p, { withKeys: false });
    expect(await readApiKey(t.api, 'gw')).toBeUndefined();
  });

  it('a file key replaces the saved one instead; an identical connection redirects nothing', async () => {
    const t = await setup();
    const withKey = parseImport(JSON.stringify({ format: EXPORT_FORMAT, formatVersion: 1, settings: { connections: [conn({ baseUrl: 'https://evil.example/v1' })] }, keys: { gw: 'file-key' } }));
    if (!withKey.ok) throw new Error(withKey.error);
    expect((await previewImport(t.api, withKey.plan, { withKeys: true })).redirects[0]?.keyAction).toBe('replaced');
    const same = plan(JSON.stringify({ format: EXPORT_FORMAT, formatVersion: 1, settings: { connections: [conn()] } }));
    const report = await applyImport(t.api, same, { withKeys: false });
    expect(report.redirects).toEqual([]);
    expect(await readApiKey(t.api, 'gw')).toBe(KEY);
  });

  it('protects the key of a built-in connection too', async () => {
    const t = fakeApi();
    await saveApiKey(t.api, 'apibox', 'apibox-key');
    await applyImport(t.api, plan(JSON.stringify({ format: EXPORT_FORMAT, formatVersion: 1, settings: { connections: [conn({ id: 'apibox', baseUrl: 'https://evil.example/v1' })] } })), { withKeys: false });
    expect(await readApiKey(t.api, 'apibox')).toBeUndefined();
  });
});

describe('routing round trip (N4)', () => {
  it('keeps a removed basic fallback removed, and a stored basic', async () => {
    for (const fallback of [[], ['basic']]) {
      const src = fakeApi();
      await saveConnection(src.api, conn());
      await saveProfile(src.api, profile);
      await saveRouting(src.api, { translate: 'gw-m', fallback });
      const parsed = parseImport((await buildExport(src.api)).json);
      if (!parsed.ok) throw new Error(parsed.error);
      const fresh = fakeApi();
      await applyImport(fresh.api, parsed.plan, { withKeys: false });
      expect((await readProviderSettings(fresh.api)).routing.fallback ?? []).toEqual(fallback);
      expect(fresh.sync.get('routing')).toMatchObject({ basicMigrated: true });
    }
  });

  it('flags a key-like string the name-based redaction cannot see', async () => {
    const t = fakeApi();
    await saveConnection(t.api, conn({ baseUrl: 'https://llm.example.com/v1/abcdefghijklmnopqrstuvwxyz0123456789' }));
    const out = await buildExport(t.api);
    expect(out.suspects).toEqual(['Company gateway: base URL']);
  });
});

describe('the quality setting travels with the file', () => {
  const file = (settings: Record<string, unknown>, extra: Record<string, unknown> = {}) => JSON.stringify({ format: EXPORT_FORMAT, formatVersion: EXPORT_VERSION, settings, ...extra });
  const planOf = (text: string): ImportPlan => {
    const parsed = parseImport(text);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.plan;
  };

  it('is exported next to the preferences, and imports into a fresh profile', async () => {
    const src = fakeApi();
    await updateQuality(src.api, { mode: 'best', strategy: 'contextual', keepDraftsOnScreen: true });
    const out = await buildExport(src.api);
    expect(out.file.settings.quality).toEqual({ mode: 'best', strategy: 'contextual', keepDraftsOnScreen: true });
    expect(out.file.formatVersion).toBe(1);

    const fresh = fakeApi();
    const report = await applyImport(fresh.api, planOf(out.json), { withKeys: false });
    expect(report.quality).toBe(true);
    expect(await readQuality(fresh.api)).toEqual({ mode: 'best', strategy: 'contextual', keepDraftsOnScreen: true });
    expect(fresh.sync.has(QUALITY_KEY)).toBe(true);
  });

  it('a file from before it existed still imports and leaves the stored setting alone', async () => {
    const t = fakeApi();
    await updateQuality(t.api, { mode: 'fast' });
    const plan = planOf(file({ prefs: { targetLang: 'de' } }));
    expect(plan.quality).toBeUndefined();
    const report = await applyImport(t.api, plan, { withKeys: false });
    expect(report.quality).toBe(false);
    expect((await readPreferences(t.api)).targetLang).toBe('de');
    expect((await readQuality(t.api)).mode).toBe('fast');
  });

  it('reads only the fields it knows, so a file with an extra field imports at the same format version', () => {
    expect(EXPORT_VERSION).toBe(1);
    const plan = planOf(file({ prefs: { targetLang: 'de' }, somethingNew: { a: 1 } }, { alsoNew: true }));
    expect(plan.prefs).toEqual({ targetLang: 'de' });
    expect(Object.keys(plan).sort()).toEqual(['connections', 'keys', 'notes', 'prefs', 'profiles', 'siteRules']);
  });

  it('cleans an imported setting, keeps an imported refine as written, and says when it is unreadable', () => {
    expect(planOf(file({ quality: { mode: 'turbo', strategy: 'refine', keepDraftsOnScreen: 'yes' } })).quality).toEqual({ mode: 'balanced', strategy: 'refine', keepDraftsOnScreen: false });
    expect(planOf(file({ quality: { mode: 'fast', strategy: 'refine', keepDraftsOnScreen: false } })).quality).toEqual({ mode: 'fast', strategy: 'refine', keepDraftsOnScreen: false });
    for (const empty of [{}, { mode: 42 }, { mode: 'turbo', strategy: 'magic' }]) {
      const skipped = planOf(file({ quality: empty }));
      expect(skipped.quality).toBeUndefined();
      expect(skipped.notes.join(' ')).toContain('quality');
    }
    const bad = planOf(file({ quality: 'best' }));
    expect(bad.quality).toBeUndefined();
    expect(bad.notes.join(' ')).toContain('quality');
  });
});

describe('the reading settings travel with the file', () => {
  const file = (settings: Record<string, unknown>) => JSON.stringify({ format: EXPORT_FORMAT, formatVersion: EXPORT_VERSION, settings });
  const planOf = (text: string): ImportPlan => {
    const parsed = parseImport(text);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.plan;
  };

  it('are exported, previewed and imported into a fresh profile', async () => {
    const src = fakeApi();
    await updateReading(src.api, { theme: 'dark', typeface: 'serif', size: 19, width: 'full' });
    const out = await buildExport(src.api);
    expect(out.file.settings.reading).toEqual({ theme: 'dark', typeface: 'serif', size: 19, width: 'full' });

    const fresh = fakeApi();
    const plan = planOf(out.json);
    expect((await previewImport(fresh.api, plan, { withKeys: false })).reading).toBe(true);
    expect(fresh.sync.has(READING_KEY)).toBe(false);
    const report = await applyImport(fresh.api, plan, { withKeys: false });
    expect(report.reading).toBe(true);
    expect(await readReading(fresh.api)).toEqual({ theme: 'dark', typeface: 'serif', size: 19, width: 'full' });
  });

  it('a file from before they existed leaves the stored settings alone', async () => {
    const t = fakeApi();
    await updateReading(t.api, { theme: 'paper' });
    const plan = planOf(file({ prefs: { targetLang: 'de' } }));
    expect(plan.reading).toBeUndefined();
    const report = await applyImport(t.api, plan, { withKeys: false });
    expect(report.reading).toBe(false);
    expect((await readReading(t.api)).theme).toBe('paper');
  });

  it('are cleaned on import, and an unreadable value is skipped with a note', () => {
    expect(planOf(file({ reading: { theme: 'dark', size: 60, width: 'wide' } })).reading).toEqual({ theme: 'dark', typeface: 'sans', size: 24, width: 'medium' });
    for (const bad of [{}, { theme: 'neon' }, 'dark', [1]]) {
      const skipped = planOf(file({ reading: bad }));
      expect(skipped.reading).toBeUndefined();
      expect(skipped.notes.join(' ')).toContain('reading settings');
    }
  });
});
