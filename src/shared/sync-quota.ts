// chrome.storage.sync quota (DESIGN.md §4.3.1, plan M6-E6): the one place that counts sync bytes,
// and the overflow of a list that no longer fits.
//
// A list (the glossary, the site rules, the site allow and never lists) stays one sync item under
// its key, as M5 wrote it, while it fits. When a save would not fit (8 KB per item, 100 KB in all,
// 512 items), the whole list goes to this device's storage.local under the same key, with the
// marker `overflow:<key>` = true there, and the sync item keeps the last value that fit: other
// devices (an M5 build included) keep the synced version and lose nothing. Reads on this device
// take the local copy while the marker is set. A save that fits again goes to sync and clears the
// marker and the local copy. While a device is in overflow, sync edits made elsewhere to that list
// are not merged into it (the notice says so).
// Nothing is written to sync for the overflow itself: a pointer or index item would reach every
// device, and an index conflicts with records found by key prefix (providers.ts header).
import type { browser } from 'wxt/browser';

type Browser = typeof browser;

/** chrome.storage.sync.QUOTA_BYTES_PER_ITEM, QUOTA_BYTES and MAX_ITEMS (fixed by Chrome). */
export const SYNC_QUOTA_BYTES_PER_ITEM = 8192;
export const SYNC_QUOTA_BYTES = 102400;
export const SYNC_MAX_ITEMS = 512;

export const OVERFLOW_PREFIX = 'overflow:';
export const overflowKey = (key: string) => `${OVERFLOW_PREFIX}${key}`;

/** What Options shows for a list kept on this device. */
export const OVERFLOW_NOTICE = 'Too large to sync. Changes stay on this device; other devices keep the last synced version.';

/** Bytes chrome.storage.sync counts for one item: the key plus the value's JSON, in UTF-8. */
export function syncItemBytes(key: string, value: unknown): number {
  return new TextEncoder().encode(key + JSON.stringify(value)).length;
}

export type QuotaCheck = { ok: true } | { ok: false; reason: 'item' | 'total' | 'items'; key?: string; bytes: number };

/**
 * Would setting `items` (and removing `removed`) in one write fit chrome.storage.sync? The per-item
 * quota, the item count and the total, as Chrome counts them.
 */
export async function fits(api: Browser, items: Record<string, unknown>, removed: readonly string[] = []): Promise<QuotaCheck> {
  for (const [key, value] of Object.entries(items)) {
    const bytes = syncItemBytes(key, value);
    if (bytes > SYNC_QUOTA_BYTES_PER_ITEM) return { ok: false, reason: 'item', key, bytes };
  }
  const stored = await api.storage.sync.get(null);
  const gone = new Set([...Object.keys(items), ...removed].filter((k) => k in stored));
  const count = Object.keys(stored).length + Object.keys(items).filter((k) => !(k in stored)).length - removed.filter((k) => k in stored).length;
  if (count > SYNC_MAX_ITEMS) return { ok: false, reason: 'items', bytes: count };
  const sync = api.storage.sync as { getBytesInUse?: (keys?: string | string[] | null) => Promise<number> };
  const inUse = async (keys: string[] | null) =>
    typeof sync.getBytesInUse === 'function' ? sync.getBytesInUse(keys) : Object.entries(stored).filter(([k]) => keys === null || keys.includes(k)).reduce((n, [k, v]) => n + syncItemBytes(k, v), 0);
  const [total, current] = await Promise.all([inUse(null), gone.size > 0 ? inUse([...gone]) : 0]);
  const next = Object.entries(items).reduce((n, [k, v]) => n + syncItemBytes(k, v), 0);
  if (total - current + next > SYNC_QUOTA_BYTES) return { ok: false, reason: 'total', bytes: total - current + next };
  return { ok: true };
}

/**
 * Refuses a write of records that cannot overflow (connections, profiles, routing, preferences)
 * when it would not fit: it would fail anyway, with a raw error. `removed`: keys the same write drops.
 */
export async function assertFits(api: Browser, items: Record<string, unknown>, removed: readonly string[] = []): Promise<void> {
  const check = await fits(api, items, removed);
  if (check.ok) return;
  if (check.reason === 'item') throw new Error(`This setting would take ${check.bytes} bytes, over Chrome's sync limit of ${SYNC_QUOTA_BYTES_PER_ITEM} bytes for one setting. Shorten it (fewer extra headers or a shorter label).`);
  if (check.reason === 'items') throw new Error(`Synced settings would exceed Chrome's limit of ${SYNC_MAX_ITEMS} items. Remove some connections, models or site rules.`);
  throw new Error(`Synced settings would exceed Chrome's ${SYNC_QUOTA_BYTES}-byte limit. Remove some connections, models, site rules or glossary entries.`);
}

/** Is the list under `key` kept on this device (its overflow marker set)? */
export async function isOverflowed(api: Browser, key: string): Promise<boolean> {
  return (await api.storage.local.get(overflowKey(key)))[overflowKey(key)] === true;
}

/** The list under `key` as this device uses it: the local copy while it overflows, else the sync item. Undefined when there is none. */
export async function readList(api: Browser, key: string): Promise<unknown> {
  // Both at once: a read of the sync item never waits on the local marker.
  const [local, synced] = await Promise.all([isOverflowed(api, key), (async () => api.storage.sync.get(key))()]);
  return local ? (await api.storage.local.get(key))[key] : synced[key];
}

/**
 * Saves a list: to its sync item when it fits, else to this device (see the header). A sync write
 * that fails anyway (Chrome's own quota or write-rate errors) falls back to this device too, so a
 * save never fails for want of sync space. Returns whether the list is now kept on this device.
 */
export async function saveListWithOverflow(api: Browser, key: string, value: unknown): Promise<{ overflow: boolean }> {
  if ((await fits(api, { [key]: value })).ok) {
    try {
      await api.storage.sync.set({ [key]: value });
      if (await isOverflowed(api, key)) await api.storage.local.remove([key, overflowKey(key)]);
      return { overflow: false };
    } catch (err) {
      console.warn(`[translate-side] could not sync ${key}; keeping it on this device`, err);
    }
  }
  await api.storage.local.set({ [key]: value, [overflowKey(key)]: true });
  return { overflow: true };
}

type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;

/**
 * Calls `cb(key, value)` when a list in `keys` changes as this device sees it (readList): its sync
 * item while it does not overflow, its local copy or marker otherwise. Returns the unsubscribe.
 */
export function onListChanged(api: Browser, keys: readonly string[], cb: (key: string, value: unknown) => void): () => void {
  const report = (key: string) =>
    void readList(api, key).then(
      (value) => cb(key, value),
      (err: unknown) => console.warn(`[translate-side] could not read ${key}`, err),
    );
  const onSync = (changes: Changes) => {
    for (const key of keys) {
      if (!(key in changes)) continue;
      // A sync edit made elsewhere does not reach a list this device keeps (the accepted limit).
      void isOverflowed(api, key).then(
        (local) => {
          if (!local) cb(key, changes[key]?.newValue);
        },
        () => cb(key, changes[key]?.newValue),
      );
    }
  };
  const onLocal = (changes: Changes) => {
    for (const key of keys) if (key in changes || overflowKey(key) in changes) report(key);
  };
  api.storage.sync.onChanged.addListener(onSync);
  api.storage.local.onChanged.addListener(onLocal);
  return () => {
    api.storage.sync.onChanged.removeListener(onSync);
    api.storage.local.onChanged.removeListener(onLocal);
  };
}
