// The `translate` role → a client (DESIGN.md §4.3.5 Resolve, plan M4-E8): the profile routed for
// this page (site rule, then the tab's override, then the default route; src/shared/providers.ts),
// its connection's key from storage.local, and the host permission for its origin; the `analyze`
// role's own client when routing sends it elsewhere, resolved only when a brief is asked for, and
// likewise the `review` role's for a `refine` run. A quirk the adapter learns is saved on the
// stored connection (§4.2.4).
import type { browser } from 'wxt/browser';
import { CHROME_NANO, NANO_OFF_MESSAGE, createClient } from '@/llm/client';
import { DEFAULT_CONNECTION, hasHostPermission, originPattern, protocolOf, resolveConnection, withProfileQuirks, type ProviderConnection } from '@/shared/settings';
import { fallbackRoutesIn, hasBasicFallback, readProviderSettings, resolveFallback, resolveRoute, saveLearnedQuirk, type Route } from '@/shared/providers';
import { pricingFor } from '@/shared/pricing';
import type { AnalyzeResult, ClientResult, FallbackLink, JobConnection } from './jobs.ts';
import { uiError } from './status.ts';
import type { LLMError } from '@/llm/types';

type Browser = typeof browser;

/** Message of the "no key yet" stop: the panel shows the settings link for it. */
export const noKeyMessage = (label: string) => `Add your ${label} API key in settings`;
const noKeyError = (label: string): LLMError => uiError('auth', noKeyMessage(label), 'noKey', [label]);
export const NO_KEY_MESSAGE = noKeyMessage(DEFAULT_CONNECTION.label);

/** What a job translates: the page's URL (site rules) and its tab (the tab's override). */
export interface RouteTarget {
  tabId?: number | undefined;
  url?: string | undefined;
}

/** The connection as a job names it; `origin` only for a base URL that parses. */
function jobConnection(c: ProviderConnection): JobConnection {
  try {
    return { id: c.id, label: c.label, presetId: c.presetId, origin: originPattern(c.baseUrl) };
  } catch {
    return { id: c.id, label: c.label, presetId: c.presetId };
  }
}

type Resolved = Extract<ClientResult, { ok: true }>;
type Failed = Extract<ClientResult, { ok: false }>;

/** A client for one resolved route: its key, host permission and pricing; or why there is none. */
async function clientFor(api: Browser, route: Route): Promise<Omit<Resolved, 'analyze'> | Failed> {
  try {
    return await clientOf(api, route);
  } catch (error) {
    // Never a job left waiting on a route that threw (M5-D tester F3): the reader sees why.
    const c = route.connection;
    return { ok: false, error: { kind: 'bad_request', message: error instanceof Error ? error.message : String(error) }, ...(c ? { connection: jobConnection(c) } : {}) };
  }
}

async function clientOf(api: Browser, route: Route): Promise<Omit<Resolved, 'analyze'> | Failed> {
  if (!route.ok) {
    const c = route.connection;
    return { ok: false, error: { kind: 'bad_request', message: route.message }, ...(c ? { connection: jobConnection(c) } : {}) };
  }
  const { profile, connection } = route;
  const label = jobConnection(connection);
  if (protocolOf(connection, profile) === undefined) {
    return { ok: false, error: uiError('bad_request', `${connection.label} has no protocol yet. Test the connection in settings.`, 'noProtocol', [connection.label]), connection: label };
  }
  // A stored or synced Gemini Nano profile (no UI makes one while the flag is off, M5-E7).
  if (protocolOf(connection, profile) === 'chrome-builtin' && !CHROME_NANO) return { ok: false, error: uiError('bad_request', NANO_OFF_MESSAGE, 'nanoOff'), connection: label };
  const conn = await resolveConnection(api, connection, profile);
  if (conn === null) return { ok: false, error: noKeyError(connection.label), connection: label };
  // Checked up front: without it the request fails as `cors` / `permission` anyway (S4 row 1), but
  // only after the job has started.
  if (!(await hasHostPermission(api, conn.baseUrl))) {
    return { ok: false, error: uiError('cors', `No access to ${new URL(conn.baseUrl).hostname}`, 'noAccess', [new URL(conn.baseUrl).hostname], 'permission'), connection: label };
  }
  // The cost readout prices the job from the profile: its own pricing, or the built-in Anthropic table (M3-E9).
  const pricing = pricingFor(profile, connection);
  const onQuirkLearned = (_conn: unknown, learned: Parameters<typeof saveLearnedQuirk>[2], quirks: Parameters<typeof saveLearnedQuirk>[3]) => {
    saveLearnedQuirk(api, { connectionId: connection.id, profileId: profile.id }, learned, quirks).catch((err: unknown) => {
      console.warn('[translate-side] could not save a learned quirk', err);
    });
  };
  return {
    ok: true,
    client: createClient(withProfileQuirks(conn, profile), profile.model, { onQuirkLearned }),
    profile: pricing ? { ...profile, pricing } : profile,
    connection: label,
  };
}

const settingsError = (error: unknown): Failed => ({
  ok: false,
  error: uiError('unknown', `Could not read the provider settings (${error instanceof Error ? error.message : String(error)})`, 'settingsRead', [error instanceof Error ? error.message : String(error)]),
});

