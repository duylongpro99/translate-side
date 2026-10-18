import { describe, expect, it } from 'vitest';
import { cleanReading, defaultReading, hasKnownReading, READING_KEY, readReading, updateReading } from './reading';

type Api = Parameters<typeof readReading>[0];

function fakeApi(initial: Record<string, unknown> = {}, failGet = false) {
  const sync = new Map(Object.entries(initial));
  const writes: Record<string, unknown>[] = [];
  const api = {
    storage: {
      sync: {
        get: (k: string) => (failGet ? Promise.reject(new Error('down')) : Promise.resolve(sync.has(k) ? { [k]: structuredClone(sync.get(k)) } : {})),
        set: async (o: Record<string, unknown>) => {
          await new Promise((r) => setTimeout(r, 1));
          writes.push(structuredClone(o));
          for (const [k, v] of Object.entries(structuredClone(o))) sync.set(k, v);
        },
      },
    },
  } as unknown as Api;
  return { api, sync, writes };
}

describe('reading settings', () => {
  it('are system, sans, 16 and medium when nothing is stored', async () => {
    expect(await readReading(fakeApi().api)).toEqual({ theme: 'system', typeface: 'sans', size: 16, width: 'medium' });
  });

  it('clean what they read: unknown values take their default, the size is clamped to an integer from 13 to 24', () => {
    expect(cleanReading({ theme: 'neon', typeface: 'mono', size: 'big', width: 'wide', extra: 1 })).toEqual(defaultReading());
    expect(cleanReading('dark')).toEqual(defaultReading());
    expect(cleanReading([])).toEqual(defaultReading());
    expect(cleanReading(null)).toEqual(defaultReading());
    expect(cleanReading({ size: 99 }).size).toBe(24);
    expect(cleanReading({ size: 2 }).size).toBe(13);
    expect(cleanReading({ size: 17.6 }).size).toBe(18);
    expect(cleanReading({ size: Number.NaN }).size).toBe(16);
    expect(cleanReading({ theme: 'paper', typeface: 'serif', size: 18, width: 'full' })).toEqual({ theme: 'paper', typeface: 'serif', size: 18, width: 'full' });
  });

  it('know whether a value carries anything this build understands', () => {
    expect(hasKnownReading({ theme: 'dark' })).toBe(true);
    expect(hasKnownReading({ size: 30 })).toBe(true);
    expect(hasKnownReading({ theme: 'neon', future: true })).toBe(false);
    expect(hasKnownReading({})).toBe(false);
    expect(hasKnownReading('dark')).toBe(false);
  });

  it('fall back to the defaults when storage cannot be read', async () => {
    expect(await readReading(fakeApi({}, true).api)).toEqual(defaultReading());
  });

  it('write their own sync item, never the preferences', async () => {
    const f = fakeApi({ prefs: { targetLang: 'vi' } });
    await updateReading(f.api, { theme: 'dark' });
    expect(Object.keys(f.writes[0] ?? {})).toEqual([READING_KEY]);
    expect(f.sync.get('prefs')).toEqual({ targetLang: 'vi' });
  });

  it('apply updates one after another, each on what the last wrote, and clamp a written size', async () => {
    const f = fakeApi();
    await Promise.all([updateReading(f.api, { theme: 'paper' }), updateReading(f.api, { size: 40 }), updateReading(f.api, { typeface: 'serif' })]);
    expect(f.sync.get(READING_KEY)).toEqual({ theme: 'paper', typeface: 'serif', size: 24, width: 'medium' });
  });

  it('keep what a newer build wrote: an extra field and an unknown theme survive an unrelated update', async () => {
    const f = fakeApi({ [READING_KEY]: { theme: 'sepia', typeface: 'sans', size: 16, width: 'medium', lineHeight: 1.8 } });
    const next = await updateReading(f.api, { size: 18 });
    expect(f.sync.get(READING_KEY)).toEqual({ theme: 'sepia', typeface: 'sans', size: 18, width: 'medium', lineHeight: 1.8 });
    expect(next).toEqual({ theme: 'system', typeface: 'sans', size: 18, width: 'medium' });
  });
});
