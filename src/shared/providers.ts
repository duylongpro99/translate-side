// Connections, model profiles and routing in storage.sync (DESIGN.md §4.3.1, plan M4-E2), the
// M1 → M4 migration, and routing resolution (§4.3.5 Resolve, plan M4-E8). Secrets stay in
// storage.local under `secret:<connectionId>` (§4.3.4, settings.ts), so a connection keeps its id
// for life: the migration reuses the built-in ids and every M1 key is found where it was.
//
// Sync layout, schema 1 (small items: one per record, plan M4 §8 risk "sync quota"):
//   schemaVersion          1
//   conn:<id>              ProviderConnection
//   profile:<id>           ModelProfile
//   routing                { translate, analyze?, review?, fallback? }
//   siteRules              [{ pattern, translate, localOnly? }]  (Routing.siteOverrides; UI in M5-E6)
// `routing` is only ever written by the user (saveRouting), never by the migration: a fresh device
// migrates before sync has pulled the other devices' items, and a default it wrote could win
// last-write-wins over the user's routing. Without `routing`, this device's `migratedRoute`
// applies, then the built-in default. `migratedRoute` ({ translate }, or {} for none) is in
// storage.local: it is derived from this device's keys, so another device's must not reach it.
// Every built-in connection and its profiles apply at read time when not stored, so a route to a
// built-in profile resolves on any device (it asks for a key instead).
// Records are found by key prefix, not through an index item: chrome.storage.sync merges devices
// item by item, and an index written on two devices at once would lose one side's records.
// Tab overrides (the quick switcher, M4-E11) are per browser session: storage.session
// `tabRoute:<tabId>`, cleared when the tab closes (src/shared/panel.ts).
import type { browser } from 'wxt/browser';
import type { AuthStyle, ModelRole, Protocol, Quirks } from '@/llm/types';
import { ROLE_LABELS } from './presets.ts';
import {
  BUILTIN_CONNECTIONS,
  BUILTIN_PROFILES,
  DEFAULT_CONNECTION,
  DEFAULT_PROFILE,
  originPattern,
  readApiKey,
  removeApiKey,
  saveApiKey,
  SYNC_QUOTA_BYTES,
  SYNC_QUOTA_BYTES_PER_ITEM,
  syncItemBytes,
  type ModelProfile,
  type ProviderConnection,
} from './settings.ts';

type Browser = typeof browser;

export const SCHEMA_KEY = 'schemaVersion';
export const SCHEMA_VERSION = 1;
export const CONNECTION_PREFIX = 'conn:';
export const PROFILE_PREFIX = 'profile:';
export const ROUTING_KEY = 'routing';
export const SITE_RULES_KEY = 'siteRules';
/** storage.local: the route the migration derived from this device's M1 keys (e.g. Gemini); `routing` always wins over it. */
export const MIGRATED_ROUTE_KEY = 'migratedRoute';
/** chrome.storage.sync.MAX_ITEMS (fixed by Chrome). */
export const SYNC_MAX_ITEMS = 512;
export const TAB_ROUTE_PREFIX = 'tabRoute:';

/** Is `key` one of the sync items this module owns? */
export const isProviderKey = (key: string) => key === SCHEMA_KEY || key === ROUTING_KEY || key === SITE_RULES_KEY || key.startsWith(CONNECTION_PREFIX) || key.startsWith(PROFILE_PREFIX);
export const connectionKey = (id: string) => `${CONNECTION_PREFIX}${id}`;
export const profileKey = (id: string) => `${PROFILE_PREFIX}${id}`;
export const tabRouteKey = (tabId: number) => `${TAB_ROUTE_PREFIX}${tabId}`;

/** §4.3.1 site override. `pattern` is a host: `example.com`, or `*.example.com` for it and its subdomains. */
export interface SiteRule {
  pattern: string;
  /** ModelProfile id. */
  translate: string;
  /** Never falls back to a cloud profile (§4.3.5 privacy rule; enforced by the fallback chain, M4-E9). */
  localOnly?: boolean;
}

/** §4.3.1 Routing. Profile ids; `analyze` and `review` default to `translate`. */
export interface Routing {
  translate: string;
  analyze?: string;
  review?: string;
  /**
   * Tried in order on hard failure (M4-E9). Entries are profile ids; M5-E7 adds a terminal
   * `basic` entry (a strategy switch, not a profile), so unknown ids are kept, not dropped.
   */
  fallback?: string[];
  siteOverrides?: SiteRule[];
}

