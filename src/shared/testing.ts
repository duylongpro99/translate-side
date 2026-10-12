// A chrome.storage fake for the storage tests: get / set / remove / getBytesInUse and onChanged as
// Chrome answers them, and storage.sync refusing a write over Chrome's limits (8,192 bytes per
// item, 102,400 in all, 512 items) with Chrome's own messages. `slow` answers each call on a later
// task, so two callers interleave at every await.
import type { browser } from 'wxt/browser';
import { SYNC_MAX_ITEMS, SYNC_QUOTA_BYTES, SYNC_QUOTA_BYTES_PER_ITEM, syncItemBytes } from './sync-quota.ts';

type Browser = typeof browser;
type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;

export interface FakeArea {
  data: Map<string, unknown>;
  /** The keys of each set call, in order. */
  sets: string[][];
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  getBytesInUse(keys?: string | string[] | null): Promise<number>;
  onChanged: { addListener(fn: (c: Changes) => void): void; removeListener(fn: (c: Changes) => void): void };
}

export function fakeArea(initial: Record<string, unknown> = {}, { quota = false, slow = false } = {}): FakeArea {
  const data = new Map<string, unknown>(Object.entries(structuredClone(initial)));
  const listeners = new Set<(c: Changes) => void>();
  const sets: string[][] = [];
  const later = () => (slow ? new Promise<void>((r) => setTimeout(r, 0)) : Promise.resolve());
  const list = (keys: string | string[] | null | undefined) => (keys === null || keys === undefined ? [...data.keys()] : typeof keys === 'string' ? [keys] : keys);
  const notify = (changes: Changes) => {
    if (Object.keys(changes).length > 0) for (const fn of listeners) fn(structuredClone(changes));
  };
  return {
    data,
    sets,
    async get(keys) {
      await later();
      return structuredClone(Object.fromEntries(list(keys).filter((k) => data.has(k)).map((k) => [k, data.get(k)])));
    },
    async set(items) {
      await later();
      if (quota) {
        const next = new Map([...data, ...Object.entries(items)]);
        for (const [k, v] of Object.entries(items)) if (syncItemBytes(k, v) > SYNC_QUOTA_BYTES_PER_ITEM) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
        if (next.size > SYNC_MAX_ITEMS) throw new Error('MAX_ITEMS quota exceeded');
        if ([...next].reduce((n, [k, v]) => n + syncItemBytes(k, v), 0) > SYNC_QUOTA_BYTES) throw new Error('QUOTA_BYTES quota exceeded');
      }
      sets.push(Object.keys(items));
      const changes: Changes = {};
      for (const [k, v] of Object.entries(structuredClone(items))) {
        changes[k] = { ...(data.has(k) ? { oldValue: data.get(k) } : {}), newValue: v };
        data.set(k, v);
      }
      notify(changes);
    },
    async remove(keys) {
      await later();
      const changes: Changes = {};
      for (const k of list(keys)) {
        if (!data.has(k)) continue;
        changes[k] = { oldValue: data.get(k) };
        data.delete(k);
      }
      notify(changes);
    },
    async getBytesInUse(keys) {
      await later();
      return list(keys)
        .filter((k) => data.has(k))
        .reduce((n, k) => n + syncItemBytes(k, data.get(k)), 0);
    },
    onChanged: { addListener: (fn) => void listeners.add(fn), removeListener: (fn) => void listeners.delete(fn) },
  };
}

export interface FakeDevice {
  api: Browser;
  sync: FakeArea;
  local: FakeArea;
  session: FakeArea;
}

/** One browser profile: `sync` may be another device's, to share one synced storage between two. */
export function fakeDevice(shape: { sync?: Record<string, unknown>; local?: Record<string, unknown>; session?: Record<string, unknown> } = {}, { sync, slow = false }: { sync?: FakeArea; slow?: boolean } = {}): FakeDevice {
  const areas = { sync: sync ?? fakeArea(shape.sync, { quota: true, slow }), local: fakeArea(shape.local, { slow }), session: fakeArea(shape.session, { slow }) };
  const api = {
    storage: areas,
    permissions: { contains: () => Promise.resolve(true), remove: () => Promise.resolve(true) },
    i18n: { getUILanguage: () => 'en' },
  } as unknown as Browser;
  return { api, ...areas };
}
