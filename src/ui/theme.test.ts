// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyThemeSync, followTheme, READING_MIRROR, setTheme } from './theme';
import { defaultReading, READING_KEY } from '@/shared/reading';

type Api = Parameters<typeof followTheme>[0];
type Listener = (changes: Record<string, { newValue?: unknown }>) => void;

function fakeApi(stored?: unknown, failGet = false) {
  const listeners = new Set<Listener>();
  const api = {
    storage: {
      sync: {
        get: (k: string) => (failGet ? Promise.reject(new Error('down')) : Promise.resolve(stored === undefined ? {} : { [k]: stored })),
        onChanged: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) },
      },
    },
  } as unknown as Api;
  return { api, listeners, fire: (changes: Record<string, { newValue?: unknown }>) => listeners.forEach((l) => l(changes)) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const root = document.documentElement;

beforeEach(() => {
  localStorage.clear();
  delete root.dataset.theme;
});

describe('theme', () => {
  it('sets data-theme for light, paper and dark, and removes it for system', () => {
    for (const theme of ['light', 'paper', 'dark'] as const) {
      setTheme({ ...defaultReading(), theme });
      expect(root.dataset.theme).toBe(theme);
    }
    setTheme(defaultReading());
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('applies the mirrored theme synchronously, before anything renders', () => {
    localStorage.setItem(READING_MIRROR, JSON.stringify({ theme: 'paper', typeface: 'serif', size: 18, width: 'full' }));
    const applied = applyThemeSync();
    expect(root.dataset.theme).toBe('paper');
    expect(applied).toEqual({ theme: 'paper', typeface: 'serif', size: 18, width: 'full' });
  });

  it('falls back to the system theme when the mirror is missing, corrupt or unknown', () => {
    root.dataset.theme = 'dark';
    expect(applyThemeSync()).toEqual(defaultReading());
    expect(root.hasAttribute('data-theme')).toBe(false);
    localStorage.setItem(READING_MIRROR, '{not json');
    expect(applyThemeSync()).toEqual(defaultReading());
    localStorage.setItem(READING_MIRROR, JSON.stringify({ theme: 'neon', size: 'x' }));
    expect(applyThemeSync()).toEqual(defaultReading());
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('reconciles a stale mirror with storage.sync and rewrites the mirror', async () => {
    localStorage.setItem(READING_MIRROR, JSON.stringify({ theme: 'paper' }));
    applyThemeSync();
    const f = fakeApi({ theme: 'dark', size: 99 });
    const seen: unknown[] = [];
    followTheme(f.api, (r) => seen.push(r));
    await flush();
    expect(root.dataset.theme).toBe('dark');
    expect(JSON.parse(localStorage.getItem(READING_MIRROR) ?? '')).toEqual({ theme: 'dark', typeface: 'sans', size: 24, width: 'medium' });
    expect(seen).toEqual([{ theme: 'dark', typeface: 'sans', size: 24, width: 'medium' }]);
  });

  it('follows later changes to the reading item only, cleaned, until stopped', async () => {
    const f = fakeApi();
    const seen: unknown[] = [];
    const stop = followTheme(f.api, (r) => seen.push(r));
    await flush();
    f.fire({ prefs: { newValue: { targetLang: 'de' } } });
    expect(seen).toHaveLength(1);
    f.fire({ [READING_KEY]: { newValue: { theme: 'light', typeface: 'comic' } } });
    expect(root.dataset.theme).toBe('light');
    expect(seen[1]).toEqual({ ...defaultReading(), theme: 'light' });
    f.fire({ [READING_KEY]: {} });
    expect(root.hasAttribute('data-theme')).toBe(false);
    stop();
    expect(f.listeners.size).toBe(0);
  });

  it('keeps the mirrored theme when storage.sync cannot be read', async () => {
    localStorage.setItem(READING_MIRROR, JSON.stringify({ theme: 'paper' }));
    applyThemeSync();
    followTheme(fakeApi(undefined, true).api);
    await flush();
    expect(root.dataset.theme).toBe('paper');
    expect(JSON.parse(localStorage.getItem(READING_MIRROR) ?? '')).toEqual({ theme: 'paper' });
  });
});
