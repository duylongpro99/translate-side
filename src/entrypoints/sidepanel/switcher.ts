// The quick switcher's data and writes (DESIGN.md §4.3.3 B, plan M4-E11): the model profiles to
// choose from for this tab, which one the page runs on and why, a tab-scoped choice
// (storage.session `tabRoute:<tabId>`, cleared when the tab closes) and "Make default"
// (`routing.translate`, storage.sync). A site rule still wins over a tab choice (§4.3.5), so a
// page one covers shows the rule instead of a choice that would do nothing.
import type { browser } from 'wxt/browser';
import { isLocalConnection, clearTabOverride, isUsable, readProviderSettings, readTabOverride, resolveRouteIn, saveRouting, setTabOverride, siteRuleFor } from '@/shared/providers';

type Browser = typeof browser;

export interface SwitcherOption {
  id: string;
  model: string;
  /** The connection's name. */
  connection: string;
  /** Can this device send with it (a key, or none needed)? An option that can't is shown but not chosen. */
  usable: boolean;
  local: boolean;
}

export interface SwitcherState {
  options: SwitcherOption[];
  /** The profile the translate role resolves to for this tab and page; undefined when none resolves. */
  currentId?: string;
  /** `routing.translate`: what every other tab and page uses. */
  defaultId: string;
  /** This tab's own choice, when it has one. */
  tabId?: string;
  /** A site rule covers the page: it decides the model, whatever the tab chose. */
  rule?: { pattern: string; localOnly: boolean; model: string; connection: string };
}

/** What the switcher shows for a tab and its page now. */
export async function readSwitcher(api: Browser, target: { tabId?: number | undefined; url?: string | undefined }): Promise<SwitcherState> {
  const [settings, tab] = await Promise.all([readProviderSettings(api), target.tabId === undefined ? undefined : readTabOverride(api, target.tabId).catch(() => undefined)]);
  const route = resolveRouteIn(settings, 'translate', { url: target.url, tabProfileId: tab });
  const current = route.ok ? route.profile.id : undefined;
  const defaultId = settings.routing.translate;
  const connections = new Map(settings.connections.map((c) => [c.id, c]));
  const options: SwitcherOption[] = [];
  for (const p of settings.profiles) {
    const c = connections.get(p.connectionId);
    if (!c) continue;
    const usable = await isUsable(api, c).catch(() => false);
    // A keyless built-in model nobody routes to is not an offer; the one in use always is.
    if (!usable && p.id !== current && p.id !== defaultId) continue;
    options.push({ id: p.id, model: p.model, connection: c.label, usable, local: isLocalConnection(c) });
  }
  const rule = siteRuleFor(settings.routing, target.url);
  const ruled = rule && route.ok && route.source === 'site' ? { pattern: rule.pattern, localOnly: rule.localOnly === true, model: route.profile.model, connection: route.connection.label } : undefined;
  return { options, ...(current !== undefined ? { currentId: current } : {}), defaultId, ...(tab !== undefined && settings.profiles.some((p) => p.id === tab) ? { tabId: tab } : {}), ...(ruled ? { rule: ruled } : {}) };
}

/** This tab only (§4.3.3 B): the routing is not touched. `undefined` goes back to the default. */
export async function chooseForTab(api: Browser, tabId: number, profileId: string | undefined): Promise<void> {
  if (profileId === undefined) await clearTabOverride(api, tabId);
  else await setTabOverride(api, tabId, profileId);
}

/**
 * "Make default": the profile becomes `routing.translate` (analyze, review, fallback and site rules
 * stay), and this tab's own choice goes, since it now says the same.
 */
export async function makeDefault(api: Browser, tabId: number | undefined, profileId: string): Promise<void> {
  const { routing } = await readProviderSettings(api);
  await saveRouting(api, { ...routing, translate: profileId });
  if (tabId !== undefined) await clearTabOverride(api, tabId);
}