export interface ProviderSettings {
  schemaVersion: number;
  connections: ProviderConnection[];
  profiles: ModelProfile[];
  routing: Routing;
  /**
   * Ids of the built-in connections and profiles that apply only at read time (not stored), so
   * the settings can tell them apart: removing one cannot make it go away (carry-over B2).
   */
  implicit?: { connections: string[]; profiles: string[] };
  /** Is `routing` stored (the user chose a route), rather than migrated or the default? */
  routingStored?: boolean;
}

// ---- Cleaning what storage holds (another device or a later version may have written it) ----

const PROTOCOLS: readonly (Protocol | 'auto')[] = ['anthropic-messages', 'openai-chat', 'chrome-builtin', 'auto'];
const AUTH_STYLES: readonly AuthStyle[] = ['x-api-key', 'bearer', 'custom-header', 'none'];
const STATUSES: readonly ProviderConnection['status'][] = ['unverified', 'ok', 'error'];
const ERROR_KINDS: readonly NonNullable<ProviderConnection['lastErrorKind']>[] = ['auth', 'rate_limit', 'overloaded', 'context_length', 'bad_request', 'model_not_found', 'network', 'cors', 'cors-origin', 'unknown', 'quota'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== '';
const oneOf = <T>(v: unknown, allowed: readonly T[]): v is T => allowed.includes(v as T);
const positiveInt = (v: unknown, fallback: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.min(max, Math.round(v)) : fallback);

function stringRecord(v: unknown): Record<string, string> | undefined {
  if (!isRecord(v)) return undefined;
  const out = Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'));
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A stored connection, or null when it lacks what a request needs. Unknown fields are dropped. */
export function cleanConnection(raw: unknown): ProviderConnection | null {
  if (!isRecord(raw)) return null;
  const { id, label, presetId, protocol, baseUrl, auth } = raw;
  if (!nonEmpty(id) || !oneOf(protocol, PROTOCOLS) || typeof baseUrl !== 'string' || !isRecord(auth) || !oneOf(auth.style, AUTH_STYLES)) return null;
  const extraHeaders = stringRecord(raw.extraHeaders);
  const queryParams = stringRecord(raw.queryParams);
  const detected = Array.isArray(raw.detectedProtocols) ? raw.detectedProtocols.filter((p): p is Protocol => p !== 'auto' && oneOf(p, PROTOCOLS)) : [];
  return {
    id,
    label: nonEmpty(label) ? label : id,
    presetId: nonEmpty(presetId) ? presetId : 'custom',
    protocol,
    baseUrl,
    auth: nonEmpty(auth.headerName) ? { style: auth.style, headerName: auth.headerName } : { style: auth.style },
    ...(extraHeaders ? { extraHeaders } : {}),
    ...(queryParams ? { queryParams } : {}),
    quirks: isRecord(raw.quirks) ? (raw.quirks as Quirks) : {},
    ...(detected.length > 0 ? { detectedProtocols: detected } : {}),
    status: oneOf(raw.status, STATUSES) ? raw.status : 'unverified',
    ...(nonEmpty(raw.lastError) ? { lastError: raw.lastError } : {}),
    ...(oneOf(raw.lastErrorKind, ERROR_KINDS) ? { lastErrorKind: raw.lastErrorKind } : {}),
  };
}

function cleanPricing(v: unknown): ModelProfile['pricing'] {
  if (!isRecord(v)) return undefined;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : undefined);
  const inPerM = n(v.inPerM);
  const outPerM = n(v.outPerM);
  if (inPerM === undefined || outPerM === undefined) return undefined;
  return { inPerM, cachedInPerM: n(v.cachedInPerM) ?? inPerM, outPerM };
}

/** A stored profile, or null. Concurrency and chunk size fall back to the §4.3.1 defaults (2, 1200). */
export function cleanProfile(raw: unknown): ModelProfile | null {
  if (!isRecord(raw)) return null;
  const { id, connectionId, model } = raw;
  if (!nonEmpty(id) || !nonEmpty(connectionId) || !nonEmpty(model)) return null;
  const pricing = cleanPricing(raw.pricing);
  return {
    id,
    connectionId,
    model,
    ...(raw.protocolOverride !== 'auto' && oneOf(raw.protocolOverride, PROTOCOLS) ? { protocolOverride: raw.protocolOverride as Protocol } : {}),
    ...(typeof raw.temperature === 'number' && Number.isFinite(raw.temperature) ? { temperature: raw.temperature } : {}),
    maxConcurrency: positiveInt(raw.maxConcurrency, 2, 16),
    chunkTokens: positiveInt(raw.chunkTokens, 1200, 32_000),
    ...(typeof raw.contextWindow === 'number' && raw.contextWindow > 0 ? { contextWindow: Math.round(raw.contextWindow) } : {}),
    ...(pricing ? { pricing } : {}),
    ...(isRecord(raw.quirks) ? { quirks: raw.quirks as Quirks } : {}),
  };
}

export function cleanSiteRules(raw: unknown): SiteRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): SiteRule[] => {
    if (!isRecord(r) || !nonEmpty(r.translate) || typeof r.pattern !== 'string') return [];
    const pattern = r.pattern.trim().toLowerCase();
    if (pattern === '' || pattern === '*.') return [];
    return [{ pattern, translate: r.translate, ...(r.localOnly === true ? { localOnly: true } : {}) }];
  });
}

