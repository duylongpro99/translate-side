// The preferences and the quality setting as the panel header shows and switches them (plan
// M3-E6): target language, style mode and quality mode. A switch writes storage.sync like the
// options page does; the translator's settings listener then translates the page again (from the
// cache where it can, translator.ts refresh).
import type { browser } from 'wxt/browser';
import { readQuality, updateQuality, QUALITY_KEY, type Quality } from '@/shared/quality';
import { PREFS_KEY, readPreferences, updatePreferences, type Preferences } from '@/shared/settings';

type Browser = typeof browser;

/** One stored value kept in step with storage.sync: read once subscribed, shown at once on a write, put back when it fails. */
class Watched<T> {
  private value: T | undefined;
  private readonly listeners = new Set<(value: T) => void>();

  constructor(
    private readonly read: () => Promise<T>,
    private readonly write: (patch: Partial<T>) => Promise<T>,
  ) {}

  get(): T | undefined {
    return this.value;
  }

  subscribe(fn: (value: T) => void, start: () => void): () => void {
    this.listeners.add(fn);
    start();
    return () => this.listeners.delete(fn);
  }

  async update(patch: Partial<T>): Promise<T> {
    const before = this.value;
    if (before) this.set({ ...before, ...patch });
    try {
      const next = await this.write(patch);
      this.set(next);
      return next;
    } catch (err) {
      const stored = await this.read().catch(() => before);
      if (stored) this.set(stored);
      throw err;
    }
  }

  reload(): void {
    this.read()
      .then((value) => this.set(value))
      .catch(() => {});
  }

  private set(value: T): void {
    this.value = value;
    for (const fn of this.listeners) fn(value);
  }
}

export class PrefsStore {
  private readonly preferences: Watched<Preferences>;
  private readonly qualitySetting: Watched<Quality>;
  private watching = false;

  constructor(private readonly api: Browser) {
    this.preferences = new Watched(
      () => readPreferences(api),
      (patch) => updatePreferences(api, patch),
    );
    this.qualitySetting = new Watched(
      () => readQuality(api),
      (patch) => updateQuality(api, patch),
    );
  }

  get(): Preferences | undefined {
    return this.preferences.get();
  }

  quality(): Quality | undefined {
    return this.qualitySetting.get();
  }

  /** Reads the stored preferences on the first subscription, and follows their changes. */
  subscribe(fn: (prefs: Preferences) => void): () => void {
    return this.preferences.subscribe(fn, () => this.start());
  }

  /** The quality setting, read and followed the same way. */
  subscribeQuality(fn: (quality: Quality) => void): () => void {
    return this.qualitySetting.subscribe(fn, () => this.start());
  }

  /**
   * Writes `patch` (one after another, settings.ts updatePreferences) and shows it at once. A
   * write that fails puts the stored preferences back on screen and rejects, so a switch never
   * shows a language or style that was not saved.
   */
  update(patch: Partial<Preferences>): Promise<Preferences> {
    return this.preferences.update(patch);
  }

  /** The same for the quality setting (quality.ts updateQuality); `strategy: undefined` clears the override. */
  updateQuality(patch: Partial<Quality>): Promise<Quality> {
    return this.qualitySetting.update(patch);
  }

  private start(): void {
    if (this.watching) return;
    this.watching = true;
    this.api.storage.sync.onChanged.addListener((changes: Record<string, unknown>) => {
      if (PREFS_KEY in changes) this.preferences.reload();
      if (QUALITY_KEY in changes) this.qualitySetting.reload();
    });
    this.reloadAll();
  }

  private reloadAll(): void {
    this.preferences.reload();
    this.qualitySetting.reload();
  }
}
