import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { openTranslationCache, type TranslationCache } from './cache.ts';
import { cleanEditText, IMPORT_ORIGIN, MAX_MEMORY_ENTRIES, MAX_MEMORY_IMPORT_BYTES, MAX_MEMORY_TEXT, MEMORY_FORMAT, memoryExportFileName, memoryKey, openTranslationMemory, parseMemoryImport, type MemoryEdit, type TranslationMemory } from './memory.ts';

const open = (factory = new IDBFactory(), over: Parameters<typeof openTranslationMemory>[0] = {}) => openTranslationMemory({ factory, ...over }) as TranslationMemory;
const edit = (over: Partial<MemoryEdit> = {}): MemoryEdit => ({ source: 'Sign in to your account', target: 'Đăng nhập vào tài khoản', sourceLang: 'en', targetLang: 'vi', origin: 'https://a.example', localOnly: false, ...over });
const file = (entries: unknown[], over: Record<string, unknown> = {}) => JSON.stringify({ format: MEMORY_FORMAT, formatVersion: 1, exportedAt: new Date(0).toISOString(), entries, ...over });
const entry = (over: Record<string, unknown> = {}) => ({ source: 'Sign in to your account', target: 'Đăng nhập vào tài khoản', sourceLang: 'en', targetLang: 'vi', created: 1, ...over });

describe('memoryKey', () => {
  it('normalises the source as the cache key does, and differs by target language and text', () => {
    expect(memoryKey('vi', '  Hello   *world*\n')).toBe(memoryKey('vi', 'Hello *world*'));
    expect(memoryKey('VI', 'Hello')).toBe(memoryKey('vi', 'Hello'));
    expect(new Set([memoryKey('vi', 'Hello'), memoryKey('fr', 'Hello'), memoryKey('vi', 'Hello!'), memoryKey('vi', 'Hello *x*')]).size).toBe(4);
  });

  it('cleanEditText drops control characters but keeps line breaks and tabs', () => {
    expect(cleanEditText(' a\u0000b\u0007c\td\ne \u009f')).toBe('abc\td\ne');
  });

  it('names the export file by date', () => {
    expect(memoryExportFileName(new Date('2026-10-13T08:00:00Z'))).toBe('translate-side-memory-2026-10-13.json');
  });
});