/** Routing without its site rules (stored apart); null without a `translate` id. */
export function cleanRouting(raw: unknown): Omit<Routing, 'siteOverrides'> | null {
  if (!isRecord(raw) || !nonEmpty(raw.translate)) return null;
  const fallback = Array.isArray(raw.fallback) ? raw.fallback.filter(nonEmpty) : [];
  return {
    translate: raw.translate,
    ...(nonEmpty(raw.analyze) ? { analyze: raw.analyze } : {}),
    ...(nonEmpty(raw.review) ? { review: raw.review } : {}),
    ...(fallback.length > 0 ? { fallback } : {}),
  };
}

/**
 * The provider settings in a sync snapshot, with this device's `migratedRoute` (storage.local);
 * null before the migration (no schema version).
 */
export function parseStored(items: Record<string, unknown>, migratedRoute?: unknown): ProviderSettings | null {
  const version = items[SCHEMA_KEY];
  if (typeof version !== 'number') return null;
  const connections: ProviderConnection[] = [];
  const profiles: ModelProfile[] = [];
  for (const [key, value] of Object.entries(items)) {
    if (key.startsWith(CONNECTION_PREFIX)) {
      const c = cleanConnection(value);
      if (c && connectionKey(c.id) === key) connections.push(c);
    } else if (key.startsWith(PROFILE_PREFIX)) {
      const p = cleanProfile(value);
      if (p && profileKey(p.id) === key) profiles.push(p);
    }
  }
  // A built-in connection not stored applies as built in, never written (see above); one with no
  // profile stored (built in, or one a learned quirk wrote) has its built-in profiles.
  const implicit = { connections: [] as string[], profiles: [] as string[] };
  for (const c of BUILTIN_CONNECTIONS) {
    if (connections.some((x) => x.id === c.id)) continue;
    connections.push(structuredClone(c));
    implicit.connections.push(c.id);
  }
  for (const c of BUILTIN_CONNECTIONS) {
    if (profiles.some((p) => p.connectionId === c.id)) continue;
    for (const p of BUILTIN_PROFILES) {
      if (p.connectionId !== c.id || profiles.some((x) => x.id === p.id)) continue;
      profiles.push(structuredClone(p));
      implicit.profiles.push(p.id);
    }
  }
  const sites = cleanSiteRules(items[SITE_RULES_KEY]);
  const stored = cleanRouting(items[ROUTING_KEY]);
  const routing = stored ?? cleanRouting(migratedRoute) ?? { translate: DEFAULT_PROFILE.id };
  return { schemaVersion: version, connections, profiles, routing: sites.length > 0 ? { ...routing, siteOverrides: sites } : routing, implicit, routingStored: stored !== null };
}

/** The sync items for `settings` (schema version included). */
export function toSyncItems(settings: ProviderSettings): Record<string, unknown> {
  const { siteOverrides, ...routing } = settings.routing;
  return {
    [SCHEMA_KEY]: settings.schemaVersion,
    ...Object.fromEntries(settings.connections.map((c) => [connectionKey(c.id), c])),
    ...Object.fromEntries(settings.profiles.map((p) => [profileKey(p.id), p])),
    [ROUTING_KEY]: routing,
    ...(siteOverrides && siteOverrides.length > 0 ? { [SITE_RULES_KEY]: siteOverrides } : {}),
  };
}

