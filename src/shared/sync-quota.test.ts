import { describe, expect, it } from 'vitest';
import { assertFits, fits, isOverflowed, onListChanged, readList, saveListWithOverflow, SYNC_MAX_ITEMS, SYNC_QUOTA_BYTES, SYNC_QUOTA_BYTES_PER_ITEM, syncItemBytes } from './sync-quota.ts';
import { fakeDevice } from './testing.ts';

const flush = () => new Promise((r) => setTimeout(r, 0));
/** A list of `n` strings of `size` characters each. */
const strings = (n: number, size = 40) => Array.from({ length: n }, (_, i) => `${i}`.padEnd(size, 'x'));

describe('sync quota (one guard for every sync write)', () => {
  it('counts bytes as Chrome does: key + JSON, UTF-8, with its fixed limits', () => {
    expect(syncItemBytes('k', 'é')).toBe(1 + 4);
    expect([SYNC_QUOTA_BYTES_PER_ITEM, SYNC_QUOTA_BYTES, SYNC_MAX_ITEMS]).toEqual([8192, 102400, 512]);
  });

  it('fits: the per-item quota, the total (replaced items count once) and the item count', async () => {
    const d = fakeDevice({ sync: Object.fromEntries(strings(12).map((s, i) => [`k${i}`, s.repeat(200)])) });
    expect(await fits(d.api, { a: strings(1, SYNC_QUOTA_BYTES_PER_ITEM)[0] })).toMatchObject({ ok: false, reason: 'item', key: 'a' });
    expect(await fits(d.api, { a: 'x'.repeat(7000) })).toMatchObject({ ok: false, reason: 'total' });
    // Replacing an item frees what it held.
    expect(await fits(d.api, { k0: 'x'.repeat(7000) })).toEqual({ ok: true });
    expect(await fits(d.api, { a: 'x'.repeat(7000) }, ['k1'])).toEqual({ ok: true });
    const many = fakeDevice({ sync: Object.fromEntries(Array.from({ length: SYNC_MAX_ITEMS }, (_, i) => [`k${i}`, 1])) });
    expect(await fits(many.api, { extra: 1 })).toMatchObject({ ok: false, reason: 'items' });
    expect(await fits(many.api, { k3: 2 })).toEqual({ ok: true });
  });

  it('fits counts the stored items itself when the area has no getBytesInUse', async () => {
    const d = fakeDevice({ sync: { big: 'x'.repeat(8000) } });
    delete (d.sync as Partial<typeof d.sync>).getBytesInUse;
    for (let i = 0; i < 12; i++) d.sync.data.set(`f${i}`, 'x'.repeat(8000));
    expect(await fits(d.api, { a: 'x'.repeat(5000) })).toMatchObject({ ok: false, reason: 'total' });
    expect(await fits(d.api, { big: 'x'.repeat(5000) })).toEqual({ ok: true });
  });

  it("assertFits refuses records with a message that says what to do, before Chrome's raw error", async () => {
    const d = fakeDevice();
    await expect(assertFits(d.api, { 'conn:x': 'x'.repeat(9000) })).rejects.toThrow(/over Chrome's sync limit of 8192 bytes for one setting/);
    const full = fakeDevice({ sync: Object.fromEntries(Array.from({ length: SYNC_MAX_ITEMS }, (_, i) => [`k${i}`, 1])) });
    await expect(assertFits(full.api, { 'profile:new': {} })).rejects.toThrow(/limit of 512 items/);
    const heavy = fakeDevice({ sync: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, 'x'.repeat(7800)])) });
    await expect(assertFits(heavy.api, { 'conn:x': 'x'.repeat(2000) })).rejects.toThrow(/102400-byte limit/);
    await expect(assertFits(d.api, { 'conn:x': { id: 'x' } })).resolves.toBeUndefined();
  });
});

