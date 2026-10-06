// Content-script injection under activeTab (plan M0-E3, decision S5). The worker injects at
// gesture time (action click, Alt+T, context menu) and again when a tab it injected into
// finishes loading, while the grant lasts. The result is written to the tab's access record.
import type { browser } from 'wxt/browser';
import { writeAccess, type TabAccess } from './access.ts';
import { classifyUrl } from './denylist.ts';

type Browser = typeof browser;

/** Output path of src/entrypoints/content.ts (a runtime-registered WXT content script). */
export const CONTENT_SCRIPT_FILE = '/content-scripts/content.js';

/** What the content script's main() returns, and so what executeScript reports. */
export type InjectOutcome = 'injected' | 'already';

export type InjectTrigger = 'gesture' | 'navigation';

export interface TabRef {
  id?: number | undefined;
  url?: string | undefined;
}

export async function injectInto(api: Browser, tab: TabRef, trigger: InjectTrigger): Promise<Omit<TabAccess, 'at'>> {
  const tabId = tab.id;
  if (tabId === undefined) return { status: 'blocked', reason: 'inject-failed', detail: 'no tab id' };
  const access = await attempt(api, tabId, tab.url, trigger);
  await writeAccess(api, tabId, access);
  return access;
}

async function attempt(api: Browser, tabId: number, url: string | undefined, trigger: InjectTrigger): Promise<Omit<TabAccess, 'at'>> {
  // tab.url is only visible with a grant (activeTab or a host permission). After a navigation,
  // a hidden URL means the grant is gone (S5).
  if (url === undefined && trigger === 'navigation') return { status: 'lost', reason: 'no-grant' };
  if (url !== undefined) {
    const verdict = classifyUrl(url);
    if (!verdict.ok) return { status: 'blocked', reason: verdict.reason };
  }
  await writeAccess(api, tabId, { status: 'injecting' });
  try {
    const [first] = await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: [CONTENT_SCRIPT_FILE] });
    const outcome = first?.result as InjectOutcome | undefined;
    return { status: 'ready', ...(outcome === 'already' ? { detail: 'already injected' } : {}) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // At gesture time the grant is fresh, so a failure means Chrome forbids this page.
    // On a navigation it means the grant did not carry over.
    return trigger === 'gesture' ? { status: 'blocked', reason: 'inject-failed', detail } : { status: 'lost', reason: 'no-grant', detail };
  }
}