// ---- Migration ----------------------------------------------------------------------------

/** The built-in connections this device holds a key for (M1–M3 kept each under `secret:<builtin id>`). */
async function keyedBuiltins(api: Browser): Promise<Set<string>> {
  const keyed = new Set<string>();
  for (const c of BUILTIN_CONNECTIONS) if ((await readApiKey(api, c.id)) !== undefined) keyed.add(c.id);
  return keyed;
}

/**
 * Schema 1 from M1–M3 storage, which held no connections: the extension used built-in constants
 * and kept each key under `secret:<builtin id>` (M1: Gemini, from M2: APIBOX). What this device's
 * keys say, as sync items: every built-in connection with a key, with its built-in profiles. A
 * device without keys contributes nothing but the version: the built-ins apply at read time.
 */
export async function seedFromM1(api: Browser): Promise<Record<string, unknown>> {
  const keyed = await keyedBuiltins(api);
  return {
    [SCHEMA_KEY]: SCHEMA_VERSION,
    ...Object.fromEntries(BUILTIN_CONNECTIONS.filter((c) => keyed.has(c.id)).map((c) => [connectionKey(c.id), structuredClone(c)])),
    ...Object.fromEntries(BUILTIN_PROFILES.filter((p) => keyed.has(p.connectionId)).map((p) => [profileKey(p.id), structuredClone(p)])),
  };
}

/**
 * This device's `migratedRoute`: when only a connection other than the default has a key (an M1
 * user with a Gemini key), that connection's first profile, so nothing is re-entered (plan M4
 * §3 #7); else {} (the default applies).
 */
export async function migratedRouteFromM1(api: Browser): Promise<{ translate?: string }> {
  const keyed = await keyedBuiltins(api);
  if (keyed.has(DEFAULT_CONNECTION.id)) return {};
  const other = BUILTIN_CONNECTIONS.find((c) => keyed.has(c.id));
  const route = other && BUILTIN_PROFILES.find((p) => p.connectionId === other.id)?.id;
  return route ? { translate: route } : {};
}

const migrations = new WeakMap<object, Promise<ProviderSettings>>();

/**
 * Brings storage.sync to the current schema and returns the settings. Idempotent: storage that
 * already has a schema version is read, not rewritten. Items already stored (another device
 * synced them before the version) are never overwritten, and `routing` is never written here. A
 * version newer than this build knows is read as it is, never downgraded. Each device derives its
 * own `migratedRoute` once (storage.local), even when another device migrated sync first. One
 * migration at a time per `api` in this context.
 */
export function migrateProviders(api: Browser): Promise<ProviderSettings> {
  const running = migrations.get(api);
  if (running) return running;
  const run = (async () => {
    const [items, local] = await Promise.all([api.storage.sync.get(null), api.storage.local.get(MIGRATED_ROUTE_KEY)]);
    let route: unknown = local[MIGRATED_ROUTE_KEY];
    if (!(MIGRATED_ROUTE_KEY in local)) {
      route = await migratedRouteFromM1(api);
      // A failed write applies anyway and is derived again on the next read.
      try {
        await api.storage.local.set({ [MIGRATED_ROUTE_KEY]: route });
      } catch (err) {
        console.warn('[translate-side] could not save the migrated route', err);
      }
    }
    const stored = parseStored(items, route);
    if (stored) return stored;
    const seed = Object.fromEntries(Object.entries(await seedFromM1(api)).filter(([k]) => !(k in items)));
    // One set call: the schema version is written with the records it describes. A failed write
    // (quota, sync off) leaves storage as it was: the settings still apply, and the next read migrates again.
    try {
      await api.storage.sync.set(seed);
    } catch (err) {
      console.warn('[translate-side] could not save the migrated provider settings', err);
    }
    return parseStored({ ...items, ...seed }, route) as ProviderSettings;
  })();
  migrations.set(api, run);
  const clear = () => {
    if (migrations.get(api) === run) migrations.delete(api);
  };
  run.then(clear, clear);
  return run;
}

/** The stored provider settings, migrated first if needed. */
export const readProviderSettings = migrateProviders;