describe('openTranslationMemory', () => {
  it('stores an edit as the user’s override with its provenance, and reads it back by key', async () => {
    const m = open(undefined, { now: () => 100 });
    const e = await m.put(edit({ source: '  Sign in to   your account ' }));
    expect(e).toEqual({ key: memoryKey('vi', 'Sign in to your account'), source: 'Sign in to your account', target: 'Đăng nhập vào tài khoản', sourceLang: 'en', targetLang: 'vi', origin: 'https://a.example', localOnly: false, by: 'user', override: true, created: 100, updated: 100 });
    const got = await m.getMany([e.key, 'missing']);
    expect([...got.keys()]).toEqual([e.key]);
    expect(await m.count()).toBe(1);
  });

  it('a later edit keeps the first creation time, and stays local-only if either edit was', async () => {
    let t = 1;
    const m = open(undefined, { now: () => t++ });
    await m.put(edit({ localOnly: true }));
    const again = await m.put(edit({ target: 'Đăng nhập tài khoản của bạn', origin: 'https://b.example', localOnly: false }));
    expect(again).toMatchObject({ target: 'Đăng nhập tài khoản của bạn', origin: 'https://b.example', localOnly: true, created: 1, updated: 2 });
    expect(await m.count()).toBe(1);
  });

  it('refuses an empty side or a side over the length cap', async () => {
    const m = open();
    await expect(m.put(edit({ target: '   ' }))).rejects.toThrow(RangeError);
    await expect(m.put(edit({ target: 'x'.repeat(MAX_MEMORY_TEXT + 1) }))).rejects.toThrow(RangeError);
    await expect(m.put(edit({ source: 'y'.repeat(MAX_MEMORY_TEXT + 1) }))).rejects.toThrow(RangeError);
    expect(await m.count()).toBe(0);
  });

  it('at the cap, a new edit replaces the least recently updated entry', async () => {
    let t = 1;
    const m = open(undefined, { maxEntries: 3, now: () => t++ });
    for (const s of ['one', 'two', 'three']) await m.put(edit({ source: s, target: `vi ${s}` }));
    // Touching "one" makes "two" the oldest.
    await m.put(edit({ source: 'one', target: 'vi one again' }));
    await m.put(edit({ source: 'four', target: 'vi four' }));
    expect(await m.count()).toBe(3);
    const keys = ['one', 'two', 'three', 'four'].map((s) => memoryKey('vi', s));
    expect([...(await m.getMany(keys)).values()].map((e) => e.source).sort()).toEqual(['four', 'one', 'three']);
  });

  it('lists by target language, deletes, clears, and bumps the version on every write', async () => {
    const m = open();
    expect(await m.version()).toBe(0);
    const a = await m.put(edit({ source: 'a', target: 'vi a' }));
    await m.put(edit({ source: 'b', target: 'fr b', targetLang: 'fr' }));
    expect(await m.version()).toBe(2);
    expect((await m.list('vi', 10)).map((e) => e.source)).toEqual(['a']);
    expect(await m.list('vi', 0)).toEqual([]);
    await m.delete([a.key]);
    expect(await m.list('vi', 10)).toEqual([]);
    expect(await m.version()).toBe(3);
    await m.clear();
    expect(await m.count()).toBe(0);
    expect(await m.version()).toBe(4);
  });

  it('sees writes from another connection to the same database (the options page and the panel)', async () => {
    const factory = new IDBFactory();
    const panel = open(factory);
    const options = open(factory);
    await panel.put(edit());
    expect(await options.count()).toBe(1);
    await options.clear();
    expect(await panel.count()).toBe(0);
    expect(await panel.version()).toBe(2);
  });

  it('is a database of its own: clearing the cache leaves the memory, and clearing the memory leaves the cache', async () => {
    const factory = new IDBFactory();
    const memory = open(factory);
    const cache = openTranslationCache({ factory }) as TranslationCache;
    await memory.put(edit());
    await cache.putMany(new Map([['k', { text: 'vi', revision: 1, attempt: 1 }]]));
    await cache.clear();
    expect(await memory.count()).toBe(1);
    await cache.putMany(new Map([['k', { text: 'vi', revision: 1, attempt: 1 }]]));
    await memory.clear();
    expect((await cache.stats()).entries).toBe(1);
  });

  it('is undefined without IndexedDB', () => {
    expect(openTranslationMemory({ factory: undefined as never })).toBeUndefined();
  });
});

