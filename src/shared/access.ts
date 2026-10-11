// Per-tab access state (plan M0-E3, decision S5). The worker writes it after each injection
// attempt; the panel reads it to decide what to show for the active tab. It lives in
// storage.session so it survives worker restarts but not a browser restart.
import type { browser } from 'wxt/browser';

type Browser = typeof browser;

export type AccessStatus =
  /** The worker is injecting the content script. */
  | 'injecting'
  /** The content script is in the page; the panel can connect. */
  | 'ready'
  /** Chrome or the denylist forbids reading this page ("can't read this page"). */
  | 'blocked'
  /** The page navigated away from the `activeTab` grant; a new gesture is needed. */
  | 'lost';

/** `never`: the site is on the user's never-translate list (src/shared/sites.ts, decision D23). */
export type AccessReason = 'restricted' | 'denylisted' | 'never' | 'inject-failed' | 'no-grant';

export interface TabAccess {
  status: AccessStatus;
  reason?: AccessReason;
  /**
   * What the injection followed: a user gesture (the toolbar, Alt+T, the context menu, the panel's
   * own Translate this page), or a navigation with no gesture (plan M5-E3). A page read after a
   * navigation is translated on its own only on an allowlisted site (DESIGN §8). Absent in records
   * of earlier versions: read as a gesture.
   */
  trigger?: 'gesture' | 'navigation';
  /** Error text from Chrome, for the dev view and logs. */
  detail?: string;
  /** Milliseconds since epoch; every write changes it, so the panel sees repeat injections. */
  at: number;
}

const PREFIX = 'access:';
export const accessKey = (tabId: number) => `${PREFIX}${tabId}`;

export function tabIdFromKey(key: string): number | null {
  if (!key.startsWith(PREFIX)) return null;
  const n = Number(key.slice(PREFIX.length));
  return Number.isInteger(n) ? n : null;
}

export async function readAccess(api: Browser, tabId: number): Promise<TabAccess | undefined> {
  const key = accessKey(tabId);
  const got = await api.storage.session.get(key);
  return got[key] as TabAccess | undefined;
}

export async function writeAccess(api: Browser, tabId: number, access: Omit<TabAccess, 'at'>): Promise<void> {
  await api.storage.session.set({ [accessKey(tabId)]: { ...access, at: Date.now() } satisfies TabAccess });
}

export async function clearAccess(api: Browser, tabId: number): Promise<void> {
  await api.storage.session.remove(accessKey(tabId));
}