/**
 * The `analyze` role's client (the document brief), resolved when the job is about to ask for a
 * brief: undefined when routing sends it to the translate profile (that client serves it). A route
 * that can't run (no key, no access, no profile) is an error with its own connection, so "Fix key"
 * and "Grant access" name the right one; it never falls back to the translate provider unasked.
 */
async function analyzeClient(api: Browser, target: RouteTarget, translateProfileId: string): Promise<AnalyzeResult | undefined> {
  let route: Route;
  try {
    route = await resolveRoute(api, 'analyze', target);
  } catch (error) {
    return settingsError(error);
  }
  if (route.ok && route.profile.id === translateProfileId) return undefined;
  return clientFor(api, route);
}

/**
 * The `review` role's client (`refine`'s review pass, DESIGN.md §5.3), like `analyzeClient`:
 * `Routing.review` when set (under a local-only site rule, that rule's model), else undefined and
 * the translate client serves it. A route that can't run is an error; the job then runs without
 * the review rather than stopping.
 */
async function reviewClient(api: Browser, target: RouteTarget, translateProfileId: string): Promise<AnalyzeResult | undefined> {
  let route: Route;
  try {
    route = await resolveRoute(api, 'review', target);
  } catch (error) {
    return settingsError(error);
  }
  if (route.ok && route.profile.id === translateProfileId) return undefined;
  return clientFor(api, route);
}

/**
 * The client a job runs on (§4.3.5, §5.1: the engine asks by role): `translate`; with
 * `target.analyze`, also a resolver for the `analyze` role, called only when an analyze call will
 * be made (no brief cached or kept), so a route that can't run never stops a run that needs none;
 * with `target.review`, a resolver for the `review` role.
 */
export async function translateClient(api: Browser, target: RouteTarget & { analyze?: boolean; review?: boolean } = {}): Promise<ClientResult> {
  let route: Route;
  try {
    route = await resolveRoute(api, 'translate', target);
  } catch (error) {
    return settingsError(error);
  }
  const translate = await clientFor(api, route);
  if (!translate.ok || !route.ok) return translate;
  const { links: fallback, basic } = await fallbackClients(api, route);
  const routed = route.localOnly && route.rule ? { ...translate, localOnly: route.rule.pattern } : translate;
  const withFallback = { ...routed, ...(fallback.length > 0 ? { fallback } : {}), ...(basic ? { basic } : {}) };
  const profileId = translate.profile.id;
  const review = target.review ? { review: () => reviewClient(api, target, profileId) } : {};
  if (!target.analyze) return { ...withFallback, ...review };
  return { ...withFallback, analyze: () => analyzeClient(api, target, profileId), ...review };
}

/**
 * The route's fallback chain (§4.3.5, plan M4-E9): `Routing.fallback` without the `basic` entry
 * and, under a local-only site rule, without cloud connections (providers.ts fallbackRoutesIn),
 * and whether it ends in the `basic` entry (M5-E7; on the device, so kept under local only). A
 * link that can't run (no key, no access, no protocol) is left out: a fallback is a spare, so it
 * never stops a job that its primary can run. Settings that can't be read: none.
 */
async function fallbackClients(api: Browser, route: Extract<Route, { ok: true }>): Promise<{ links: FallbackLink[]; basic: boolean }> {
  let routes;
  let basic: boolean;
  try {
    const settings = await readProviderSettings(api);
    routes = fallbackRoutesIn(settings, route);
    basic = hasBasicFallback(settings.routing);
  } catch {
    return { links: [], basic: false };
  }
  const links: FallbackLink[] = [];
  for (const { profile, connection } of routes) {
    const link = await clientFor(api, { ok: true, profile, connection, source: 'routing', localOnly: route.localOnly });
    if (link.ok) links.push({ client: link.client, profile: link.profile, ...(link.connection ? { connection: link.connection } : {}) });
  }
  return { links, basic };
}

/** The routed model and where it sends text: what the header and the privacy notice name. */
export interface Routed {
  model: string;
  label: string;
  host: string;
  /** Where text may go if this route fails (M4-E9 fallback, after the privacy rule); absent when none. */
  fallback?: { label: string; host: string }[];
}

const hostOf = (baseUrl: string) => {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    // A connection without a base URL (chrome-builtin) names no host.
    return '';
  }
};

/** The translate route for `target` in brief; undefined when it does not resolve or storage fails. */
export async function routedSummary(api: Browser, target: RouteTarget = {}): Promise<Routed | undefined> {
  try {
    const route = await resolveRoute(api, 'translate', target);
    if (!route.ok) return undefined;
    const fallback = (await resolveFallback(api, route).catch(() => [])).filter((f) => f.connection.id !== route.connection.id).map((f) => ({ label: f.connection.label, host: hostOf(f.connection.baseUrl) }));
    const unique = fallback.filter((f, i) => fallback.findIndex((g) => g.label === f.label && g.host === f.host) === i);
    return { model: route.profile.model, label: route.connection.label, host: hostOf(route.connection.baseUrl), ...(unique.length ? { fallback: unique } : {}) };
  } catch {
    return undefined;
  }
}
