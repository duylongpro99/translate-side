// The `translate` role → a client (DESIGN.md §4.3.5 Resolve, plan M4-E8): the profile routed for
// this page (site rule, then the tab's override, then the default route; src/shared/providers.ts),
// its connection's key from storage.local, and the host permission for its origin; the `analyze`
// role's own client when routing sends it elsewhere, resolved only when a brief is asked for, and
// likewise the `review` role's for a `refine` run. A quirk the adapter learns is saved on the
// stored connection (§4.2.4).
//
// No usable provider (the default route has no key, and no fallback link can run): the page is
// translated on the device instead (src/llm/on-device.ts), by Gemini Nano or Chrome's Translator.
// A site rule or tab override without a key still stops with "Add your key": the reader chose that
// model for this page.
import type { browser } from 'wxt/browser';
import { createClient } from '@/llm/client';
import { nanoClient, pickEngine, translatorRouteClient, type EngineChoice, type OnDeviceEngine } from '@/llm/on-device';
import { nanoOf } from '@/llm/chrome-builtin';
import { DEFAULT_CONNECTION, NANO_PROFILE, ON_DEVICE_CONNECTION, TRANSLATOR_PROFILE, hasHostPermission, originPattern, protocolOf, resolveConnection, withProfileQuirks, type ModelProfile, type ProviderConnection } from '@/shared/settings';
import { fallbackRoutesIn, hasBasicFallback, isUsable, onDeviceSettingOf, readProviderSettings, resolveFallback, resolveRoute, saveLearnedQuirk, type ProviderSettings, type Route } from '@/shared/providers';
import { pricingFor } from '@/shared/pricing';
import type { AnalyzeResult, ClientResult, FallbackLink, JobConnection } from './jobs.ts';
import { uiError } from './status.ts';
import type { LLMError } from '@/llm/types';

type Browser = typeof browser;

/** Message of the "no key yet" stop: the panel shows the settings link for it. */
export const noKeyMessage = (label: string) => `Add your ${label} API key in settings`;
const noKeyError = (label: string): LLMError => uiError('auth', noKeyMessage(label), 'noKey', [label]);
export const NO_KEY_MESSAGE = noKeyMessage(DEFAULT_CONNECTION.label);

/** What a job translates: the page's URL (site rules), its tab (the tab's override) and its languages (the on-device pair). */
export interface RouteTarget {
  tabId?: number | undefined;
  url?: string | undefined;
  /** The page's language, '' when not known. */
  sourceLang?: string | undefined;
  targetLang?: string | undefined;
}

/** What an on-device client needs besides the route: the browser's built-in APIs and the pair. */
interface OnDeviceContext {
  scope: object;
  from: string;
  to: string;
}

/** The on-device route's connection, as a job names it. */
const ON_DEVICE_LABEL: JobConnection = { id: ON_DEVICE_CONNECTION.id, label: ON_DEVICE_CONNECTION.label, presetId: ON_DEVICE_CONNECTION.presetId };

/** Why the on-device route can't run yet, as the panel shows it; undefined for an engine that runs. */
function onDeviceStop(choice: EngineChoice): LLMError | undefined {
  if ('needsSetup' in choice) return uiError('bad_request', `Turn on on-device translation (${choice.from} → ${choice.to})`, 'onDeviceSetup', [choice.needsSetup, choice.from, choice.to]);
  if ('downloading' in choice) return uiError('bad_request', `Chrome is downloading on-device translation (${choice.from} → ${choice.to})`, 'onDeviceDownloading', [choice.downloading, choice.from, choice.to]);
  if ('unknownSource' in choice) return uiError('bad_request', "The page's language is not known, so Chrome can't translate it on the device", 'onDeviceNoSource');
  if ('unavailable' in choice) return uiError('bad_request', choice.unavailable === 'no-api' ? 'On-device translation needs desktop Chrome 138 or later' : choice.unavailable === 'setting' ? 'The on-device engine chosen in Settings cannot run here' : `Chrome can't translate ${choice.from} → ${choice.to} on this device`, 'onDeviceUnavailable', [choice.unavailable, choice.from, choice.to]);
  return undefined;
}

/** A Nano client for `profile` (the on-device one, or a stored `chrome-builtin` profile): one request at a time. */
const nanoResult = (ctx: OnDeviceContext, profile: ModelProfile, connection: JobConnection): Omit<Resolved, 'analyze'> => ({
  ok: true,
  client: nanoClient(ctx.scope, ctx.from, ctx.to),
  profile: { ...profile, maxConcurrency: 1 },
  connection,
  onDevice: 'nano',
});

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
async function clientFor(api: Browser, route: Route, ctx: OnDeviceContext): Promise<Omit<Resolved, 'analyze'> | Failed> {
  try {
    return await clientOf(api, route, ctx);
  } catch (error) {
    // Never a job left waiting on a route that threw (M5-D tester F3): the reader sees why.
    const c = route.connection;
    return { ok: false, error: { kind: 'bad_request', message: error instanceof Error ? error.message : String(error) }, ...(c ? { connection: jobConnection(c) } : {}) };
  }
}