// ---- Writes ---------------------------------------------------------------------------------

let writes: Promise<unknown> = Promise.resolve();

/** Runs storage updates one after another, each on what the last one wrote. */
function queued<T>(task: () => Promise<T>): Promise<T> {
  const run = writes.then(task);
  writes = run.catch(() => undefined);
  return run;
}

/**
 * Refuses a write that would not fit chrome.storage.sync (it would fail anyway, with a raw
 * error), like the glossary's guard (settings.ts saveGlossary): an item over the per-item quota,
 * the total over the sync quota, or more items than Chrome keeps. `items` are the keys to set,
 * `removed` the keys the same write drops.
 */
async function checkQuota(api: Browser, items: Record<string, unknown>, removed: readonly string[] = []): Promise<void> {
  for (const [key, value] of Object.entries(items)) {
    const bytes = syncItemBytes(key, value);
    if (bytes > SYNC_QUOTA_BYTES_PER_ITEM) throw new Error(`This setting would take ${bytes} bytes, over Chrome's sync limit of ${SYNC_QUOTA_BYTES_PER_ITEM} bytes for one setting. Shorten it (fewer extra headers or a shorter label).`);
  }
  const stored = await api.storage.sync.get(null);
  const replaced = [...Object.keys(items), ...removed].filter((k) => k in stored);
  const added = Object.keys(items).filter((k) => !(k in stored)).length;
  if (Object.keys(stored).length + added - removed.filter((k) => k in stored).length > SYNC_MAX_ITEMS) {
    throw new Error(`Synced settings would exceed Chrome's limit of ${SYNC_MAX_ITEMS} items. Remove some connections, models or site rules.`);
  }
  const sync = api.storage.sync as { getBytesInUse?: (keys?: string | string[] | null) => Promise<number> };
  if (typeof sync.getBytesInUse !== 'function') return;
  const [total, current] = await Promise.all([sync.getBytesInUse(null), replaced.length > 0 ? sync.getBytesInUse(replaced) : 0]);
  const next = Object.entries(items).reduce((n, [k, v]) => n + syncItemBytes(k, v), 0);
  if (total - current + next > SYNC_QUOTA_BYTES) {
    throw new Error(`Synced settings would exceed Chrome's ${SYNC_QUOTA_BYTES}-byte limit. Remove some connections, models, site rules or glossary entries.`);
  }
}

const CONNECTION_FIELDS = new Set(['id', 'label', 'presetId', 'protocol', 'baseUrl', 'auth', 'extraHeaders', 'queryParams', 'quirks', 'detectedProtocols', 'status', 'lastError', 'lastErrorKind']);
const PROFILE_FIELDS = new Set(['id', 'connectionId', 'model', 'protocolOverride', 'temperature', 'maxConcurrency', 'chunkTokens', 'contextWindow', 'pricing', 'quirks']);

/**
 * `clean` with the fields of the stored record this build does not know (a newer schema wrote
 * them), so editing a record here never drops them. Unknown fields come only from storage, never
 * from the caller's input (`clean` has none).
 */
function keepUnknown<T extends object>(stored: unknown, known: ReadonlySet<string>, clean: T): T {
  if (!isRecord(stored)) return clean;
  const unknown = Object.fromEntries(Object.entries(stored).filter(([k]) => !known.has(k)));
  return { ...unknown, ...clean };
}

async function storedItem(api: Browser, key: string): Promise<unknown> {
  return (await api.storage.sync.get(key))[key];
}

export function saveConnection(api: Browser, connection: ProviderConnection): Promise<void> {
  return queued(async () => {
    await migrateProviders(api);
    const clean = cleanConnection(connection);
    if (!clean) throw new Error('not a valid connection');
    const key = connectionKey(clean.id);
    const value = keepUnknown(await storedItem(api, key), CONNECTION_FIELDS, clean);
    await checkQuota(api, { [key]: value });
    await api.storage.sync.set({ [key]: value });
  });
}

export function saveProfile(api: Browser, profile: ModelProfile): Promise<void> {
  return queued(async () => {
    await migrateProviders(api);
    const clean = cleanProfile(profile);
    if (!clean) throw new Error('not a valid model profile');
    const key = profileKey(clean.id);
    const value = keepUnknown(await storedItem(api, key), PROFILE_FIELDS, clean);
    await checkQuota(api, { [key]: value });
    await api.storage.sync.set({ [key]: value });
  });
}

