import { describe, expect, it, vi } from 'vitest';

vi.mock('./providers.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./providers.ts')>()),
  readProviderSettings: () => Promise.resolve({ connections: [{ id: 'gw', baseUrl: 'https://llm.corp.example.com/v1' }] }),
}));

const { addAllowlisted, addNever, autoTranslates, cleanSiteList, isNeverTranslate, readSiteLists, removeAllowlisted, removeNever, siteMode, siteOf, siteOrigins, sitePattern, SITE_ALLOWLIST_KEY, SITE_NEVER_KEY } = await import('./sites.ts');

const { syncItemBytes } = await import('./sync-quota.ts');

type Api = Parameters<typeof readSiteLists>[0];

function fakeApi(granted: string[] = []) {
  const sync: Record<string, unknown> = {};
  const local = new Map<string, unknown>();
  const perms = new Set(granted);
  const removed: string[][] = [];
  const api = {
    storage: {
      sync: {
        get: (keys: string | string[]) => Promise.resolve(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in sync).map((k) => [k, sync[k]]))),
        set: (o: Record<string, unknown>) => (Object.assign(sync, o), Promise.resolve()),
      },
      local: {
        get: (keys: string | string[]) => Promise.resolve(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => local.has(k)).map((k) => [k, local.get(k)]))),
        set: (o: Record<string, unknown>) => (Object.entries(o).forEach(([k, v]) => local.set(k, v)), Promise.resolve()),
        remove: (keys: string | string[]) => ((Array.isArray(keys) ? keys : [keys]).forEach((k) => local.delete(k)), Promise.resolve()),
      },
    },
    permissions: {
      contains: ({ origins }: { origins: string[] }) => Promise.resolve(origins.every((o) => perms.has(o))),
      remove: ({ origins }: { origins: string[] }) => (removed.push(origins), origins.forEach((o) => perms.delete(o)), Promise.resolve(true)),
      request: ({ origins }: { origins: string[] }) => (origins.forEach((o) => perms.add(o)), Promise.resolve(true)),
    },
  } as unknown as Api;
  return { api, sync, local, perms, removed };
}

describe('site patterns (plan M5-E6)', () => {
  it.each([
    ['example.com', 'example.com'],
    ['  Docs.Example.COM ', 'docs.example.com'],
    ['*.example.com', '*.example.com'],
    ['https://docs.example.com/guide/intro?x=1', 'docs.example.com'],
    ['docs.example.com/guide', 'docs.example.com'],
    ['localhost:3000', 'localhost'],
    ['example.com.', 'example.com'],
  ])('%s → %s', (input, out) => {
    expect(sitePattern(input)).toBe(out);
  });

  it.each(['', '*.', 'chrome://extensions', 'file:///tmp/a.html', 'exa mple.com', '*.*.com', 'a..b'])('rejects %j', (input) => {
    expect(sitePattern(input)).toBeNull();
  });

  it('siteOf takes the host of a web page only', () => {
    expect(siteOf('https://docusaurus.io/docs/installation')).toBe('docusaurus.io');
    expect(siteOf('chrome://newtab/')).toBeNull();
    expect(siteOf(undefined)).toBeNull();
  });

  it('asks for both schemes of the site, subdomains included for a wildcard', () => {
    expect(siteOrigins('docs.example.com')).toEqual(['https://docs.example.com/*', 'http://docs.example.com/*']);
    expect(siteOrigins('*.example.com')).toEqual(['https://*.example.com/*', 'http://*.example.com/*']);
  });

  it('cleans what storage holds: bad entries and repeats dropped', () => {
    expect(cleanSiteList(['a.com', 'A.com', 7, 'bad host', '*.b.com'])).toEqual(['a.com', '*.b.com']);
    expect(cleanSiteList('a.com')).toEqual([]);
  });

  it('never wins over the allowlist; anything else asks', () => {
    const lists = { allow: ['*.example.com'], never: ['bank.example.com'] };
    expect(siteMode(lists, 'https://docs.example.com/a')).toBe('allow');
    expect(siteMode(lists, 'https://example.com/')).toBe('allow');
    expect(siteMode(lists, 'https://bank.example.com/')).toBe('never');
    expect(siteMode(lists, 'https://other.org/')).toBe('ask');
    expect(siteMode(lists, undefined)).toBe('ask');
  });
});