async function clientOf(api: Browser, route: Route, ctx: OnDeviceContext): Promise<Omit<Resolved, 'analyze'> | Failed> {
  if (!route.ok) {
    const c = route.connection;
    return { ok: false, error: { kind: 'bad_request', message: route.message }, ...(c ? { connection: jobConnection(c) } : {}) };
  }
  const { profile, connection } = route;
  const label = jobConnection(connection);
  if (protocolOf(connection, profile) === undefined) {
    return { ok: false, error: uiError('bad_request', `${connection.label} has no protocol yet. Test the connection in settings.`, 'noProtocol', [connection.label]), connection: label };
  }
  // A stored or synced Gemini Nano profile: no key and no host to ask access for; the on-device
  // limits (one request at a time, the pair's languages) and the same turn-on click when needed.
  if (protocolOf(connection, profile) === 'chrome-builtin') {
    const choice = await pickEngine(ctx.scope, { setting: 'nano', from: ctx.from, to: ctx.to, translator: false });
    const stop = onDeviceStop(choice);
    return stop ? { ok: false, error: stop, connection: label } : nanoResult(ctx, profile, label);
  }
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
async function analyzeClient(api: Browser, target: RouteTarget, ctx: OnDeviceContext, translateProfileIds: readonly string[]): Promise<AnalyzeResult | undefined> {
  let route: Route;
  try {
    route = await resolveRoute(api, 'analyze', target);
  } catch (error) {
    return settingsError(error);
  }
  if (route.ok && translateProfileIds.includes(route.profile.id)) return undefined;
  return clientFor(api, route, ctx);
}

/**
 * The `review` role's client (`refine`'s review pass, DESIGN.md §5.3), like `analyzeClient`:
 * `Routing.review` when set (under a local-only site rule, that rule's model), else undefined and
 * the translate client serves it. A route that can't run is an error; the job then runs without
 * the review rather than stopping.
 */
async function reviewClient(api: Browser, target: RouteTarget, ctx: OnDeviceContext, translateProfileIds: readonly string[]): Promise<AnalyzeResult | undefined> {
  let route: Route;
  try {
    route = await resolveRoute(api, 'review', target);
  } catch (error) {
    return settingsError(error);
  }
  if (route.ok && translateProfileIds.includes(route.profile.id)) return undefined;
  return clientFor(api, route, ctx);
}

/**
 * The client a job runs on (§4.3.5, §5.1: the engine asks by role): `translate`; with
 * `target.analyze`, also a resolver for the `analyze` role, called only when an analyze call will
 * be made (no brief cached or kept), so a route that can't run never stops a run that needs none;
 * with `target.review`, a resolver for the `review` role.
 *
 * The default route without a key: its first fallback link that can run takes its place (the
 * rest stay the chain); with none, the on-device route (`onDevice` set: the job runs it alone,
 * without analyze or review). `scope` holds the browser's built-in AI APIs (the panel's window).
 */
export async function translateClient(api: Browser, target: RouteTarget & { analyze?: boolean; review?: boolean } = {}, scope: object = globalThis): Promise<ClientResult> {
  let route: Route;
  try {
    route = await resolveRoute(api, 'translate', target);
  } catch (error) {
    return settingsError(error);
  }
  const ctx: OnDeviceContext = { scope, from: target.sourceLang ?? '', to: target.targetLang ?? '' };
  let translate = await clientFor(api, route, ctx);
  let chain: { links: FallbackLink[]; basic: boolean } | undefined;
  if (!translate.ok && route.ok && route.source === 'routing' && isNoKey(translate.error)) {
    let settings: ProviderSettings;
    try {
      settings = await readProviderSettings(api);
    } catch {
      return translate;
    }
    const { links, basic } = await fallbackClients(api, route, ctx);
    const [first, ...rest] = links;
    if (first === undefined) return (await onDeviceRoute(ctx, settings)) ?? translate;
    translate = { ok: true, client: first.client, profile: first.profile, ...(first.connection ? { connection: first.connection } : {}), ...(first.onDevice ? { onDevice: first.onDevice } : {}) };
    chain = { links: rest, basic };
  }
  if (!translate.ok || !route.ok) return translate;
  const { links: fallback, basic } = chain ?? (await fallbackClients(api, route, ctx));
  const routed = route.localOnly && route.rule ? { ...translate, localOnly: route.rule.pattern } : translate;
  const withFallback = { ...routed, ...(fallback.length > 0 ? { fallback } : {}), ...(basic ? { basic } : {}) };
  // The routed profile serves the other roles too when they route to it, also when a fallback link stands in for it.
  const profileIds = [translate.profile.id, route.profile.id];
  const review = target.review ? { review: () => reviewClient(api, target, ctx, profileIds) } : {};
  if (!target.analyze) return { ...withFallback, ...review };
  return { ...withFallback, analyze: () => analyzeClient(api, target, ctx, profileIds), ...review };
}

const isNoKey = (error: LLMError) => (error.raw as { ui?: unknown } | undefined)?.ui === 'noKey';

/**
 * The on-device route for a reader with no usable provider (src/llm/on-device.ts): the engine the
 * setting, the pair and the device allow, or why none runs yet. Undefined (the caller's "Add your
 * key" stands) when the reader removed "basic translation" from the fallback list and Gemini Nano
 * can't run either.
 */
async function onDeviceRoute(ctx: OnDeviceContext, settings: ProviderSettings): Promise<ClientResult | undefined> {
  const basic = hasBasicFallback(settings.routing);
  const choice = await pickEngine(ctx.scope, { setting: onDeviceSettingOf(settings.routing), from: ctx.from, to: ctx.to, translator: basic });
  if ('engine' in choice) return onDeviceClient(ctx, choice.engine, basic);
  if (!basic && ('unavailable' in choice || 'unknownSource' in choice)) return undefined;
  return { ok: false, error: onDeviceStop(choice) as LLMError, connection: ON_DEVICE_LABEL };
}

function onDeviceClient(ctx: OnDeviceContext, engine: OnDeviceEngine, basic: boolean): ClientResult {
  // Nano hands a chunk it can't do to Chrome's Translator (engine `onDeviceSwitch`), unless the reader removed it.
  if (engine === 'nano') return { ...nanoResult(ctx, NANO_PROFILE, ON_DEVICE_LABEL), ...(basic ? { basic: true } : {}) };
  return { ok: true, client: translatorRouteClient(), profile: TRANSLATOR_PROFILE, connection: ON_DEVICE_LABEL, onDevice: 'translator' };
}

/**
 * The route's fallback chain (§4.3.5, plan M4-E9): `Routing.fallback` without the `basic` entry
 * and, under a local-only site rule, without cloud connections (providers.ts fallbackRoutesIn),
 * and whether it ends in the `basic` entry (M5-E7; on the device, so kept under local only). A
 * link that can't run (no key, no access, no protocol) is left out: a fallback is a spare, so it
 * never stops a job that its primary can run. Settings that can't be read: none.
 */
async function fallbackClients(api: Browser, route: Extract<Route, { ok: true }>, ctx: OnDeviceContext): Promise<{ links: FallbackLink[]; basic: boolean }> {
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
    const link = await clientFor(api, { ok: true, profile, connection, source: 'routing', localOnly: route.localOnly }, ctx);
    if (link.ok) links.push({ client: link.client, profile: link.profile, ...(link.connection ? { connection: link.connection } : {}), ...(link.onDevice ? { onDevice: link.onDevice } : {}) });
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

/**
 * The translate route for `target` in brief; undefined when it does not resolve or storage fails.
 * The default route with no key and no fallback link that can run: the on-device route, as in
 * translateClient, when it may run here (Chrome's Translator kept, or Gemini Nano in `scope`).
 */
export async function routedSummary(api: Browser, target: RouteTarget = {}, scope: object = globalThis): Promise<Routed | undefined> {
  try {
    const route = await resolveRoute(api, 'translate', target);
    if (!route.ok) return undefined;
    let links = await resolveFallback(api, route).catch(() => []);
    let primary: { profile: ModelProfile; connection: ProviderConnection } = route;
    // The default route with no key: its first fallback link that can run takes its place (translateClient).
    if (route.source === 'routing' && !(await isUsable(api, route.connection))) {
      const usable = [];
      for (const link of links) if (await isUsable(api, link.connection)) usable.push(link);
      const [first, ...rest] = usable;
      if (first) {
        primary = first;
        links = rest;
      } else {
        const { routing } = await readProviderSettings(api);
        if (hasBasicFallback(routing) || (onDeviceSettingOf(routing) !== 'translator' && nanoOf(scope) !== undefined)) return { model: '', label: ON_DEVICE_CONNECTION.label, host: '' };
      }
    }
    const fallback = links.filter((f) => f.connection.id !== primary.connection.id).map((f) => ({ label: f.connection.label, host: hostOf(f.connection.baseUrl) }));
    const unique = fallback.filter((f, i) => fallback.findIndex((g) => g.label === f.label && g.host === f.host) === i);
    return { model: primary.profile.model, label: primary.connection.label, host: hostOf(primary.connection.baseUrl), ...(unique.length ? { fallback: unique } : {}) };
  } catch {
    return undefined;
  }
}