const ROUTING_FIELDS = new Set(['translate', 'analyze', 'review', 'fallback']);

/**
 * Routing and its site rules, in one write. Without site rules their item is set to an empty
 * list rather than removed, so the two never disagree after a failure half way.
 */
export function saveRouting(api: Browser, routing: Routing): Promise<void> {
  return queued(async () => {
    await migrateProviders(api);
    const clean = cleanRouting(routing);
    if (!clean) throw new Error('routing needs a translate profile');
    const items = { [ROUTING_KEY]: keepUnknown(await storedItem(api, ROUTING_KEY), ROUTING_FIELDS, clean), [SITE_RULES_KEY]: cleanSiteRules(routing.siteOverrides) };
    await checkQuota(api, items);
    await api.storage.sync.set(items);
  });
}

/**
 * Persists a quirk the adapter learned (§4.2.4, sdk.ts `onQuirkLearned`): only the flag that
 * changed, never the whole merged set the adapter worked with (it holds the profile's quirks over
 * the connection's). It goes on the profile when the profile sets that flag itself (there it would
 * shadow the connection's), otherwise on the connection. The stored record is updated as it is
 * (fields this build does not know included); a built-in one that only applies at read time is
 * written from its constant. Anything else unknown is left alone.
 */
export function saveLearnedQuirk(api: Browser, at: { connectionId: string; profileId?: string }, learned: keyof Quirks, quirks: Quirks): Promise<void> {
  return queued(async () => {
    const value = quirks[learned];
    const update = async (key: string, raw: unknown) => {
      const record = raw as { quirks?: Quirks };
      const next = { ...record, quirks: { ...(isRecord(record.quirks) ? record.quirks : {}), [learned]: value } };
      await checkQuota(api, { [key]: next });
      await api.storage.sync.set({ [key]: next });
    };
    if (at.profileId !== undefined) {
      const key = profileKey(at.profileId);
      const raw = (await storedItem(api, key)) ?? BUILTIN_PROFILES.find((p) => p.id === at.profileId);
      const profile = cleanProfile(raw);
      if (profile && profile.quirks && learned in profile.quirks) return update(key, raw);
    }
    const key = connectionKey(at.connectionId);
    const raw = (await storedItem(api, key)) ?? BUILTIN_CONNECTIONS.find((c) => c.id === at.connectionId);
    if (cleanConnection(raw)) await update(key, raw);
  });
}

// ---- Adding and removing (the settings' Providers section, plan M4-E3, M4-E4) -----------------

/** Does this device hold what `connection` needs to send a request: a key, or auth `none`? */
export async function isUsable(api: Browser, connection: ProviderConnection): Promise<boolean> {
  return connection.auth.style === 'none' || (await readApiKey(api, connection.id)) !== undefined;
}

export interface SetupInput {
  connection: ProviderConnection;
  /** A new key to store (storage.local, never synced); undefined keeps the stored one. */
  apiKey?: string | undefined;
  /** The profile for the chosen model; none when only the connection changed. */
  profile?: ModelProfile | undefined;
}

/**
 * Saves a connection from the add / edit form: its key (storage.local), the connection, and the
 * profile for the chosen model (§4.3.3 step 5). The profile becomes the translate route when it is
 * the first one: the user never chose a route (no stored `routing`) and the route in effect cannot
 * run on this device (no key), as on a fresh install. A device already translating with a
 * migrated or default route keeps it until the user picks another (carry-over B4). Returns
 * whether the route was set.
 */
export async function saveSetup(api: Browser, input: SetupInput): Promise<{ routed: boolean }> {
  const before = await readProviderSettings(api);
  if (input.apiKey !== undefined && input.apiKey.trim() !== '') await saveApiKey(api, input.connection.id, input.apiKey);
  await saveConnection(api, input.connection);
  if (!input.profile) return { routed: false };
  await saveProfile(api, input.profile);
  if (before.routingStored) return { routed: false };
  const current = resolveRouteIn(before, 'translate');
  if (current.ok && current.connection.id !== input.connection.id && (await isUsable(api, current.connection))) return { routed: false };
  await saveRouting(api, { ...before.routing, translate: input.profile.id });
  return { routed: true };
}

