// First-run privacy notice (DESIGN.md §8, plan M3-E10): page text goes to the chosen provider, so
// the panel says so once before it sends anything. Until the notice is acknowledged, a page is read
// (locally) and shown as the original, but no translation starts; the work waiting for it runs as
// soon as it is acknowledged. The jobs ask for it once their route is resolved (jobs.ts), and only a
// route that sends text off the device waits: on-device translation needs no notice, so the panel
// shows it only while something waits (`waiting`). The acknowledgement is kept in storage.local (this device): it is not
// a secret, but which provider gets the text is a per-device choice until settings sync (M4).
import type { browser } from 'wxt/browser';

type Browser = typeof browser;

export const PRIVACY_KEY = 'privacyNotice';
/** Bump when the notice says something new that must be shown again. */
export const PRIVACY_NOTICE_VERSION = 3;

export type PrivacyState = 'unknown' | 'needed' | 'acknowledged';

const isAck = (value: unknown) => typeof value === 'object' && value !== null && (value as { version?: unknown }).version === PRIVACY_NOTICE_VERSION;

export class PrivacyGate {
  private current: PrivacyState = 'unknown';
  private readonly listeners = new Set<(state: PrivacyState) => void>();
  /** Work held until the notice is acknowledged, one per key (a newer one replaces it). */
  private readonly waiting = new Map<string, () => void>();

  constructor(private readonly api: Browser) {
    api.storage.local.onChanged.addListener((changes: Record<string, { newValue?: unknown }>) => {
      // Acknowledged in another panel window (or reset, e.g. by clearing the extension's storage).
      if (PRIVACY_KEY in changes) this.set(isAck(changes[PRIVACY_KEY]?.newValue) ? 'acknowledged' : 'needed');
    });
    api.storage.local
      .get(PRIVACY_KEY)
      .then((got) => {
        if (this.current === 'unknown') this.set(isAck(got[PRIVACY_KEY]) ? 'acknowledged' : 'needed');
      })
      // Storage that can't be read: show the notice (the safe side), and acknowledging it still works.
      .catch(() => {
        if (this.current === 'unknown') this.set('needed');
      });
  }

  get state(): PrivacyState {
    return this.current;
  }

  /** Is any work held for the notice (the panel shows it only then)? */
  get pending(): boolean {
    return this.waiting.size > 0;
  }

  /** Called when the state changes, and when work starts or stops waiting (`pending`). */
  subscribe(fn: (state: PrivacyState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Runs `fn` now if the notice was acknowledged, else when it is. A later call with the same key replaces a held one. */
  whenAcknowledged(key: string, fn: () => void): void {
    if (this.current === 'acknowledged') {
      this.forget(key);
      fn();
      return;
    }
    const was = this.waiting.size;
    this.waiting.set(key, fn);
    if (was === 0) this.notify();
  }

  /** Drops held work (its page or tab went away). */
  forget(key: string): void {
    if (this.waiting.delete(key) && this.waiting.size === 0) this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.current);
  }

  /** The notice's button. Releases the held work at once, then persists. */
  acknowledge(): Promise<void> {
    this.set('acknowledged');
    return this.api.storage.local.set({ [PRIVACY_KEY]: { version: PRIVACY_NOTICE_VERSION, at: Date.now() } });
  }

  private set(state: PrivacyState): void {
    if (state === this.current) return;
    this.current = state;
    const held = state === 'acknowledged' ? [...this.waiting.values()] : [];
    if (state === 'acknowledged') this.waiting.clear();
    this.notify();
    for (const fn of held) fn();
  }
}
