// Per-site lists in storage.sync (DESIGN.md §7 site rules, §8; plan M5-E3/E6): the sites the
// user allowlisted for automatic translation, and the sites never to translate.
//
// - Allowlisted (`siteAllowlist`): allowlisting a site grants an optional host permission for it,
//   so the extension can re-inject on every navigation there (decision S5); on those sites the open
//   panel translates each new page by itself. Elsewhere a page read after a navigation is shown as
//   the original with a one-click "Translate this page" (§8: never auto-translate by default).
// - Never translate (`siteNever`): the user's own denylist (§8, decision D23, e.g. banking). Such a
//   site is never read or sent, like the built-in denylist: no injection, no selection hand-over,
//   and a page already read there is not translated.
//
// Entries are host patterns as site rules take them: `example.com`, or `*.example.com` for it and
// its subdomains (providers.ts matchesSite).
import type { browser } from 'wxt/browser';
import { matchesSite, readProviderSettings, SITE_ALLOWLIST_KEY } from './providers.ts';
import { readList, saveListWithOverflow } from './sync-quota.ts';

type Browser = typeof browser;

export { SITE_ALLOWLIST_KEY };
export const SITE_NEVER_KEY = 'siteNever';
/** Most entries per list. A list too large for its sync item stays on this device (src/shared/sync-quota.ts). */
export const MAX_SITES = 200;

export interface SiteLists {
  allow: string[];
  never: string[];
}

const HOST_RE = /^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+$/;

/**
 * A host pattern from what the user typed or a page URL: `example.com`, `*.example.com`,
 * `https://docs.example.com/guide` → `docs.example.com`. Null for anything that names no host.
 */
export function sitePattern(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (s === '') return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) {
    if (!/^https?:\/\//.test(s)) return null;
    try {
      s = new URL(s).hostname;
    } catch {
      return null;
    }
  } else s = s.replace(/[/:?#].*$/, '');
  s = s.replace(/\.$/, '');
  if (s === '' || s === '*.' || !HOST_RE.test(s)) return null;
  return s;
}

/** The host a page URL is on, as a pattern ("Always translate on this site"); null for a page with no web host. */
export function siteOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? sitePattern(u.hostname) : null;
  } catch {
    return null;
  }
}

/** The optional host permissions a site pattern needs: both schemes (the manifest declares both, S5 decision 6). */
export const siteOrigins = (pattern: string): string[] => [`https://${pattern}/*`, `http://${pattern}/*`];

export function cleanSiteList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const p = typeof entry === 'string' ? sitePattern(entry) : null;
    if (p !== null && !out.includes(p)) out.push(p);
  }
  return out.slice(0, MAX_SITES);
}

export async function readSiteLists(api: Browser): Promise<SiteLists> {
  const [allow, never] = await Promise.all([readList(api, SITE_ALLOWLIST_KEY), readList(api, SITE_NEVER_KEY)]);
  return { allow: cleanSiteList(allow), never: cleanSiteList(never) };
}

export const listedFor = (list: readonly string[], url: string | undefined): string | undefined => (url === undefined ? undefined : list.find((p) => matchesSite(p, url)));

/** Never translate wins over the allowlist. */
export function siteMode(lists: SiteLists, url: string | undefined): 'never' | 'allow' | 'ask' {
  if (listedFor(lists.never, url) !== undefined) return 'never';
  if (listedFor(lists.allow, url) !== undefined) return 'allow';
  return 'ask';
}

/** Is `url` on the user's never-translate list? False when the list can't be read (the built-in denylist still holds). */
export async function isNeverTranslate(api: Browser, url: string | undefined): Promise<boolean> {
  if (url === undefined) return false;
  try {
    return listedFor((await readSiteLists(api)).never, url) !== undefined;
  } catch {
    return false;
  }
}

/** The host permission a page needs for re-injection with no gesture: its own origin. */
export async function hasSitePermission(api: Browser, url: string): Promise<boolean> {
  let origin: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    origin = `${u.protocol}//${u.hostname}/*`;
  } catch {
    return false;
  }
  return api.permissions.contains({ origins: [origin] }).catch(() => false);
}

