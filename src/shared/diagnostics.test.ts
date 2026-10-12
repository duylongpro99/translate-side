import { describe, expect, it } from 'vitest';
import type { browser } from 'wxt/browser';
import { createDiagnosticsLog, DIAG_PREFIX, DIAG_SITES_KEY, diagnosticsFile, MAX_ENTRIES, readDiagnostics, clearDiagnostics, type JobRecord } from './diagnostics.ts';
import { fakeArea, fakeDevice, type FakeArea } from './testing.ts';

type Browser = typeof browser;

const record = (startedAt: number, more: Partial<JobRecord> = {}): JobRecord => ({
  id: `${startedAt}-abc${startedAt % 1000}`,
  startedAt,
  outcome: 'started',
  strategy: 'contextual',
  promptIds: ['translate@1'],
  lazy: false,
  segments: 10,
  cached: 0,
  chunks: 0,
  calls: 0,
  tokens: { input: 0, cachedInput: 0, output: 0 },
  failed: 0,
  errors: [],
  origin: 'https://example.com',
  ...more,
});

/** Two extension pages (two panels, or a panel and the options page) over one device's storage.local. */
function sharedLocal(local: FakeArea): Browser {
  return { storage: { local }, runtime: { getManifest: () => ({ version: '9.9.9' }) } } as unknown as Browser;
}

const diagKeys = (local: FakeArea) => [...local.data.keys()].filter((k) => k.startsWith(DIAG_PREFIX));

describe('the diagnostics log', () => {
  it('keeps one key per run, and the end of a run replaces its start', async () => {
    const { api, local } = fakeDevice();
    const log = createDiagnosticsLog(api);
    await log.record(record(1000));
    await log.record(record(1000, { outcome: 'done', endedAt: 4000, chunks: 2, calls: 3, tokens: { input: 300, cachedInput: 0, output: 200 }, model: 'm', presetId: 'openai' }));
    expect(diagKeys(local)).toEqual(['diag:1000-abc0']);
    const [entry] = await readDiagnostics(api);
    expect(entry).toMatchObject({ type: 'page-job', outcome: 'done', durationMs: 3000, chunks: 2, calls: 3, tokens: { input: 300, output: 200 }, model: 'm', presetId: 'openai', at: new Date(1000).toISOString() });
  });

  it(`cuts the log to the newest ${MAX_ENTRIES} entries`, async () => {
    const { api, local } = fakeDevice();
    const log = createDiagnosticsLog(api);
    for (let i = 1; i <= MAX_ENTRIES + 5; i++) await log.record(record(i * 1000));
    const keys = diagKeys(local);
    expect(keys).toHaveLength(MAX_ENTRIES);
    expect(keys).not.toContain('diag:5000-abc0');
    expect(keys).toContain('diag:6000-abc0');
    expect((await readDiagnostics(api)).map((e) => e.at)[0]).toBe(new Date((MAX_ENTRIES + 5) * 1000).toISOString());
  });

  it('loses no entry when two pages write at once', async () => {
    const local = fakeArea({}, { slow: true });
    const a = createDiagnosticsLog(sharedLocal(local));
    const b = createDiagnosticsLog(sharedLocal(local));
    await Promise.all(Array.from({ length: 20 }, (_, i) => [a.record(record(1000 + i * 2)), b.record(record(1001 + i * 2))]).flat());
    expect(diagKeys(local)).toHaveLength(40);
    // Over the cap, both still cut to the same newest entries.
    await Promise.all(Array.from({ length: 10 }, (_, i) => [a.record(record(2000 + i * 2)), b.record(record(2001 + i * 2))]).flat());
    const keys = diagKeys(local);
    expect(keys).toHaveLength(MAX_ENTRIES);
    for (let i = 0; i < 20; i++) expect(keys).toContain(`diag:${2000 + i}-abc${(2000 + i) % 1000}`);
  });

  it('keeps the site name only when the user turned site names on', async () => {
    const { api } = fakeDevice();
    const log = createDiagnosticsLog(api);
    await log.record(record(1000));
    await api.storage.local.set({ [DIAG_SITES_KEY]: true });
    await log.record(record(2000));
    const entries = await readDiagnostics(api);
    expect(entries.map((e) => (e.type === 'page-job' ? e.origin : 'x'))).toEqual(['https://example.com', undefined]);
    // The file leaves it out again when the user unticks it at export.
    const file = JSON.parse(diagnosticsFile(entries, { sites: false, exportedAt: 3000 })) as { format: string; entries: unknown[] };
    expect(file.format).toBe('translate-side-diagnostics');
    expect(JSON.stringify(file)).not.toContain('example.com');
    expect(diagnosticsFile(entries, { sites: true, exportedAt: 3000 })).toContain('https://example.com');
  });

  it('names each error by its kind and status with our own message', async () => {
    const { api } = fakeDevice();
    await createDiagnosticsLog(api).record(record(1000, { outcome: 'stopped', endedAt: 2000, errors: [{ kind: 'rate_limit', status: 429, count: 2 }] }));
    const [entry] = await readDiagnostics(api);
    expect(entry).toMatchObject({ errors: [{ kind: 'rate_limit', status: 429, count: 2, message: 'The provider rate-limited the request.' }] });
  });

  it('records a panel crash as the component and the error class only', async () => {
    const { api } = fakeDevice();
    await createDiagnosticsLog(api, () => 5000).crash('App', 'TypeError');
    expect(await readDiagnostics(api)).toEqual([{ type: 'panel-error', id: expect.stringMatching(/^5000-/), at: new Date(5000).toISOString(), extension: '', chrome: expect.any(String), component: 'App', error: 'TypeError' }]);
  });

  it('clears only its own keys', async () => {
    const { api, local } = fakeDevice({ local: { privacyNotice: { version: 2, at: 1 } } });
    await createDiagnosticsLog(api).record(record(1000));
    await clearDiagnostics(api);
    expect([...local.data.keys()]).toEqual(['privacyNotice']);
  });

  it('never throws when storage fails: a job goes on without its log', async () => {
    const api = { storage: { local: { get: () => Promise.reject(new Error('gone')), set: () => Promise.reject(new Error('gone')) } } } as unknown as Browser;
    await expect(createDiagnosticsLog(api).record(record(1000))).resolves.toBeUndefined();
  });
});