describe('export and import', () => {
  it('an export re-imports into a fresh profile with the same entries, as imported examples, not overrides', async () => {
    const m = open(undefined, { now: () => 50 });
    await m.put(edit({ origin: 'https://intranet.example', localOnly: true }));
    await m.put(edit({ source: 'Version `v2` is out', target: 'Phiên bản `v2` đã ra mắt' }));
    const out = await m.exportFile(new Date(0));
    expect(out.count).toBe(2);
    // Where an entry was made stays on this device.
    expect(out.json).not.toContain('intranet');
    expect(out.json).not.toContain('localOnly');

    const parsed = parseMemoryImport(out.json, 1000);
    expect(parsed).toMatchObject({ ok: true, skipped: 0 });
    if (!parsed.ok) return;
    const fresh = open(undefined, { now: () => 2000 });
    expect(await fresh.importMany(parsed.entries, { override: false })).toEqual({ stored: 2, kept: 0, full: 0 });
    const rows = await fresh.list('vi', 10);
    expect(rows.map((r) => r.source).sort()).toEqual(['Sign in to your account', 'Version `v2` is out']);
    for (const r of rows) expect(r).toMatchObject({ by: 'import', origin: IMPORT_ORIGIN, localOnly: false, override: false, created: 50, updated: 2000 });
  });

  it('an import ticked "Also replace matching blocks" stores overrides', async () => {
    const parsed = parseMemoryImport(file([entry()]));
    if (!parsed.ok) throw new Error(parsed.error);
    const m = open();
    await m.importMany(parsed.entries, { override: true });
    expect((await m.list('vi', 1))[0]).toMatchObject({ by: 'import', override: true });
  });

  it('never replaces the user’s own edit, and stores only what fits without evicting anything', async () => {
    const m = open(undefined, { maxEntries: 2 });
    await m.put(edit());
    const parsed = parseMemoryImport(file([entry({ target: 'Phiên hết hạn, gọi để xác minh' }), entry({ source: 'Next page', target: 'Trang sau' }), entry({ source: 'Back', target: 'Quay lại' })]));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(await m.importMany(parsed.entries, { override: true })).toEqual({ stored: 1, kept: 1, full: 1 });
    expect((await m.getMany([memoryKey('vi', 'Sign in to your account')])).get(memoryKey('vi', 'Sign in to your account'))).toMatchObject({ by: 'user', target: 'Đăng nhập vào tài khoản' });
    expect(await m.count()).toBe(2);
  });

  it('ignores the provenance and key a file claims for its entries', () => {
    const parsed = parseMemoryImport(file([entry({ key: 'forged', origin: 'https://bank.example', localOnly: true, by: 'user', override: true })]));
    expect(parsed.ok && parsed.entries[0]).toEqual({ key: memoryKey('vi', 'Sign in to your account'), source: 'Sign in to your account', target: 'Đăng nhập vào tài khoản', sourceLang: 'en', targetLang: 'vi', created: 1 });
  });

  it('skips and counts entries that drop a number or a code span, are over-long, hold control characters or are malformed', () => {
    const parsed = parseMemoryImport(
      file([
        entry(),
        entry({ source: 'Pay 120 dollars', target: 'Trả đô la' }),
        entry({ source: 'Run `npm test` first', target: 'Chạy kiểm thử trước' }),
        entry({ source: 'x'.repeat(MAX_MEMORY_TEXT + 1), target: 'y' }),
        entry({ source: 'Hello', target: 'Xin\u0000 chào' }),
        entry({ targetLang: 'not a language' }),
        entry({ sourceLang: 42 }),
        entry({ target: '   ' }),
        'a string',
        null,
      ]),
    );
    expect(parsed).toMatchObject({ ok: true, skipped: 9 });
    expect(parsed.ok && parsed.entries).toHaveLength(1);
  });

  it('counts entries past the cap as skipped, and keeps one entry per source (the last)', () => {
    const many = Array.from({ length: MAX_MEMORY_ENTRIES + 3 }, (_, i) => entry({ source: `Item ${i}`, target: `Mục ${i}` }));
    const parsed = parseMemoryImport(file(many));
    expect(parsed).toMatchObject({ ok: true, skipped: 3 });
    expect(parsed.ok && parsed.entries).toHaveLength(MAX_MEMORY_ENTRIES);
    const twice = parseMemoryImport(file([entry({ target: 'Đăng nhập cũ' }), entry()]));
    expect(twice.ok && twice.entries.map((e) => e.target)).toEqual(['Đăng nhập vào tài khoản']);
  });

  it('a creation time from the future or not a number becomes the import time', () => {
    const parsed = parseMemoryImport(file([entry({ created: 9e15 }), entry({ source: 'Back', target: 'Quay lại', created: 'yesterday' })]), 777);
    expect(parsed.ok && parsed.entries.map((e) => e.created)).toEqual([777, 777]);
  });

  it('rejects an oversize file before parsing it, malformed JSON, and a wrong format or version', () => {
    expect(parseMemoryImport(' '.repeat(MAX_MEMORY_IMPORT_BYTES + 1))).toEqual({ ok: false, error: expect.stringContaining('too large') });
    // Under the cap in characters, over it in bytes.
    expect(parseMemoryImport('é'.repeat(MAX_MEMORY_IMPORT_BYTES / 2 + 1)).ok).toBe(false);
    expect(parseMemoryImport('{nope')).toEqual({ ok: false, error: 'This file is not valid JSON.' });
    expect(parseMemoryImport(JSON.stringify({ format: 'translate-side-settings', formatVersion: 1, entries: [] })).ok).toBe(false);
    expect(parseMemoryImport(file([], { entries: 'x' })).ok).toBe(false);
    expect(parseMemoryImport(file([], { formatVersion: 0 })).ok).toBe(false);
    expect(parseMemoryImport(file([], { formatVersion: '1' })).ok).toBe(false);
    expect(parseMemoryImport(file([], { formatVersion: 2 }))).toEqual({ ok: false, error: expect.stringContaining('newer version') });
  });
});
