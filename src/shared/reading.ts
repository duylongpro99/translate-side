// Reading settings: the theme (every page) and the panel's typeface, text size and line width.
// It is its own storage.sync item, never a field of `prefs`: the translator's settings key holds
// `prefs` (translator.ts), so a reading field there would translate the page again on every change.
import type { browser } from 'wxt/browser';

type Browser = typeof browser;

export const READING_KEY = 'reading';

export type ReadingTheme = 'system' | 'light' | 'paper' | 'dark';
export type ReadingTypeface = 'sans' | 'serif';
export type ReadingWidth = 'narrow' | 'medium' | 'full';

export interface Reading {
  theme: ReadingTheme;
  typeface: ReadingTypeface;
  /** The reading text's size in px, an integer from READING_SIZE_MIN to READING_SIZE_MAX. */
  size: number;
  width: ReadingWidth;
}

export const READING_THEMES: readonly ReadingTheme[] = ['system', 'light', 'paper', 'dark'];
export const READING_TYPEFACES: readonly ReadingTypeface[] = ['sans', 'serif'];
export const READING_WIDTHS: readonly ReadingWidth[] = ['narrow', 'medium', 'full'];
export const READING_SIZE_MIN = 13;
export const READING_SIZE_MAX = 24;

export const defaultReading = (): Reading => ({ theme: 'system', typeface: 'sans', size: 16, width: 'medium' });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSize = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampSize = (n: number) => Math.min(READING_SIZE_MAX, Math.max(READING_SIZE_MIN, Math.round(n)));

/** A stored, mirrored or imported value, cleaned: each unknown field takes its default, a size is clamped to an integer in range. */
export function cleanReading(raw: unknown): Reading {
  const out = defaultReading();
  if (!isRecord(raw)) return out;
  const { theme, typeface, size, width } = raw;
  if (READING_THEMES.includes(theme as ReadingTheme)) out.theme = theme as ReadingTheme;
  if (READING_TYPEFACES.includes(typeface as ReadingTypeface)) out.typeface = typeface as ReadingTypeface;
  if (isSize(size)) out.size = clampSize(size);
  if (READING_WIDTHS.includes(width as ReadingWidth)) out.width = width as ReadingWidth;
  return out;
}

/** Whether `raw` carries at least one value this build understands (an import of nothing else is skipped). */
export function hasKnownReading(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const { theme, typeface, size, width } = raw;
  return READING_THEMES.includes(theme as ReadingTheme) || READING_TYPEFACES.includes(typeface as ReadingTypeface) || isSize(size) || READING_WIDTHS.includes(width as ReadingWidth);
}

export async function readReading(api: Browser): Promise<Reading> {
  try {
    return cleanReading((await api.storage.sync.get(READING_KEY))[READING_KEY]);
  } catch {
    return defaultReading();
  }
}

let write: Promise<unknown> = Promise.resolve();

/**
 * Applies `patch` to the stored item. Updates run one after another, each on what the last one
 * wrote. The patch lands on the raw stored record, so fields a newer build wrote (and this one
 * does not know) survive; only what the patch names is overwritten. Returns the cleaned result.
 */
export function updateReading(api: Browser, patch: Partial<Reading>): Promise<Reading> {
  const run = write.then(async () => {
    const stored = (await api.storage.sync.get(READING_KEY))[READING_KEY];
    const next: Record<string, unknown> = isRecord(stored) ? { ...defaultReading(), ...stored } : { ...defaultReading() };
    if (patch.theme !== undefined && READING_THEMES.includes(patch.theme)) next.theme = patch.theme;
    if (patch.typeface !== undefined && READING_TYPEFACES.includes(patch.typeface)) next.typeface = patch.typeface;
    if (isSize(patch.size)) next.size = clampSize(patch.size);
    if (patch.width !== undefined && READING_WIDTHS.includes(patch.width)) next.width = patch.width;
    await api.storage.sync.set({ [READING_KEY]: next });
    return cleanReading(next);
  });
  write = run.catch(() => undefined);
  return run;
}
