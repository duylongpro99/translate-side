import { useEffect, useState } from 'preact/hooks';
import type { browser } from 'wxt/browser';
import { defaultReading, READING_KEY, readReading, type Reading } from '@/shared/reading';

type Browser = typeof browser;

/** The reading settings, read once and again on every change (every value cleaned by readReading). */
export function useReading(api: Browser): Reading {
  const [reading, setReading] = useState<Reading>(defaultReading);
  useEffect(() => {
    let live = true;
    void readReading(api).then((r) => live && setReading(r));
    // Read again rather than trusting the event's value: the stored item is the one source.
    const on = (changes: Record<string, unknown>) => {
      if (READING_KEY in changes) void readReading(api).then((r) => live && setReading(r));
    };
    api.storage.sync.onChanged.addListener(on);
    return () => {
      live = false;
      api.storage.sync.onChanged.removeListener(on);
    };
  }, [api]);
  return reading;
}
