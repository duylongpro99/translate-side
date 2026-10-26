// The selection button on every site (DESIGN.md §3, §8; decision S9): an opt-in, off by default.
// Turning it on asks for the optional host permissions the manifest already declares (both broad
// patterns), then registers a small script that draws only the selection button
// (src/entrypoints/selection.content.ts). Nothing is read or sent until the reader clicks the button.
//
// The script is registered exactly when the setting is on and the permission is held: the worker
// reconciles the two on start, on install and whenever either changes, since the permission can be
// removed in chrome://extensions. Turning the option off unregisters the script but does not give the
// permission back: S9 could not show that removing the broad patterns leaves a provider's or an
// allowlisted site's own grant alone, and losing those would break translation.
import type { browser } from 'wxt/browser';
import { DENYLISTED_HOSTS } from './denylist.ts';
import { readSiteLists, SITE_NEVER_KEY } from './sites.ts';
import { onListChanged } from './sync-quota.ts';

type Browser = typeof browser;

/**
 * The option's storage.local item: per device, like the access it needs (Chrome grants host
 * permissions per device), so it is neither synced nor exported.
 */
export const SELECTION_EVERYWHERE_KEY = 'selectionEverywhere';
/** The optional host permissions the option asks for (wxt.config.ts optional_host_permissions). */
export const BROAD_ORIGINS = ['https://*/*', 'http://*/*'];
export const SELECTION_SCRIPT_ID = 'selection-button';
/** Output path of src/entrypoints/selection.content.ts (a runtime-registered WXT content script). */
export const SELECTION_SCRIPT_FILE = '/content-scripts/selection.js';

export async function readSelectionEverywhere(api: Browser): Promise<boolean> {
  const got = await api.storage.local.get(SELECTION_EVERYWHERE_KEY);
  return got[SELECTION_EVERYWHERE_KEY] === true;
}

/** Whether both broad patterns are granted. */
export function holdsBroadAccess(api: Browser): Promise<boolean> {
  return api.permissions.contains({ origins: BROAD_ORIGINS }).catch(() => false);
}

/**
 * The permission prompt for the option. Must be the first await in the click handler (it needs the
 * gesture, S5). True when granted.
 */
export function requestBroadAccess(api: Browser): Promise<boolean> {
  return api.permissions.request({ origins: BROAD_ORIGINS }).catch(() => false);
}

/** Saves the option. The worker sees the change and registers or unregisters the script. */
export async function setSelectionEverywhere(api: Browser, on: boolean): Promise<void> {
  await api.storage.local.set({ [SELECTION_EVERYWHERE_KEY]: on });
}

/** A site pattern (`example.com`, `*.example.com`) as the match patterns of its pages. */
const matchPatterns = (pattern: string): string[] => [`*://${pattern}/*`];

/**
 * Where the script never runs: the built-in denylist (each host and its subdomains) and the
 * never-translate list. The script and the worker check again, so a host these miss stays clean.
 */
export function excludedMatches(never: readonly string[]): string[] {
  return [...DENYLISTED_HOSTS.map((h) => `*.${h}`), ...never].flatMap(matchPatterns);
}

/**
 * Registers the script when the option is on and the permission held, and unregisters it otherwise.
 * A registered script is updated, so its exclusions follow the never-translate list. Returns whether
 * the script is registered afterwards.
 */
export async function reconcileSelectionScript(api: Browser): Promise<boolean> {
  const [on, held, [current], lists] = await Promise.all([
    readSelectionEverywhere(api).catch(() => false),
    holdsBroadAccess(api),
    api.scripting.getRegisteredContentScripts({ ids: [SELECTION_SCRIPT_ID] }),
    readSiteLists(api).catch(() => ({ allow: [], never: [] })),
  ]);
  const registered = current !== undefined;
  if (!(on && held)) {
    if (registered) await api.scripting.unregisterContentScripts({ ids: [SELECTION_SCRIPT_ID] });
    return false;
  }
  const script = {
    id: SELECTION_SCRIPT_ID,
    matches: BROAD_ORIGINS,
    excludeMatches: excludedMatches(lists.never),
    js: [SELECTION_SCRIPT_FILE],
    runAt: 'document_idle' as const,
    allFrames: false,
    persistAcrossSessions: true,
  };
  // The worker wakes often (every tab's load): a registration that already matches is left as it is.
  const same = (a: readonly string[] | undefined, b: readonly string[]) => JSON.stringify(a ?? []) === JSON.stringify(b);
  if (current && same(current.matches, script.matches) && same(current.excludeMatches, script.excludeMatches) && same(current.js, script.js)) return true;
  if (registered) await api.scripting.updateContentScripts([script]);
  else await api.scripting.registerContentScripts([script]);
  return true;
}

/**
 * Keeps the registration in line, from the worker's top level (the only place that registers): now
 * (a worker start, an install or an update), and whenever the option, the permission or the
 * never-translate list changes.
 */
export function listenForSelectionEverywhere(api: Browser): void {
  // One at a time: two at once would both see no script and both register it.
  let queue = Promise.resolve();
  const reconcile = () => {
    queue = queue.then(() => reconcileSelectionScript(api)).then(
      () => undefined,
      (err: unknown) => console.error('[translate-side] selection button registration failed', err),
    );
  };
  reconcile();
  api.permissions.onAdded.addListener(reconcile);
  api.permissions.onRemoved.addListener(reconcile);
  api.storage.local.onChanged.addListener((changes) => {
    if (SELECTION_EVERYWHERE_KEY in changes) reconcile();
  });
  onListChanged(api, [SITE_NEVER_KEY], reconcile);
}
