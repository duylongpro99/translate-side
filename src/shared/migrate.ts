// Settings schema migrations (DESIGN.md §4.3.1). storage.sync carries one version,
// `schemaVersion` (providers.ts); each step brings it one version on, in order, and exists only
// where a stored shape changes. Per-device state (storage.local) has no version of its own: the
// provider migration's `migratedRoute` marker says this device was migrated (providers.ts).
//
// - One runner at a time across this extension's contexts (worker, panel, options): it holds a
//   Web Lock and reads storage inside it.
// - Every write is compare-and-set against what was read in the lock: an item that changed since
//   (a save in another context, a sync download) is left as it is.
// - A step with nothing to migrate writes nothing, not even the version: a fresh device must never
//   write over items sync has not downloaded yet (another device's newer version among them).
// - A stored version newer than this build knows leaves storage untouched.
import type { browser } from 'wxt/browser';

type Browser = typeof browser;
type Area = Pick<Browser['storage']['local'], 'get' | 'set'>;

export const MIGRATION_LOCK = 'translate-side-migrate';

let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs `task` holding the migration lock. Without Web Locks (not expected in Chrome 138 contexts)
 * tasks in this context run one after another instead: each reads what the one before wrote.
 */
export function withMigrationLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  if (locks) return locks.request(MIGRATION_LOCK, task);
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

export interface MigrationStep {
  /** The schema version this step brings storage.sync to. */
  version: number;
  /** The sync items to set, from `items` (storage.sync as the earlier steps left it). {} when there is nothing to migrate. */
  patch(api: Browser, items: Record<string, unknown>): Promise<Record<string, unknown>>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Sets each item of `patch` only when the area still holds what `expected` says (absent when
 * `expected` lacks it); nothing at all when the `guard` item changed. Returns the items written.
 */
export async function compareAndSet(area: Area, expected: Record<string, unknown>, patch: Record<string, unknown>, guard?: string): Promise<Record<string, unknown>> {
  const keys = [...new Set([...Object.keys(patch), ...(guard === undefined ? [] : [guard])])];
  const now = await area.get(keys);
  const unchanged = (k: string) => (k in expected ? k in now && same(now[k], expected[k]) : !(k in now));
  if (guard !== undefined && !unchanged(guard)) return {};
  const write = Object.fromEntries(Object.entries(patch).filter(([k]) => unchanged(k)));
  if (Object.keys(write).length > 0) await area.set(write);
  return write;
}

/**
 * Brings storage.sync to the last step's version and returns it as migrated, the version included
 * (also when nothing had to be written). Call it inside withMigrationLock. A failed write (quota,
 * sync off) leaves storage as it was: the result still applies, and the next run tries again.
 */
export async function migrateSync(api: Browser, versionKey: string, steps: readonly MigrationStep[]): Promise<Record<string, unknown>> {
  const read = await api.storage.sync.get(null);
  const stored = read[versionKey];
  const latest = steps.at(-1)?.version ?? 0;
  if (typeof stored === 'number' && stored >= latest) return read;
  let items = read;
  let version = typeof stored === 'number' ? stored : 0;
  for (const step of steps) {
    if (step.version <= version) continue;
    const patch = await step.patch(api, items);
    if (Object.keys(patch).length > 0) {
      try {
        const written = await compareAndSet(api.storage.sync, items, { ...patch, [versionKey]: step.version }, versionKey);
        // Someone else moved the version on meanwhile: what they wrote is the truth.
        if (!(versionKey in written)) return migrateAgain(api, versionKey, latest);
      } catch (err) {
        console.warn('[translate-side] could not save the migrated settings', err);
      }
    }
    // The version goes with the step: the next step's guard expects what this one wrote.
    items = { ...items, ...patch, ...(Object.keys(patch).length > 0 ? { [versionKey]: step.version } : {}) };
    version = step.version;
  }
  return { ...items, [versionKey]: version };
}

/** storage.sync as it is now, its version at least `latest` (another runner migrated it). */
async function migrateAgain(api: Browser, versionKey: string, latest: number): Promise<Record<string, unknown>> {
  const items = await api.storage.sync.get(null);
  return typeof items[versionKey] === 'number' ? items : { ...items, [versionKey]: latest };
}