/** Routing without references to `removed` profiles; null when `translate` itself was removed and nothing can take its place. */
function routingWithout(routing: Routing, removed: ReadonlySet<string>, replacement: string | undefined): Routing | null {
  const translate = removed.has(routing.translate) ? replacement : routing.translate;
  if (translate === undefined) return null;
  const fallback = routing.fallback?.filter((id) => !removed.has(id));
  return {
    translate,
    ...(routing.analyze !== undefined && !removed.has(routing.analyze) ? { analyze: routing.analyze } : {}),
    ...(routing.review !== undefined && !removed.has(routing.review) ? { review: routing.review } : {}),
    ...(fallback && fallback.length > 0 ? { fallback } : {}),
    ...(routing.siteOverrides ? { siteOverrides: routing.siteOverrides } : {}),
  };
}

/**
 * Removes a connection (§4.3.4, plan M4 §3 #8): its record, its profiles, its key, and the host
 * permission for its origin when no other connection in use (stored, or with a key here) has the
 * same origin. Routing that pointed at its profiles moves to another usable profile, or, when
 * there is none, is removed (the migrated or built-in default applies). A built-in connection
 * still applies afterwards, as built in and without a key: the settings say so. Site rules are
 * left as they are: one whose profile is gone stops with an error rather than sending the site's
 * text elsewhere (§4.3.5).
 */
export async function removeConnection(api: Browser, id: string): Promise<{ revoked: boolean }> {
  const settings = await readProviderSettings(api);
  const connection = settings.connections.find((c) => c.id === id);
  const removed = new Set(settings.profiles.filter((p) => p.connectionId === id).map((p) => p.id));
  await removeApiKey(api, id);
  await queued(async () => {
    const items = await api.storage.sync.get(null);
    const keys = [connectionKey(id), ...[...removed].map(profileKey)].filter((k) => k in items);
    const stored = cleanRouting(items[ROUTING_KEY]);
    let routing: Routing | null | undefined;
    if (stored) {
      const candidates = settings.profiles.filter((p) => !removed.has(p.id));
      let replacement: string | undefined;
      for (const p of candidates) {
        const c = settings.connections.find((x) => x.id === p.connectionId);
        if (c && (await isUsable(api, c))) {
          replacement = p.id;
          break;
        }
      }
      routing = routingWithout(stored, removed, replacement);
    }
    if (keys.length > 0) await api.storage.sync.remove(keys);
    if (routing === null) await api.storage.sync.remove(ROUTING_KEY);
    else if (routing !== undefined) await api.storage.sync.set({ [ROUTING_KEY]: routing });
  });
  if (!connection) return { revoked: false };
  return { revoked: await revokeUnusedOrigin(api, connection.baseUrl, id) };
}

/**
 * Gives back the host permission for `baseUrl`'s origin unless another connection in use needs it
 * (§4.3.4). `except` is the connection being removed or moved.
 */
export async function revokeUnusedOrigin(api: Browser, baseUrl: string, except: string): Promise<boolean> {
  let origin: string;
  try {
    origin = originPattern(baseUrl);
  } catch {
    return false;
  }
  const settings = await readProviderSettings(api);
  for (const c of settings.connections) {
    if (c.id === except) continue;
    let other: string;
    try {
      other = originPattern(c.baseUrl);
    } catch {
      continue;
    }
    if (other !== origin) continue;
    if (!settings.implicit?.connections.includes(c.id) || (await readApiKey(api, c.id)) !== undefined) return false;
  }
  return api.permissions.remove({ origins: [origin] }).catch(() => false);
}

/**
 * Removes a model profile. The one the translate route uses can't be removed (choose another
 * first); a Document brief or fallback route to it is dropped (it then follows translate).
 */
export async function removeProfile(api: Browser, id: string): Promise<void> {
  const settings = await readProviderSettings(api);
  if (settings.routing.translate === id) throw new Error('This model is used to translate. Choose another one under Routing first.');
  await queued(async () => {
    const items = await api.storage.sync.get(null);
    if (profileKey(id) in items) await api.storage.sync.remove(profileKey(id));
    const stored = cleanRouting(items[ROUTING_KEY]);
    const routing = stored && routingWithout(stored, new Set([id]), undefined);
    if (stored && routing && JSON.stringify(routing) !== JSON.stringify(stored)) await api.storage.sync.set({ [ROUTING_KEY]: routing });
  });
}