describe('a list too large to sync stays on this device', () => {
  it('fits: written to its sync item, as M5 does; nothing local', async () => {
    const d = fakeDevice();
    expect(await saveListWithOverflow(d.api, 'glossary', ['a'])).toEqual({ overflow: false });
    expect(d.sync.data.get('glossary')).toEqual(['a']);
    expect(d.local.data.size).toBe(0);
    expect(await readList(d.api, 'glossary')).toEqual(['a']);
    expect(await readList(d.api, 'siteNever')).toBeUndefined();
  });

  it('too large: the whole list goes to storage.local with its marker, sync keeps the last value that fit; smaller again, back to sync', async () => {
    const d = fakeDevice({ sync: { glossary: ['a'] } });
    const big = strings(400);
    expect(await saveListWithOverflow(d.api, 'glossary', big)).toEqual({ overflow: true });
    expect(d.sync.data.get('glossary')).toEqual(['a']);
    expect(Object.fromEntries(d.local.data)).toEqual({ glossary: big, 'overflow:glossary': true });
    expect(await isOverflowed(d.api, 'glossary')).toBe(true);
    expect(await readList(d.api, 'glossary')).toEqual(big);
    // Still too large: stays here.
    expect(await saveListWithOverflow(d.api, 'glossary', [...big, 'b'])).toEqual({ overflow: true });
    expect(d.sync.data.get('glossary')).toEqual(['a']);
    expect(await saveListWithOverflow(d.api, 'glossary', ['c'])).toEqual({ overflow: false });
    expect(d.sync.data.get('glossary')).toEqual(['c']);
    expect(d.local.data.size).toBe(0);
    expect(await readList(d.api, 'glossary')).toEqual(['c']);
  });

  it('a list that fits its item but not the total stays here too; a sync write Chrome refuses for space as well', async () => {
    const d = fakeDevice({ sync: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, 'x'.repeat(7800)])) });
    expect(await saveListWithOverflow(d.api, 'siteRules', strings(100))).toEqual({ overflow: true });
    const e = fakeDevice();
    e.sync.set = () => Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
    expect(await saveListWithOverflow(e.api, 'siteNever', ['a.com'])).toEqual({ overflow: true });
    expect(await readList(e.api, 'siteNever')).toEqual(['a.com']);
  });

  it('any other sync error (the write-rate limit) fails the save and leaves this device as it was', async () => {
    const d = fakeDevice({ sync: { siteNever: ['old.com'] } });
    d.sync.set = () => Promise.reject(new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded'));
    await expect(saveListWithOverflow(d.api, 'siteNever', ['a.com'])).rejects.toThrow(/MAX_WRITE_OPERATIONS_PER_MINUTE/);
    expect(d.local.data.size).toBe(0);
    expect(await readList(d.api, 'siteNever')).toEqual(['old.com']);
    // Already overflowed: the marker and the local copy stay.
    const o = fakeDevice({ sync: { siteNever: ['old.com'] }, local: { siteNever: ['big.com'], 'overflow:siteNever': true } });
    o.sync.set = () => Promise.reject(new Error('MAX_WRITE_OPERATIONS_PER_HOUR quota exceeded'));
    await expect(saveListWithOverflow(o.api, 'siteNever', ['a.com'])).rejects.toThrow();
    expect(Object.fromEntries(o.local.data)).toEqual({ siteNever: ['big.com'], 'overflow:siteNever': true });
  });

  it('onListChanged follows the list where this device keeps it, and ignores sync edits from elsewhere while it overflows', async () => {
    const d = fakeDevice();
    const seen: [string, unknown][] = [];
    const stop = onListChanged(d.api, ['glossary', 'siteNever'], (k, v) => seen.push([k, v]));
    await saveListWithOverflow(d.api, 'glossary', ['a']);
    await flush();
    expect(seen).toEqual([['glossary', ['a']]]);
    const big = strings(400);
    await saveListWithOverflow(d.api, 'glossary', big);
    await flush();
    expect(seen.at(-1)).toEqual(['glossary', big]);
    seen.length = 0;
    // Another device edits the synced glossary: this device keeps its own.
    await d.sync.set({ glossary: ['other device'] });
    await d.sync.set({ prefs: {} });
    await flush();
    expect(seen).toEqual([]);
    await saveListWithOverflow(d.api, 'glossary', ['small']);
    await flush();
    expect(seen.at(-1)).toEqual(['glossary', ['small']]);
    await saveListWithOverflow(d.api, 'siteNever', ['x.com']);
    await flush();
    expect(seen.at(-1)).toEqual(['siteNever', ['x.com']]);
    stop();
    seen.length = 0;
    await saveListWithOverflow(d.api, 'siteNever', ['y.com']);
    await flush();
    expect(seen).toEqual([]);
  });
});