/**
 * Should a page read with no gesture (a navigation, an SPA route change) be translated on its own?
 * Only on an allowlisted site whose permission is still held (the user may have revoked it in
 * chrome://extensions), and never on a never-translate one.
 */
export async function autoTranslates(api: Browser, url: string | undefined): Promise<boolean> {
  if (url === undefined) return false;
  try {
    if (siteMode(await readSiteLists(api), url) !== 'allow') return false;
  } catch {
    return false;
  }
  return hasSitePermission(api, url);
}

let queue: Promise<unknown> = Promise.resolve();
const queued = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
};

async function editList(api: Browser, key: typeof SITE_ALLOWLIST_KEY | typeof SITE_NEVER_KEY, edit: (list: string[]) => string[]): Promise<string[]> {
  return queued(async () => {
    const list = cleanSiteList(await readList(api, key));
    const edited = edit(list);
    if (edited.length > MAX_SITES && edited.length > list.length) throw new Error(`At most ${MAX_SITES} sites per list. Remove a site first.`);
    const next = cleanSiteList(edited);
    await saveListWithOverflow(api, key, next);
    return next;
  });
}

/**
 * Allowlists a site. Call `requestSitePermission` first, in the click handler (it needs the
 * gesture): a site whose permission was refused is not added. Adding it removes it from the
 * never-translate list. When the list is full it throws, and the permission just granted goes back.
 */
export async function addAllowlisted(api: Browser, pattern: string): Promise<void> {
  try {
    await editList(api, SITE_ALLOWLIST_KEY, (l) => (l.includes(pattern) ? l : [...l, pattern]));
  } catch (e) {
    await releaseSite(api, pattern, cleanSiteList(await readList(api, SITE_ALLOWLIST_KEY).catch(() => undefined))).catch(() => undefined);
    throw e;
  }
  await editList(api, SITE_NEVER_KEY, (l) => l.filter((p) => p !== pattern));
}

/**
 * The permission prompt for a site (S5: a click in the panel or the options page is a valid
 * gesture). Must be the first await in the click handler. True when granted.
 */
export function requestSitePermission(api: Browser, pattern: string): Promise<boolean> {
  return api.permissions.request({ origins: siteOrigins(pattern) }).catch(() => false);
}

/**
 * Takes a site off the allowlist and gives its host permission back, unless a provider connection
 * uses a host it covers (the provider's own grant, §4.3.4).
 */
export async function removeAllowlisted(api: Browser, pattern: string): Promise<{ revoked: boolean }> {
  const left = await editList(api, SITE_ALLOWLIST_KEY, (l) => l.filter((p) => p !== pattern));
  return releaseSite(api, pattern, left);
}

/** Gives a site's host permission back, unless an entry left in `left` or a provider connection still needs it. */
async function releaseSite(api: Browser, pattern: string, left: readonly string[]): Promise<{ revoked: boolean }> {
  // Another entry still covers it (`*.example.com` over `docs.example.com`).
  const host = pattern.replace(/^\*\./, '');
  if (left.some((p) => matchesSite(p, `https://${host}/`))) return { revoked: false };
  const settings = await readProviderSettings(api).catch(() => undefined);
  const shared = settings?.connections.some((c) => matchesSite(pattern, c.baseUrl));
  if (shared !== false) return { revoked: false };
  const revoked = await api.permissions.remove({ origins: siteOrigins(pattern) }).catch(() => false);
  return { revoked };
}

/** Adds a site to the never-translate list; it leaves the allowlist (and its permission goes back). */
export async function addNever(api: Browser, pattern: string): Promise<void> {
  await editList(api, SITE_NEVER_KEY, (l) => (l.includes(pattern) ? l : [...l, pattern]));
  if ((await readSiteLists(api)).allow.includes(pattern)) await removeAllowlisted(api, pattern);
}

export async function removeNever(api: Browser, pattern: string): Promise<void> {
  await editList(api, SITE_NEVER_KEY, (l) => l.filter((p) => p !== pattern));
}
