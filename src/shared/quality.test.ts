import { describe, expect, it } from 'vitest';
import { BEST_MODE_RELEASED, cleanQuality, defaultQuality, QUALITY_KEY, readQuality, requestedStrategy, updateQuality } from './quality';

type Api = Parameters<typeof readQuality>[0];

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

describe('quality setting', () => {
  it('is Balanced with nothing kept when nothing is stored, and the release switch defaults on', async () => {
    expect(await readQuality(fakeApi().api)).toEqual({ mode: 'balanced', keepDraftsOnScreen: false });
    expect(BEST_MODE_RELEASED).toBe(true);
  });

  it('cleans what it reads: an unknown mode is Balanced, an unknown strategy is none, other fields are dropped', () => {
    expect(cleanQuality({ mode: 'turbo', strategy: 'magic', keepDraftsOnScreen: 'yes', extra: 1 })).toEqual(defaultQuality());
    expect(cleanQuality('best')).toEqual(defaultQuality());
    expect(cleanQuality([])).toEqual(defaultQuality());
    expect(cleanQuality({ mode: 'best', strategy: 'single-pass', keepDraftsOnScreen: true })).toEqual({ mode: 'best', strategy: 'single-pass', keepDraftsOnScreen: true });
  });

  it('falls back to the default when storage cannot be read', async () => {
    expect(await readQuality(fakeApi({}, true).api)).toEqual(defaultQuality());
  });

  it('asks for the mode\'s strategy, or the override when one is set, and never consults features', () => {
    expect(requestedStrategy({ mode: 'fast', keepDraftsOnScreen: false })).toBe('single-pass');
    expect(requestedStrategy({ mode: 'balanced', keepDraftsOnScreen: false })).toBe('contextual');
    expect(requestedStrategy({ mode: 'best', keepDraftsOnScreen: false })).toBe('refine');
    expect(requestedStrategy({ mode: 'balanced', strategy: 'refine', keepDraftsOnScreen: false })).toBe('refine');
    expect(requestedStrategy({ mode: 'best', strategy: 'single-pass', keepDraftsOnScreen: false })).toBe('single-pass');
  });

  it('writes its own sync item, never the preferences', async () => {
    const f = fakeApi({ prefs: { targetLang: 'vi' } });
    await updateQuality(f.api, { mode: 'best' });
    expect(Object.keys(f.writes[0] ?? {})).toEqual([QUALITY_KEY]);
    expect(f.sync.get('prefs')).toEqual({ targetLang: 'vi' });
  });

  it('applies updates one after another, each on what the last wrote, and clears the override with undefined', async () => {
    const f = fakeApi();
    await Promise.all([updateQuality(f.api, { strategy: 'refine' }), updateQuality(f.api, { keepDraftsOnScreen: true }), updateQuality(f.api, { mode: 'fast' })]);
    expect(f.sync.get(QUALITY_KEY)).toEqual({ mode: 'fast', strategy: 'refine', keepDraftsOnScreen: true });
    await updateQuality(f.api, { mode: 'best', strategy: undefined });
    expect(f.sync.get(QUALITY_KEY)).toEqual({ mode: 'best', keepDraftsOnScreen: true });
    expect('strategy' in (f.sync.get(QUALITY_KEY) as object)).toBe(false);
  });
});