// ---- Tab overrides (storage.session) ----------------------------------------------------------

export async function readTabOverride(api: Browser, tabId: number): Promise<string | undefined> {
  const key = tabRouteKey(tabId);
  const value = (await api.storage.session.get(key))[key];
  return nonEmpty(value) ? value : undefined;
}

export async function setTabOverride(api: Browser, tabId: number, profileId: string): Promise<void> {
  await api.storage.session.set({ [tabRouteKey(tabId)]: profileId });
}

export async function clearTabOverride(api: Browser, tabId: number): Promise<void> {
  await api.storage.session.remove(tabRouteKey(tabId));
}

// ---- Resolution (§4.3.5 Resolve, plan M4-E8) -------------------------------------------------

/** Does `url`'s host match a site rule's pattern? `*.example.com` matches example.com and its subdomains. */
export function matchesSite(pattern: string, url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const p = pattern.trim().toLowerCase();
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return base !== '' && (host === base || host.endsWith(`.${base}`));
  }
  return host === p;
}

/** The first site rule (in stored order) that matches `url`. */
export function siteRuleFor(routing: Routing, url: string | undefined): SiteRule | undefined {
  return url === undefined ? undefined : routing.siteOverrides?.find((r) => matchesSite(r.pattern, url));
}

export interface RouteContext {
  /** The page the job translates: site rules match its host. */
  url?: string | undefined;
  /** The tab's override (a profile id), from the quick switcher. */
  tabProfileId?: string | undefined;
}

export type RouteSource = 'site' | 'tab' | 'routing';

export type Route =
  | { ok: true; profile: ModelProfile; connection: ProviderConnection; source: RouteSource; localOnly: boolean; rule?: SiteRule }
  | { ok: false; message: string; source: RouteSource; connection?: ProviderConnection };

/**
 * The profile a role runs on (§4.3.5, plan M4-E8). `translate`: the first matching site rule,
 * then the tab override, then `routing.translate`. `analyze` and `review`: their own route when
 * set, else whatever `translate` resolved to; a local-only site rule holds every role, so a
 * cloud analyze profile never sees that site's text. A site rule whose profile is gone is an
 * error, not a fall-through (it would send the page elsewhere than the user chose); a tab
 * override whose profile is gone is ignored (session state, e.g. the profile was removed).
 */
export function resolveRouteIn(settings: ProviderSettings, role: ModelRole, ctx: RouteContext = {}): Route {
  const profiles = new Map(settings.profiles.map((p) => [p.id, p]));
  const connections = new Map(settings.connections.map((c) => [c.id, c]));
  const pick = (id: string, source: RouteSource, extra: { localOnly?: boolean; rule?: SiteRule } = {}): Route => {
    const profile = profiles.get(id);
    if (!profile) return { ok: false, source, message: `The ${ROLE_LABELS[role].toLowerCase()} route points at a model that no longer exists. Choose a model in settings.` };
    const connection = connections.get(profile.connectionId);
    if (!connection) return { ok: false, source, message: `The model ${profile.model} has no connection. Set it up again in settings.` };
    return { ok: true, profile, connection, source, localOnly: extra.localOnly === true, ...(extra.rule ? { rule: extra.rule } : {}) };
  };
  const rule = siteRuleFor(settings.routing, ctx.url);
  if (role !== 'translate') {
    const own = role === 'analyze' ? settings.routing.analyze : settings.routing.review;
    if (own !== undefined && !rule?.localOnly) return pick(own, 'routing');
  }
  if (rule) return pick(rule.translate, 'site', { localOnly: rule.localOnly === true, rule });
  if (ctx.tabProfileId !== undefined && profiles.has(ctx.tabProfileId)) return pick(ctx.tabProfileId, 'tab');
  return pick(settings.routing.translate, 'routing');
}

/** `resolveRouteIn` on the stored settings and the tab's override. */
export async function resolveRoute(api: Browser, role: ModelRole, ctx: { url?: string | undefined; tabId?: number | undefined } = {}): Promise<Route> {
  const [settings, tabProfileId] = await Promise.all([
    readProviderSettings(api),
    ctx.tabId === undefined ? undefined : readTabOverride(api, ctx.tabId).catch(() => undefined),
  ]);
  return resolveRouteIn(settings, role, { url: ctx.url, tabProfileId });
}
