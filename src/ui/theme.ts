// The theme, applied before the first paint. storage.sync is asynchronous, so each page keeps a
// mirror of the reading item in localStorage (synchronous on extension pages) and reads it first;
// followTheme then reconciles with storage.sync and keeps the mirror current.
import type { browser } from 'wxt/browser';
import { cleanReading, READING_KEY, type Reading } from '@/shared/reading';

type Browser = typeof browser;

export const READING_MIRROR = 'ts.reading';

/** Sets `data-theme` on <html>; "system" removes it, so the CSS follows prefers-color-scheme. */
export function setTheme(reading: Reading, root: HTMLElement = document.documentElement): void {
  if (reading.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = reading.theme;
}

/** The reading settings as the page's localStorage copy has them (cleaned): what to draw before storage.sync answers. */
export function mirroredReading(): Reading {
  try {
    const raw = localStorage.getItem(READING_MIRROR);
    return cleanReading(raw === null ? undefined : JSON.parse(raw));
  } catch {
    return cleanReading(undefined);
  }
}

function writeMirror(reading: Reading): void {
  try {
    localStorage.setItem(READING_MIRROR, JSON.stringify(reading));
  } catch {
    // A page without storage keeps the system theme until storage.sync answers.
  }
}

/** Applies the mirrored theme synchronously. Each page calls it first, before render. Returns what it applied. */
export function applyThemeSync(root: HTMLElement = document.documentElement): Reading {
  const reading = mirroredReading();
  setTheme(reading, root);
  return reading;
}

/**
 * Reconciles with storage.sync, rewrites the mirror, and follows later changes to the reading
 * item. `onReading` gets every cleaned value (the panel applies typeface, size and width with it).
 * Returns the function that stops following.
 */
export function followTheme(api: Browser, onReading?: (reading: Reading) => void, root: HTMLElement = document.documentElement): () => void {
  let stopped = false;
  const apply = (reading: Reading) => {
    if (stopped) return;
    setTheme(reading, root);
    writeMirror(reading);
    onReading?.(reading);
  };
  const listener = (changes: Record<string, { newValue?: unknown }>) => {
    if (READING_KEY in changes) apply(cleanReading(changes[READING_KEY]?.newValue));
  };
  api.storage.sync.onChanged.addListener(listener);
  // A failed read leaves the mirrored theme as it is rather than resetting it to the defaults.
  api.storage.sync.get(READING_KEY).then(
    (got) => apply(cleanReading(got[READING_KEY])),
    () => undefined,
  );
  return () => {
    stopped = true;
    api.storage.sync.onChanged.removeListener(listener);
  };
}
