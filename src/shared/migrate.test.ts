import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareAndSet, migrateSync, type MigrationStep } from './migrate.ts';
import { applyImport, buildExport, parseImport } from './portable.ts';
import { cleanConnection, cleanProfile, migrateProviders, readProviderSettings, resolveRoute, saveConnection, saveRouting, SCHEMA_KEY, type SiteRule } from './providers.ts';
import { APIBOX_CONNECTION, BUILTIN_CONNECTIONS, DEFAULT_PROFILE, GEMINI_PROFILE, readApiKey, readGlossary, readPreferences, saveGlossary } from './settings.ts';
import { readSiteLists } from './sites.ts';
import { fakeDevice, type FakeDevice } from './testing.ts';

type Shape = Record<'sync' | 'local' | 'session', Record<string, unknown>>;
const FIXTURES = path.resolve(__dirname, '../../tests/fixtures/storage');
const shape = (name: string): Shape => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')) as Shape;

/** Another context (worker, panel, options page) of the same device: its own api object, the same storage. */
const context = (d: FakeDevice): FakeDevice['api'] => ({ ...d.api, storage: { ...d.api.storage } }) as FakeDevice['api'];

const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ term: `term ${i}`, rendering: `rendering of term number ${i}` }));
const rules = (n: number, translate: string): SiteRule[] => Array.from({ length: n }, (_, i) => ({ pattern: `site-${i}.example.com`, translate }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('settings migration from every earlier build (the storage shape fixtures)', () => {
  const expected: Record<string, { translate: string; analyze?: string; fallback: string[]; sites?: boolean; seeded: string[] }> = {
    m1: { translate: GEMINI_PROFILE.id, fallback: ['basic'], seeded: ['conn:gemini', 'profile:gemini-flash-lite', 'schemaVersion'] },
    m3: { translate: DEFAULT_PROFILE.id, fallback: ['basic'], seeded: ['conn:apibox', 'profile:apibox-deepseek-flash', 'profile:apibox-deepseek-v4-pro', 'profile:apibox-qwen3.8-flash', 'schemaVersion'] },
    m4: { translate: 'corp-gpt', analyze: 'home-qwen', fallback: ['home-qwen', 'basic'], sites: true, seeded: [] },
    m5: { translate: 'corp-gpt', analyze: 'home-qwen', fallback: ['home-qwen', 'basic'], sites: true, seeded: [] },
  };

  it.each(Object.keys(expected))('%s: every stored value is kept and reads back; a second run writes nothing', async (name) => {
    const fx = shape(name);
    const want = expected[name] as (typeof expected)[string];
    const d = fakeDevice(fx);
    const s = await migrateProviders(d.api);

    // Nothing stored is overwritten or removed; the migration only adds what this device's keys imply.
    for (const [k, v] of Object.entries(fx.sync)) expect(d.sync.data.get(k), `sync.${k}`).toEqual(v);
    for (const [k, v] of Object.entries(fx.local)) expect(d.local.data.get(k), `local.${k}`).toEqual(v);
    for (const [k, v] of Object.entries(fx.session)) expect(d.session.data.get(k), `session.${k}`).toEqual(v);
    expect([...d.sync.data.keys()].filter((k) => !(k in fx.sync)).sort()).toEqual(want.seeded);
    expect([...d.local.data.keys()].filter((k) => !(k in fx.local))).toEqual('migratedRoute' in fx.local ? [] : ['migratedRoute']);

    // Read back through the current readers.
    const prefs = await readPreferences(d.api);
    expect(prefs).toMatchObject(fx.sync.prefs as object);
    expect(await readGlossary(d.api)).toEqual(fx.sync.glossary ?? []);
    expect(await readSiteLists(d.api)).toEqual({ allow: fx.sync.siteAllowlist ?? [], never: fx.sync.siteNever ?? [] });
    for (const [k, v] of Object.entries(fx.local)) if (k.startsWith('secret:')) expect(await readApiKey(d.api, k.slice('secret:'.length))).toBe(v);
    for (const [k, v] of Object.entries(fx.sync)) {
      if (k.startsWith('conn:')) expect(s.connections).toContainEqual(cleanConnection(v));
      if (k.startsWith('profile:')) expect(s.profiles).toContainEqual(cleanProfile(v));
    }
    expect(s.routing).toEqual({
      translate: want.translate,
      ...(want.analyze ? { analyze: want.analyze } : {}),
      fallback: want.fallback,
      ...(want.sites ? { siteOverrides: fx.sync.siteRules } : {}),
    });
    expect(s.schemaVersion).toBe(1);

    const writes = [d.sync.sets.length, d.local.sets.length];
    await migrateProviders(context(d));
    expect([d.sync.sets.length, d.local.sets.length]).toEqual(writes);
  });

  it('a version newer than this build knows is read as it is, never written', async () => {
    const d = fakeDevice({ sync: { schemaVersion: 2, 'conn:apibox': { ...APIBOX_CONNECTION, label: 'Mine', addedLater: { x: 1 } } }, local: { migratedRoute: {} } });
    const s = await migrateProviders(d.api);
    expect(d.sync.sets).toEqual([]);
    expect(s.schemaVersion).toBe(2);
    expect(s.connections.find((c) => c.id === 'apibox')?.label).toBe('Mine');
  });
});

describe('a fresh device never writes over what sync has not downloaded yet', () => {
  it('empty storage: nothing is written to sync, not even the version', async () => {
    const d = fakeDevice();
    const s = await migrateProviders(d.api);
    expect(d.sync.sets).toEqual([]);
    expect(Object.fromEntries(d.local.data)).toEqual({ migratedRoute: {} });
    expect(s.connections.map((c) => c.id)).toEqual(BUILTIN_CONNECTIONS.map((c) => c.id));
  });

  it('a sync download half way (preferences first, the version later): still nothing written', async () => {
    const m5 = shape('m5');
    const d = fakeDevice({ sync: { prefs: m5.sync.prefs, glossary: m5.sync.glossary } });
    await migrateProviders(d.api);
    expect(d.sync.sets).toEqual([]);
    // The rest arrives: everything is the other device's, as it wrote it.
    for (const [k, v] of Object.entries(m5.sync)) await d.sync.set({ [k]: v });
    expect((await readProviderSettings(d.api)).routing.translate).toBe('corp-gpt');
    expect(Object.fromEntries(d.sync.data)).toEqual(m5.sync);
  });
});

describe('migration runs one at a time and writes compare-and-set', () => {
  const concurrently = async () => {
    const d = fakeDevice(shape('m3'), { slow: true });
    const [panel, options] = [context(d), context(d)];
    const mine = { ...APIBOX_CONNECTION, label: 'My APIBOX' };
    await Promise.all([migrateProviders(d.api), migrateProviders(panel), saveConnection(options, mine), saveGlossary(panel, [{ term: 'new', rendering: 'mới' }]), migrateProviders(options)]);
    expect(d.sync.data.get('conn:apibox')).toMatchObject({ label: 'My APIBOX' });
    expect(d.sync.data.get('glossary')).toEqual([{ term: 'new', rendering: 'mới' }]);
    expect(d.sync.data.get(SCHEMA_KEY)).toBe(1);
    expect(d.sync.data.get('prefs')).toEqual(shape('m3').sync.prefs);
    expect(d.local.data.get('migratedRoute')).toEqual({});
    // Each record was seeded once; the version once.
    expect(d.sync.sets.filter((keys) => keys.includes(SCHEMA_KEY))).toHaveLength(1);
  };

  it('three contexts and two saves at once, with a Web Lock: no edit is lost', concurrently);

  it('the same without Web Locks (each context runs its own one after another)', async () => {
    vi.stubGlobal('navigator', {});
    await concurrently();
  });

  it('an item saved between the read and the write is left as it was saved', async () => {
    const d = fakeDevice({ local: { 'secret:apibox': 'sk-test-fixture-1' } });
    const mine = { ...APIBOX_CONNECTION, label: 'Saved meanwhile' };
    const steps: MigrationStep[] = [
      {
        version: 1,
        async patch(api) {
          await api.storage.sync.set({ 'conn:apibox': mine });
          return { 'conn:apibox': APIBOX_CONNECTION, 'profile:x': { id: 'x' } };
        },
      },
    ];
    const out = await migrateSync(d.api, SCHEMA_KEY, steps);
    expect(d.sync.data.get('conn:apibox')).toEqual(mine);
    expect(d.sync.data.get('profile:x')).toEqual({ id: 'x' });
    expect(out[SCHEMA_KEY]).toBe(1);
  });

  it('steps that both write land in one run, each on what the step before wrote', async () => {
    const d = fakeDevice({ sync: { prefs: { targetLang: 'vi' } } });
    const steps: MigrationStep[] = [
      { version: 1, patch: async (_api, items) => ({ prefs: { ...(items.prefs as object), style: 'natural' } }) },
      { version: 2, patch: async (_api, items) => ({ prefs: { ...(items.prefs as object), gloss: 'first' } }) },
    ];
    const out = await migrateSync(d.api, SCHEMA_KEY, steps);
    expect(d.sync.data.get('prefs')).toEqual({ targetLang: 'vi', style: 'natural', gloss: 'first' });
    expect(d.sync.data.get(SCHEMA_KEY)).toBe(2);
    expect(out).toEqual({ prefs: { targetLang: 'vi', style: 'natural', gloss: 'first' }, [SCHEMA_KEY]: 2 });
    expect(d.sync.sets).toHaveLength(2);
  });

  it('a step whose write fails leaves the next step writing both patches, so none is lost', async () => {
    const d = fakeDevice({ sync: { prefs: { targetLang: 'vi' } } });
    const set = d.sync.set.bind(d.sync);
    let fail = true;
    d.sync.set = async (items) => {
      if (fail) {
        fail = false;
        throw new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded');
      }
      return set(items);
    };
    const steps: MigrationStep[] = [
      { version: 1, patch: async (_api, items) => ({ prefs: { ...(items.prefs as object), style: 'natural' } }) },
      { version: 2, patch: async (_api, items) => ({ prefs: { ...(items.prefs as object), gloss: 'first' } }) },
    ];
    const out = await migrateSync(d.api, SCHEMA_KEY, steps);
    expect(d.sync.data.get('prefs')).toEqual({ targetLang: 'vi', style: 'natural', gloss: 'first' });
    expect(d.sync.data.get(SCHEMA_KEY)).toBe(2);
    expect(out).toEqual({ prefs: { targetLang: 'vi', style: 'natural', gloss: 'first' }, [SCHEMA_KEY]: 2 });
  });

  it('another runner moved the version on meanwhile: nothing is written, its storage is returned', async () => {
    const d = fakeDevice();
    const steps: MigrationStep[] = [
      {
        version: 1,
        async patch(api) {
          await api.storage.sync.set({ [SCHEMA_KEY]: 1, 'conn:other': { id: 'other' } });
          return { 'conn:apibox': APIBOX_CONNECTION };
        },
      },
    ];
    const out = await migrateSync(d.api, SCHEMA_KEY, steps);
    expect(d.sync.data.has('conn:apibox')).toBe(false);
    expect(out).toEqual({ [SCHEMA_KEY]: 1, 'conn:other': { id: 'other' } });
  });

  it('compareAndSet writes only items still as they were read', async () => {
    const d = fakeDevice({ sync: { a: 1, b: 2 } });
    expect(await compareAndSet(d.api.storage.sync, { a: 1, b: 1 }, { a: 10, b: 20, c: 30 })).toEqual({ a: 10, c: 30 });
    expect(Object.fromEntries(d.sync.data)).toEqual({ a: 10, b: 2, c: 30 });
    expect(await compareAndSet(d.api.storage.sync, {}, { a: 5 }, 'v')).toEqual({});
  });
});

describe('a 1,000-entry glossary and 300 site rules save without error', () => {
  it('both stay on this device, read back identically, and say so', async () => {
    const m5 = shape('m5');
    const d = fakeDevice(m5);
    const glossary = await saveGlossary(d.api, entries(1000));
    expect(glossary).toMatchObject({ ok: true, overflow: true });
    expect(await readGlossary(d.api)).toEqual(entries(1000));
    const routing = (await readProviderSettings(d.api)).routing;
    expect(await saveRouting(d.api, { ...routing, siteOverrides: rules(300, 'home-qwen') })).toEqual({ siteRulesLocal: true });
    const after = await readProviderSettings(d.api);
    expect(after.siteRulesLocal).toBe(true);
    expect(after.routing.siteOverrides).toEqual(rules(300, 'home-qwen'));
    expect(await resolveRoute(d.api, 'translate', { url: 'https://site-299.example.com/a' })).toMatchObject({ ok: true, source: 'site', profile: { id: 'home-qwen' } });
    // Sync keeps what fit, as other devices know it; the routing itself still syncs.
    expect(d.sync.data.get('glossary')).toEqual(m5.sync.glossary);
    expect(d.sync.data.get('siteRules')).toEqual(m5.sync.siteRules);
    expect(d.sync.data.get('routing')).toMatchObject({ translate: 'corp-gpt', basicMigrated: true });
  });

  it('two devices on one sync: A overflows, B (as M5 reads sync) keeps and edits its last synced glossary; neither loses data', async () => {
    const m5 = shape('m5');
    const a = fakeDevice(m5);
    const b = fakeDevice({ local: m5.local }, { sync: a.sync });
    await saveGlossary(a.api, entries(1000));
    // B reads the sync item exactly as an M5 build does.
    expect(b.sync.data.get('glossary')).toEqual(m5.sync.glossary);
    expect(await readGlossary(b.api)).toEqual(m5.sync.glossary);
    const edited = [...(m5.sync.glossary as object[]), { term: 'from B', rendering: 'từ B' }];
    expect(await saveGlossary(b.api, edited as never)).toMatchObject({ ok: true, overflow: false });
    expect(a.sync.data.get('glossary')).toEqual(edited);
    // A keeps its own large glossary (the accepted limit: B's edit is not merged into it).
    expect(await readGlossary(a.api)).toEqual(entries(1000));
    expect(await readGlossary(b.api)).toEqual(edited);
  });
});

describe('export and import round-trip', () => {
  it('an export from M5-shaped storage imports into a fresh device', async () => {
    const from = fakeDevice(shape('m5'));
    const file = await buildExport(from.api);
    const parsed = parseImport(file.json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const to = fakeDevice();
    await applyImport(to.api, parsed.plan, { withKeys: false });
    const m5 = shape('m5');
    expect(await readGlossary(to.api)).toEqual(m5.sync.glossary);
    expect(await readSiteLists(to.api)).toEqual({ allow: m5.sync.siteAllowlist, never: m5.sync.siteNever });
    expect(await readPreferences(to.api)).toEqual(m5.sync.prefs);
    const s = await readProviderSettings(to.api);
    expect(s.routing).toEqual({ translate: 'corp-gpt', analyze: 'home-qwen', fallback: ['home-qwen', 'basic'], siteOverrides: m5.sync.siteRules });
    expect(s.connections.map((c) => c.id)).toEqual(expect.arrayContaining(['corp', 'home']));
  });

  it('a new export with a 1,000-entry glossary and 300 site rules (kept on the device) imports in full', async () => {
    const from = fakeDevice(shape('m5'));
    await saveGlossary(from.api, entries(1000));
    await saveRouting(from.api, { ...(await readProviderSettings(from.api)).routing, siteOverrides: rules(300, 'home-qwen') });
    const parsed = parseImport((await buildExport(from.api)).json);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.plan.notes).toEqual([]);
    const to = fakeDevice();
    await applyImport(to.api, parsed.plan, { withKeys: false });
    expect(await readGlossary(to.api)).toEqual(entries(1000));
    const s = await readProviderSettings(to.api);
    expect(s.routing.siteOverrides).toEqual(rules(300, 'home-qwen'));
    expect(s.siteRulesLocal).toBe(true);
  });
});
