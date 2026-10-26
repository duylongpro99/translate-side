// Content-script injection under activeTab (plan M0-E3, decision S5). The worker injects at
// gesture time (action click, Alt+T, context menu) and again when a tab it injected into
// finishes loading, while the grant lasts. The result is written to the tab's access record.
import type { browser } from 'wxt/browser';
import { writeAccess, type TabAccess } from './access.ts';
import { classifyUrl } from './denylist.ts';
import { isNeverTranslate, listedFor, readSiteLists } from './sites.ts';

type Browser = typeof browser;

/** Output path of src/entrypoints/content.ts (a runtime-registered WXT content script). */
export const CONTENT_SCRIPT_FILE = '/content-scripts/content.js';

/** What the content script's main() returns, and so what executeScript reports. */
export type InjectOutcome = 'injected' | 'already';

/**
 * What led to the injection: a gesture (the page is read and translated at once), a navigation, or a
 * click on the selection button (the page is read and offered, but only the selection is translated).
 */
export type InjectTrigger = 'gesture' | 'navigation' | 'selection';

export interface TabRef {
  id?: number | undefined;
  url?: string | undefined;
  windowId?: number | undefined;
}

/**
 * Injects the content script and records the outcome. A navigation passes the tab's record from
 * before it (`from`): the grant it was read under.
 */
export async function injectInto(api: Browser, tab: TabRef, trigger: InjectTrigger, from?: TabAccess): Promise<Omit<TabAccess, 'at'>> {
  const tabId = tab.id;
  if (tabId === undefined) return { status: 'blocked', reason: 'inject-failed', detail: 'no tab id' };
  // The grant's origin goes with every record: a gesture's page, whatever came of it (a gesture grants
  // activeTab even where nothing can be read); after a navigation, the new page's once it is read, else
  // the one the grant was for.
  const origin = trigger === 'gesture' ? originOf(tab.url) : undefined;
  const result = await attempt(api, tabId, tab.url, trigger, from, origin ?? from?.origin);
  const kept = origin ?? (result.status === 'ready' ? originOf(tab.url) : from?.origin);
  const access = { ...result, trigger, ...(kept ? { origin: kept } : {}) };
  await writeAccess(api, tabId, access);
  return access;
}

const originOf = (url: string | undefined): string | undefined => {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Whether a navigation may follow the grant the tab was read under: activeTab lasts on the same
 * origin and ends at another (S5), and an allowlisted site has its own grant. A broad host
 * permission (the selection button on every site) would let Chrome inject anywhere, so this keeps
 * S5's behavior with or without it (decision S9). With no record at all, the caller has checked the
 * allowlist itself (the panel's auto-read); a record with no origin follows only the allowlist.
 */
async function mayFollow(api: Browser, url: string, from: TabAccess | undefined): Promise<boolean> {
  if (from === undefined) return true;
  if (from.origin !== undefined && from.status !== 'lost' && originOf(url) === from.origin) return true;
  const allow = await readSiteLists(api).then(
    (l) => l.allow,
    () => [],
  );
  return listedFor(allow, url) !== undefined;
}

async function attempt(api: Browser, tabId: number, url: string | undefined, trigger: InjectTrigger, from: TabAccess | undefined, origin: string | undefined): Promise<Omit<TabAccess, 'at'>> {
  // tab.url is only visible with a grant (activeTab or a host permission). After a navigation,
  // a hidden URL means the grant is gone (S5).
  if (url === undefined && trigger === 'navigation') return { status: 'lost', reason: 'no-grant' };
  if (url !== undefined) {
    const verdict = classifyUrl(url);
    if (!verdict.ok) return { status: 'blocked', reason: verdict.reason };
    // The user's own denylist (sites.ts): never read, so never injected.
    if (await isNeverTranslate(api, url)) return { status: 'blocked', reason: 'never' };
    if (trigger === 'navigation' && !(await mayFollow(api, url, from))) return { status: 'lost', reason: 'no-grant' };
  }
  // With the grant's origin, so a record left by a worker that stopped here still says what it was for.
  await writeAccess(api, tabId, { status: 'injecting', trigger, ...(origin ? { origin } : {}) });
  try {
    const [first] = await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: [CONTENT_SCRIPT_FILE] });
    const outcome = first?.result as InjectOutcome | undefined;
    return { status: 'ready', ...(outcome === 'already' ? { detail: 'already injected' } : {}) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // At gesture time the grant is fresh, so a failure means Chrome forbids this page.
    // On a navigation it means the grant did not carry over.
    return trigger !== 'navigation' ? { status: 'blocked', reason: 'inject-failed', detail } : { status: 'lost', reason: 'no-grant', detail };
  }
}
