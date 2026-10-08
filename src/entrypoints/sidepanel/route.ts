// The `translate` role → a client (DESIGN.md §4.3.5 Resolve, plan M4-E8): the profile routed for
// this page (site rule, then the tab's override, then the default route; src/shared/providers.ts),
// its connection's key from storage.local, and the host permission for its origin; the `analyze`
// role's own client when routing sends it elsewhere, resolved only when a brief is asked for. A quirk the adapter learns is saved on the
// stored connection (§4.2.4).
import type { browser } from 'wxt/browser';
import { createClient } from '@/llm/client';
import { DEFAULT_CONNECTION, hasHostPermission, originPattern, protocolOf, resolveConnection, withProfileQuirks, type ProviderConnection } from '@/shared/settings';
import { resolveRoute, saveLearnedQuirk, type Route } from '@/shared/providers';
import { pricingFor } from '@/shared/pricing';
import type { AnalyzeResult, ClientResult, JobConnection } from './jobs.ts';

type Browser = typeof browser;

/** Message of the "no key yet" stop: the panel shows the settings link for it. */
export const noKeyMessage = (label: string) => `Add your ${label} API key in settings`;
export const NO_KEY_MESSAGE = noKeyMessage(DEFAULT_CONNECTION.label);

/** What a job translates: the page's URL (site rules) and its tab (the tab's override). */
export interface RouteTarget {
  tabId?: number | undefined;
  url?: string | undefined;
}

/** The connection as a job names it; `origin` only for a base URL that parses. */
function jobConnection(c: ProviderConnection): JobConnection {
  try {
    return { id: c.id, label: c.label, origin: originPattern(c.baseUrl) };
  } catch {
    return { id: c.id, label: c.label };
  }
}

type Resolved = Extract<ClientResult, { ok: true }>;
type Failed = Extract<ClientResult, { ok: false }>;

/** A client for one resolved route: its key, host permission and pricing; or why there is none. */
async function clientFor(api: Browser, route: Route): Promise<Omit<Resolved, 'analyze'> | Failed> {
  if (!route.ok) {
    const c = route.connection;
    return { ok: false, error: { kind: 'bad_request', message: route.message }, ...(c ? { connection: jobConnection(c) } : {}) };
  }
  const { profile, connection } = route;
  const label = jobConnection(connection);
  if (protocolOf(connection, profile) === undefined) {
    return { ok: false, error: { kind: 'bad_request', message: `${connection.label} has no protocol yet. Test the connection in settings.` }, connection: label };
  }
  const conn = await resolveConnection(api, connection, profile);
  if (conn === null) return { ok: false, error: { kind: 'auth', message: noKeyMessage(connection.label) }, connection: label };
  // Checked up front: without it the request fails as `cors` / `permission` anyway (S4 row 1), but
  // only after the job has started.
  if (!(await hasHostPermission(api, conn.baseUrl))) {
    return { ok: false, error: { kind: 'cors', cause: 'permission', message: `No access to ${new URL(conn.baseUrl).hostname}` }, connection: label };
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
  error: { kind: 'unknown', message: `Could not read the provider settings (${error instanceof Error ? error.message : String(error)})` },
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
 * The client a job runs on (§4.3.5, §5.1: the engine asks by role): `translate`; with
 * `target.analyze`, also a resolver for the `analyze` role, called only when an analyze call will
 * be made (no brief cached or kept), so a route that can't run never stops a run that needs none.
 */
export async function translateClient(api: Browser, target: RouteTarget & { analyze?: boolean } = {}): Promise<ClientResult> {
  let route: Route;
  try {
    route = await resolveRoute(api, 'translate', target);
  } catch (error) {
    return settingsError(error);
  }
  const translate = await clientFor(api, route);
  if (!translate.ok || !target.analyze) return translate;
  const profileId = translate.profile.id;
  return { ...translate, analyze: () => analyzeClient(api, target, profileId) };
}

/** The routed model and where it sends text: what the header and the privacy notice name. */
export interface Routed {
  model: string;
  label: string;
  host: string;
}

/** The translate route for `target` in brief; undefined when it does not resolve or storage fails. */
export async function routedSummary(api: Browser, target: RouteTarget = {}): Promise<Routed | undefined> {
  try {
    const route = await resolveRoute(api, 'translate', target);
    if (!route.ok) return undefined;
    let host = '';
    try {
      host = new URL(route.connection.baseUrl).hostname;
    } catch {
      // A connection without a base URL (chrome-builtin) names no host.
    }
    return { model: route.profile.model, label: route.connection.label, host };
  } catch {
    return undefined;
  }
}
