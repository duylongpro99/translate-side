// The preferences as the panel header shows and switches them (plan M3-E6): target language and
// style mode. A switch writes storage.sync like the options page does; the translator's settings
// listener then translates the page again (from the cache where it can, translator.ts refresh).
import type { browser } from 'wxt/browser';
import { PREFS_KEY, readPreferences, updatePreferences, type Preferences } from '@/shared/settings';

type Browser = typeof browser;

export class PrefsStore {
  private value: Preferences | undefined;
  private readonly listeners = new Set<(prefs: Preferences) => void>();
  private watching = false;

  constructor(private readonly api: Browser) {}

  get(): Preferences | undefined {
    return this.value;
  }

  /** Reads the stored preferences on the first subscription, and follows their changes. */
  subscribe(fn: (prefs: Preferences) => void): () => void {
    this.listeners.add(fn);
    if (!this.watching) {
      this.watching = true;
      this.api.storage.sync.onChanged.addListener((changes: Record<string, unknown>) => {
        if (PREFS_KEY in changes) this.reload();
      });
      this.reload();
    }
    return () => this.listeners.delete(fn);
  }

  /**
   * Writes `patch` (one after another, settings.ts updatePreferences) and shows it at once. A
   * write that fails puts the stored preferences back on screen and rejects, so a switch never
   * shows a language or style that was not saved.
   */
  async update(patch: Partial<Preferences>): Promise<Preferences> {
    const before = this.value;
    if (before) this.set({ ...before, ...patch });
    try {
      const next = await updatePreferences(this.api, patch);
      this.set(next);
      return next;
    } catch (err) {
      const stored = await readPreferences(this.api).catch(() => before);
      if (stored) this.set(stored);
      throw err;
    }
  }

  private reload(): void {
    readPreferences(this.api)
      .then((prefs) => this.set(prefs))
      .catch(() => {});
  }

  private set(prefs: Preferences): void {
    this.value = prefs;
    for (const fn of this.listeners) fn(prefs);
  }
}