describe('allowlist and never-translate storage (plan M5-E3/E6)', () => {
  it('allowlisting stores the site and takes it off the never list; removing gives the permission back', async () => {
    const f = fakeApi(siteOrigins('docs.example.org'));
    await addNever(f.api, 'docs.example.org');
    await addAllowlisted(f.api, 'docs.example.org');
    expect(await readSiteLists(f.api)).toEqual({ allow: ['docs.example.org'], never: [] });
    expect(await autoTranslates(f.api, 'https://docs.example.org/page/2')).toBe(true);

    expect(await removeAllowlisted(f.api, 'docs.example.org')).toEqual({ revoked: true });
    expect(f.removed).toEqual([siteOrigins('docs.example.org')]);
    expect(await autoTranslates(f.api, 'https://docs.example.org/page/2')).toBe(false);
  });

  it('auto-translates only with the permission still held (it can be revoked in chrome://extensions)', async () => {
    const f = fakeApi();
    f.sync[SITE_ALLOWLIST_KEY] = ['docs.example.org'];
    expect(await autoTranslates(f.api, 'https://docs.example.org/')).toBe(false);
    f.perms.add('https://docs.example.org/*');
    expect(await autoTranslates(f.api, 'https://docs.example.org/')).toBe(true);
    expect(await autoTranslates(f.api, 'http://docs.example.org/')).toBe(false);
  });

  it('keeps the permission a provider connection or a wider entry still needs', async () => {
    const f = fakeApi();
    f.sync[SITE_ALLOWLIST_KEY] = ['llm.corp.example.com', '*.example.net', 'docs.example.net'];
    expect(await removeAllowlisted(f.api, 'llm.corp.example.com')).toEqual({ revoked: false });
    expect(await removeAllowlisted(f.api, 'docs.example.net')).toEqual({ revoked: false });
    expect(f.removed).toEqual([]);
    expect((await readSiteLists(f.api)).allow).toEqual(['*.example.net']);
  });

  it('a full list refuses the site and gives back the permission just granted; one too large to sync stays on this device', async () => {
    const f = fakeApi(siteOrigins('new.example.org'));
    f.sync[SITE_ALLOWLIST_KEY] = Array.from({ length: 200 }, (_, i) => `s${i}.example.com`);
    await expect(addAllowlisted(f.api, 'new.example.org')).rejects.toThrow(/At most 200/);
    expect(f.removed).toEqual([siteOrigins('new.example.org')]);
    expect((await readSiteLists(f.api)).allow).toHaveLength(200);

    // Long host names pass the 8 KB sync item before the count: the list is kept here, sync keeps the last one that fit.
    const site = `${'b'.repeat(80)}.example.org`;
    const g = fakeApi(siteOrigins(site));
    const long: string[] = [];
    for (let next = 'a'.repeat(60) + '0.example.com'; syncItemBytes(SITE_ALLOWLIST_KEY, [...long, next]) <= 8192; next = `${'a'.repeat(60)}${long.length}.example.com`) long.push(next);
    g.sync[SITE_ALLOWLIST_KEY] = long;
    await addAllowlisted(g.api, site);
    expect(g.removed).toEqual([]);
    expect((await readSiteLists(g.api)).allow).toEqual([...long, site]);
    expect(g.sync[SITE_ALLOWLIST_KEY]).toEqual(long);
    expect(g.local.get('overflow:siteAllowlist')).toBe(true);
    // Shorter again: back to sync, and the copy here goes.
    await removeAllowlisted(g.api, site);
    expect(g.local.size).toBe(0);
    expect(g.sync[SITE_ALLOWLIST_KEY]).toEqual(long);
  });

  it('a never-translate site leaves the allowlist; unreadable lists count as empty', async () => {
    const f = fakeApi(siteOrigins('bank.example.com'));
    await addAllowlisted(f.api, 'bank.example.com');
    await addNever(f.api, 'bank.example.com');
    expect(await readSiteLists(f.api)).toEqual({ allow: [], never: ['bank.example.com'] });
    expect(f.perms.size).toBe(0);
    expect(await isNeverTranslate(f.api, 'https://bank.example.com/login')).toBe(true);
    await removeNever(f.api, 'bank.example.com');
    expect(f.sync[SITE_NEVER_KEY]).toEqual([]);
    expect(await isNeverTranslate({} as Api, 'https://bank.example.com/')).toBe(false);
  });
});
