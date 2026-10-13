// Settings export and import as JSON (DESIGN.md §4.3.7, plan M5-E9).
//
// The file holds what storage.sync holds for the user: connections, model profiles, routing with
// its site rules, preferences, the personal glossary and the site lists. API keys (storage.local
// `secret:<id>`, §4.3.4) are left out unless the user ticks "include keys" and confirms. Device-only
// data (the spend log, the privacy acknowledgement, onboarding, the cache) never goes in.
//
// A file is untrusted input (§8): it is parsed, bounded and cleaned field by field, and nothing it
// says is applied until the user has seen what it would change. An import merges: records the file
// does not have stay as they are, and a key is written only when the file carries one for that
// connection and the user asked for keys to be imported. Whatever is skipped or ignored is listed
// in `notes`, never dropped silently.
import type { browser } from 'wxt/browser';
import { i18n } from '#i18n';
import type { GlossaryEntry } from '@/engine/types';
import type { Quirks } from '@/llm/types';
import {
  BASIC_FALLBACK,
  BASIC_MIGRATED_FIELD,
  cleanConnection,
  cleanProfile,
  cleanRouting,
  cleanSiteRules,
  connectionKey,
  profileKey,
  queued,
  readProviderSettings,
  ROUTING_KEY,
  SCHEMA_VERSION,
  SITE_RULES_KEY,
  type Routing,
  type SiteRule,
} from './providers.ts';
import {
  cleanBudget,
  cleanGlossary,
  GLOSS_MODES,
  GLOSSARY_KEY,
  PREFS_KEY,
  readGlossary,
  readPreferences,
  SECRET_PREFIX,
  secretKey,
  STYLES,
  type ModelProfile,
  type Preferences,
  type ProviderConnection,
} from './settings.ts';
import { cleanSiteList, readSiteLists, SITE_ALLOWLIST_KEY, SITE_NEVER_KEY, sitePattern } from './sites.ts';
import { cleanQuality, hasKnownQuality, QUALITY_KEY, readQuality, type Quality } from './quality.ts';
import { assertFits, saveListWithOverflow } from './sync-quota.ts';

type Browser = typeof browser;

export const EXPORT_FORMAT = 'translate-side-settings';
export const EXPORT_VERSION = 1;
/** An import larger than this is refused unread: real settings are a few KB. */
export const MAX_IMPORT_BYTES = 1_000_000;

const MAX_CONNECTIONS = 100;
const MAX_PROFILES = 400;
const MAX_SITE_RULES = 1000;
const MAX_GLOSSARY = 5000;
const MAX_KEY_LENGTH = 4096;

const ID_RE = /^[A-Za-z0-9._-]{1,100}$/;
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;
/** Names that carry a credential: a header or query parameter with one of these is a key in disguise. */
const SENSITIVE_NAME = /auth|key|token|secret|passw|cookie|credential|signature|bearer|sig$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  formatVersion: number;
  exportedAt: string;
  /** True only when the user chose to include keys; `keys` is then present. */
  keysIncluded: boolean;
  settings: {
    schemaVersion: number;
    connections: ProviderConnection[];
    profiles: ModelProfile[];
    routing?: Omit<Routing, 'siteOverrides'>;
    siteRules: SiteRule[];
    prefs: Preferences;
    /** The quality setting (its own sync item); a file from before it existed has none. */
    quality?: Quality;
    glossary: GlossaryEntry[];
    siteAllowlist: string[];
    siteNever: string[];
  };
  keys?: Record<string, string>;
}

export interface ExportResult {
  file: ExportFile;
  json: string;
  /** Header and query-parameter values (and URL credentials) left out because their names look like keys. */
  omitted: string[];
  /** Strings left in the file that look like a key (a key can hide in a label or a URL path, which the name-based redaction cannot see). */
  suspects: string[];
  keyCount: number;
}

// ---- Export ---------------------------------------------------------------------------------

/** A connection without its test outcome: that is device state, so it travels as unverified. */
function portableConnection(c: ProviderConnection): ProviderConnection {
  const out: ProviderConnection = { ...c, status: 'unverified' };
  delete out.lastError;
  delete out.lastErrorKind;
  return out;
}

/** An address with its credentials and key-named query parameters removed; `removed` says what went (`credentials`, `param:<name>`). Not a URL: returned as is. */
export function redactAddress(address: string): { url: string; removed: string[] } {
  const removed: string[] = [];
  try {
    const url = new URL(address);
    if (url.username !== '' || url.password !== '') {
      url.username = '';
      url.password = '';
      removed.push('credentials');
    }
    for (const name of [...url.searchParams.keys()]) {
      if (!SENSITIVE_NAME.test(name)) continue;
      url.searchParams.delete(name);
      removed.push(`param:${name}`);
    }
    if (removed.length > 0) return { url: url.toString().replace(/\/$/, address.endsWith('/') ? '/' : ''), removed };
  } catch {
    // Not a URL (a built-in with no base): nothing to strip.
  }
  return { url: address, removed };
}

function redactConnection(c: ProviderConnection, omitted: string[]): ProviderConnection {
  const out: ProviderConnection = { ...c };
  const drop = (kind: string, record: Record<string, string> | undefined) => {
    if (!record) return undefined;
    const kept = Object.fromEntries(Object.entries(record).filter(([name]) => !SENSITIVE_NAME.test(name) || (omitted.push(i18n.t(kind === 'header' ? 'options.portable.header' : 'options.portable.queryParam', { label: c.label, name })), false)));
    return Object.keys(kept).length > 0 ? kept : undefined;
  };
  const headers = drop('header', c.extraHeaders);
  const params = drop('query parameter', c.queryParams);
  delete out.extraHeaders;
  delete out.queryParams;
  if (headers) out.extraHeaders = headers;
  if (params) out.queryParams = params;
  const base = redactAddress(c.baseUrl);
  for (const what of base.removed) omitted.push(what === 'credentials' ? i18n.t('options.portable.credentials', { label: c.label }) : i18n.t('options.portable.urlParam', { label: c.label, name: what.slice('param:'.length) }));
  if (base.removed.length > 0) out.baseUrl = base.url;
  return out;
}

/**
 * The settings file. Keys are read and included only with `includeKeys`; without it the file
 * holds no secret: header and parameter values that look like one are left out too (`omitted`).
 * A connection's test outcome is device state, so it is written as unverified.
 */
export async function buildExport(api: Browser, { includeKeys = false, now = () => new Date() }: { includeKeys?: boolean; now?: () => Date } = {}): Promise<ExportResult> {
  const [settings, prefs, quality, glossary, lists] = await Promise.all([readProviderSettings(api), readPreferences(api), readQuality(api), readGlossary(api), readSiteLists(api)]);
  const implicit = settings.implicit ?? { connections: [], profiles: [] };
  const omitted: string[] = [];
  const connections = settings.connections
    .filter((c) => !implicit.connections.includes(c.id))
    .map((c) => {
      const portable = portableConnection(c);
      return includeKeys ? portable : redactConnection(portable, omitted);
    });
  const profiles = settings.profiles.filter((p) => !implicit.profiles.includes(p.id));
  const { siteOverrides, ...routing } = settings.routing;
  let keys: Record<string, string> | undefined;
  if (includeKeys) {
    const got = await api.storage.local.get(settings.connections.map((c) => secretKey(c.id)));
    keys = Object.fromEntries(
      settings.connections.flatMap((c): [string, string][] => {
        const v = got[secretKey(c.id)];
        return typeof v === 'string' && v !== '' ? [[c.id, v]] : [];
      }),
    );
  }
  const file: ExportFile = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_VERSION,
    exportedAt: now().toISOString(),
    keysIncluded: includeKeys,
    settings: {
      schemaVersion: SCHEMA_VERSION,
      connections,
      profiles,
      ...(settings.routingStored ? { routing } : {}),
      siteRules: siteOverrides ?? [],
      prefs,
      quality,
      glossary,
      siteAllowlist: lists.allow,
      siteNever: lists.never,
    },
    ...(keys ? { keys } : {}),
  };
  return { file, json: `${JSON.stringify(file, null, 2)}\n`, omitted, suspects: includeKeys ? [] : findSuspects(connections), keyCount: keys ? Object.keys(keys).length : 0 };
}

const KEY_LIKE = /(?:\b(?:sk|pk|rk|ak)-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|\b[A-Za-z0-9_-]{32,}\b)/;

/** Where, in the connections as exported, a string looks like a key. */
function findSuspects(connections: readonly ProviderConnection[]): string[] {
  const out: string[] = [];
  for (const c of connections) {
    const fields: [string, string][] = [
      [i18n.t('options.portable.suspectLabel', { label: c.label }), c.label],
      [i18n.t('options.portable.suspectBaseUrl', { label: c.label }), c.baseUrl],
      ...Object.entries(c.extraHeaders ?? {}).map(([name, v]): [string, string] => [i18n.t('options.portable.header', { label: c.label, name }), v]),
      ...Object.entries(c.queryParams ?? {}).map(([name, v]): [string, string] => [i18n.t('options.portable.queryParam', { label: c.label, name }), v]),
    ];
    for (const [where, value] of fields) if (KEY_LIKE.test(value)) out.push(where);
  }
  return out;
}

export const exportFileName = (now: Date = new Date()) => `translate-side-settings-${now.toISOString().slice(0, 10)}.json`;

// ---- Import: parse and validate ---------------------------------------------------------------

export interface ImportPlan {
  connections: ProviderConnection[];
  profiles: ModelProfile[];
  routing?: Omit<Routing, 'siteOverrides'>;
  siteRules: SiteRule[];
  prefs?: Partial<Preferences>;
  quality?: Quality;
  glossary?: GlossaryEntry[];
  allow?: string[];
  never?: string[];
  /** connection id → key, as the file carries them (applied only when the user asks). */
  keys: Record<string, string>;
  /** What was skipped or ignored in the file, in words. */
  notes: string[];
}

export type ParseResult = { ok: true; plan: ImportPlan } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const okString = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !CONTROL_RE.test(v);

function cleanQuirks(raw: unknown): Quirks | undefined {
  if (!isRecord(raw)) return undefined;
  const q: Quirks = {};
  if (raw.maxTokensParam === 'max_tokens' || raw.maxTokensParam === 'max_completion_tokens') q.maxTokensParam = raw.maxTokensParam;
  for (const f of ['supportsTemperature', 'supportsSystemRole', 'supportsStreamUsage', 'supportsJsonMode', 'supportsCacheControl'] as const) {
    if (typeof raw[f] === 'boolean') q[f] = raw[f];
  }
  if (okString(raw.modelIdPrefix, 50)) q.modelIdPrefix = raw.modelIdPrefix;
  const r = raw.reasoning;
  const level = (v: unknown): v is string | number => (typeof v === 'string' && v.length <= 30) || (typeof v === 'number' && Number.isFinite(v));
  if (isRecord(r) && (r.control === 'effort' || r.control === 'budget' || r.control === 'none') && level(r.lowest) && typeof r.reserveTokens === 'number' && Number.isFinite(r.reserveTokens)) {
    const byChunk = Array.isArray(r.byChunk)
      ? r.byChunk.flatMap((b): { fromChunk: number; lowest: string | number; reserveTokens: number }[] =>
          isRecord(b) && typeof b.fromChunk === 'number' && Number.isFinite(b.fromChunk) && level(b.lowest) && typeof b.reserveTokens === 'number' && Number.isFinite(b.reserveTokens)
            ? [{ fromChunk: b.fromChunk, lowest: b.lowest, reserveTokens: b.reserveTokens }]
            : [],
        )
      : [];
    q.reasoning = { control: r.control, lowest: r.lowest, reserveTokens: r.reserveTokens, ...(byChunk.length > 0 ? { byChunk } : {}) };
  }
  return q;
}

function httpUrlOrEmpty(v: string): boolean {
  if (v === '') return true;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function importConnection(raw: unknown, notes: string[]): ProviderConnection | null {
  const c = cleanConnection(raw);
  const name = isRecord(raw) && typeof raw.id === 'string' ? raw.id.slice(0, 40) : '?';
  if (!c || !ID_RE.test(c.id)) {
    notes.push(i18n.t('options.portable.skipConnection', { name }));
    return null;
  }
  if (!okString(c.label, 200) || !okString(c.presetId, 100) || c.baseUrl.length > 2000 || !httpUrlOrEmpty(c.baseUrl)) {
    notes.push(i18n.t('options.portable.skipConnectionAddress', { id: c.id }));
    return null;
  }
  const headerOk = (r: Record<string, string> | undefined, nameRe: RegExp) => !r || Object.entries(r).every(([k, v]) => nameRe.test(k) && v.length <= 2000 && !CONTROL_RE.test(v));
  if (!headerOk(c.extraHeaders, HEADER_NAME_RE) || !headerOk(c.queryParams, /^.{1,100}$/)) {
    notes.push(i18n.t('options.portable.skipConnectionHeader', { id: c.id }));
    return null;
  }
  const authHeaders = [c.auth, ...Object.values(c.authByProtocol ?? {})].flatMap((a) => (a?.headerName === undefined ? [] : [a.headerName]));
  if (!authHeaders.every((h) => HEADER_NAME_RE.test(h))) {
    notes.push(i18n.t('options.portable.skipConnectionAuth', { id: c.id }));
    return null;
  }
  // Learned from this device's requests, not portable: re-detected on the first test.
  return { ...portableConnection(c), quirks: cleanQuirks(c.quirks) ?? {} };
}

function importProfile(raw: unknown, notes: string[]): ModelProfile | null {
  const p = cleanProfile(raw);
  if (!p || !ID_RE.test(p.id) || !ID_RE.test(p.connectionId) || !okString(p.model, 200)) {
    notes.push(i18n.t('options.portable.skipProfile', { id: isRecord(raw) && typeof raw.id === 'string' ? raw.id.slice(0, 40) : '?' }));
    return null;
  }
  const quirks = cleanQuirks(p.quirks);
  const out: ModelProfile = { ...p };
  delete out.quirks;
  return quirks ? { ...out, quirks } : out;
}

function importPrefs(raw: unknown, notes: string[]): Partial<Preferences> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Partial<Preferences> = {};
  const bad = (name: string) => notes.push(i18n.t('options.portable.ignorePref', { name }));
  const lang = (name: 'targetLang' | 'sourceLang') => {
    const v = raw[name];
    if (v === undefined) return;
    if (typeof v === 'string' && (LANG_RE.test(v) || (name === 'sourceLang' && v === 'auto'))) out[name] = v;
    else bad(name);
  };
  lang('targetLang');
  lang('sourceLang');
  if (raw.style !== undefined) {
    if (STYLES.includes(raw.style as never)) out.style = raw.style as Preferences['style'];
    else bad('style');
  }
  if (raw.gloss !== undefined) {
    if (GLOSS_MODES.includes(raw.gloss as never)) out.gloss = raw.gloss as Preferences['gloss'];
    else bad('gloss');
  }
  if (raw.budgetTokens !== undefined) {
    if (typeof raw.budgetTokens === 'number' && Number.isFinite(raw.budgetTokens) && raw.budgetTokens >= 0) out.budgetTokens = cleanBudget(raw.budgetTokens);
    else bad('budgetTokens');
  }
  for (const f of ['captions', 'altText'] as const) {
    const v = raw[f];
    if (v === undefined) continue;
    if (typeof v === 'boolean') out[f] = v;
    else bad(f);
  }
  return out;
}

/** The routing with every id bounded (ids name storage keys and are shown in the settings). */
function importRouting(raw: unknown, notes: string[]): ImportPlan['routing'] {
  if (raw === undefined) return undefined;
  const routing = cleanRouting(raw);
  if (!routing || !ID_RE.test(routing.translate)) {
    notes.push(i18n.t('options.portable.skipRouting'));
    return undefined;
  }
  const ok = (id: string | undefined) => id === undefined || ID_RE.test(id);
  const fallback = routing.fallback?.filter((id) => ID_RE.test(id));
  if (!ok(routing.analyze) || !ok(routing.review) || fallback?.length !== routing.fallback?.length) notes.push(i18n.t('options.portable.dropRoutingIds'));
  return {
    translate: routing.translate,
    ...(ok(routing.analyze) && routing.analyze ? { analyze: routing.analyze } : {}),
    ...(ok(routing.review) && routing.review ? { review: routing.review } : {}),
    ...(fallback && fallback.length > 0 ? { fallback } : {}),
  };
}

type Capped = 'connections' | 'profiles' | 'siteRules' | 'glossary';
const CAPPED_NOTE: Record<Capped, (vars: { count: string; max: string }) => string> = {
  connections: (v) => i18n.t('options.portable.cappedConnections', v),
  profiles: (v) => i18n.t('options.portable.cappedProfiles', v),
  siteRules: (v) => i18n.t('options.portable.cappedSiteRules', v),
  glossary: (v) => i18n.t('options.portable.cappedGlossary', v),
};

function capped<T>(list: readonly T[], max: number, what: Capped, notes: string[]): T[] {
  if (list.length > max) notes.push(CAPPED_NOTE[what]({ count: String(list.length), max: String(max) }));
  return list.slice(0, max);
}

/** Reads `text` as a settings file. Nothing is written; the result is what the file would bring. */
export function parseImport(text: string): ParseResult {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: i18n.t('options.portable.tooLarge') };
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, error: i18n.t('options.portable.notJson') };
  }
  if (!isRecord(root) || root.format !== EXPORT_FORMAT) return { ok: false, error: i18n.t('options.portable.notOurs') };
  if (typeof root.formatVersion !== 'number' || !Number.isInteger(root.formatVersion) || root.formatVersion < 1) return { ok: false, error: i18n.t('options.portable.noVersion') };
  if (root.formatVersion > EXPORT_VERSION) return { ok: false, error: i18n.t('options.portable.newerVersion') };
  const s = root.settings;
  if (!isRecord(s)) return { ok: false, error: i18n.t('options.portable.noSettings') };

  const notes: string[] = [];
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const seen = new Set<string>();
  const unique = <T extends { id: string }>(items: (T | null)[], what: 'connection' | 'profile'): T[] =>
    items.flatMap((i) => {
      if (!i) return [];
      if (seen.has(`${what}:${i.id}`)) return (notes.push(i18n.t(what === 'connection' ? 'options.portable.repeatedConnection' : 'options.portable.repeatedProfile', { id: i.id })), []);
      seen.add(`${what}:${i.id}`);
      return [i];
    });
  const rawConnections = capped(list(s.connections), MAX_CONNECTIONS, 'connections', notes);
  const connections = unique(rawConnections.map((c) => importConnection(c, notes)), 'connection');
  // A key travels with a connection that was read: one whose record was skipped brings none (it could be a key for the id of one you already have).
  const skippedIds = new Set(rawConnections.flatMap((c) => (isRecord(c) && typeof c.id === 'string' && !connections.some((k) => k.id === c.id) ? [c.id] : [])));
  const profiles = unique(capped(list(s.profiles), MAX_PROFILES, 'profiles', notes).map((p) => importProfile(p, notes)), 'profile');

  const routing = importRouting(s.routing, notes);
  const siteRules = cleanSiteRules(capped(list(s.siteRules), MAX_SITE_RULES, 'siteRules', notes)).filter((r) => ID_RE.test(r.translate) && sitePattern(r.pattern) === r.pattern);
  if (Array.isArray(s.siteRules) && siteRules.length < Math.min(s.siteRules.length, MAX_SITE_RULES)) notes.push(i18n.t('options.portable.skipSiteRules'));
  const glossary = Array.isArray(s.glossary) ? cleanGlossary(capped(s.glossary, MAX_GLOSSARY, 'glossary', notes)) : undefined;
  const prefs = importPrefs(s.prefs, notes);
  // An imported strategy is kept as written: whether `refine` may run is decided when a job starts.
  const quality = isRecord(s.quality) && hasKnownQuality(s.quality) ? cleanQuality(s.quality) : undefined;
  if (s.quality !== undefined && quality === undefined) notes.push(i18n.t('options.portable.skipQuality'));

  const keys: Record<string, string> = {};
  if (root.keys !== undefined) {
    if (!isRecord(root.keys)) notes.push(i18n.t('options.portable.keysInvalid'));
    else {
      for (const [id, value] of Object.entries(root.keys).slice(0, MAX_CONNECTIONS)) {
        const key = typeof value === 'string' ? value.trim() : '';
        if (skippedIds.has(id)) notes.push(i18n.t('options.portable.keyConnectionSkipped', { id: id.slice(0, 40) }));
        else if (!ID_RE.test(id) || key === '' || key.length > MAX_KEY_LENGTH || CONTROL_RE.test(key)) notes.push(i18n.t('options.portable.keyInvalid', { id: id.slice(0, 40) }));
        else Object.defineProperty(keys, id, { value: key, enumerable: true, writable: true, configurable: true });
      }
    }
  }
  return {
    ok: true,
    plan: {
      connections,
      profiles,
      ...(routing ? { routing } : {}),
      siteRules,
      ...(prefs && Object.keys(prefs).length > 0 ? { prefs } : {}),
      ...(quality ? { quality } : {}),
      ...(glossary ? { glossary } : {}),
      ...(Array.isArray(s.siteAllowlist) ? { allow: cleanSiteList(s.siteAllowlist) } : {}),
      ...(Array.isArray(s.siteNever) ? { never: cleanSiteList(s.siteNever) } : {}),
      keys,
      notes,
    },
  };
}

// ---- Import: what it would change, and the write ----------------------------------------------

export interface ImportReport {
  connections: { added: number; replaced: number };
  profiles: { added: number; replaced: number };
  routing: 'replaced' | 'kept' | 'none';
  siteRules: number;
  prefs: boolean;
  quality: boolean;
  glossary: number | null;
  sites: { allow: number; never: number };
  /**
   * Keys: what the file carries; what importing them would write (new, or replacing a different
   * one: `wouldReplace` of `wouldWrite`) whether or not they are ticked; what this import actually
   * wrote (`written`); and the saved keys it removed because their connection now points elsewhere.
   */
  keys: { inFile: number; wouldWrite: number; wouldReplace: number; written: number; removed: number };
  /**
   * Connections the file replaces with a different address, auth or headers. A saved key would be
   * sent to the new address, so unless the file brings its own key or the user keeps it, it is removed.
   */
  redirects: Redirect[];
  /** The endpoints the imported connections send page text to. */
  endpoints: string[];
  /** Things the user should know: skipped records, references that do not resolve. */
  notes: string[];
}

export interface Redirect {
  id: string;
  label: string;
  from: string;
  to: string;
  /** What differs: address, auth, headers, query parameters. */
  changed: string[];
  /** What happens to the key saved here: none saved, removed, kept (the user ticked it), or replaced by the file's key. */
  keyAction: 'none' | 'removed' | 'kept' | 'replaced';
}

export interface ImportOptions {
  /** Write the keys the file carries. */
  withKeys: boolean;
  /** Connections whose saved key stays although the file points them elsewhere. */
  keepKeys?: ReadonlySet<string>;
}

interface Resolved {
  items: Record<string, unknown>;
  secrets: Record<string, string>;
  removeSecrets: string[];
  report: ImportReport;
}

/** JSON with sorted keys, so two records compare equal whatever order their fields came in. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (typeof v === 'object' && v !== null) return `{${Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

/** What a replacing connection changes where a request (and the key in it) goes. */
function changedRouteOf(current: ProviderConnection, next: ProviderConnection): string[] {
  const changed: string[] = [];
  if (current.baseUrl !== next.baseUrl) changed.push('address');
  if (stable({ a: current.auth, p: current.authByProtocol }) !== stable({ a: next.auth, p: next.authByProtocol })) changed.push('auth');
  if (stable(current.extraHeaders ?? {}) !== stable(next.extraHeaders ?? {})) changed.push('headers');
  if (stable(current.queryParams ?? {}) !== stable(next.queryParams ?? {})) changed.push('query parameters');
  return changed;
}

async function resolveImport(api: Browser, plan: ImportPlan, { withKeys, keepKeys = new Set() }: ImportOptions): Promise<Resolved> {
  const [settings, prefs, glossary, lists, local] = await Promise.all([readProviderSettings(api), readPreferences(api), readGlossary(api), readSiteLists(api), api.storage.local.get(null)]);
  const implicit = settings.implicit ?? { connections: [], profiles: [] };
  const storedConn = new Set(settings.connections.filter((c) => !implicit.connections.includes(c.id)).map((c) => c.id));
  const storedProf = new Set(settings.profiles.filter((p) => !implicit.profiles.includes(p.id)).map((p) => p.id));
  const notes = [...plan.notes];
  const items: Record<string, unknown> = {};

  for (const c of plan.connections) items[connectionKey(c.id)] = c;
  for (const p of plan.profiles) items[profileKey(p.id)] = p;
  const connectionIds = new Set([...settings.connections.map((c) => c.id), ...plan.connections.map((c) => c.id)]);
  const profileIds = new Set([...settings.profiles.map((p) => p.id), ...plan.profiles.map((p) => p.id)]);
  for (const p of plan.profiles) if (!connectionIds.has(p.connectionId)) notes.push(i18n.t('options.portable.modelOrphan', { model: p.model, id: p.connectionId }));

  let routing: ImportReport['routing'] = 'none';
  if (plan.routing) {
    const r = plan.routing;
    if (!profileIds.has(r.translate)) {
      routing = 'kept';
      notes.push(i18n.t('options.portable.routingKept', { model: r.translate }));
    } else {
      const known = (id: string | undefined) => id !== undefined && profileIds.has(id);
      const next: Omit<Routing, 'siteOverrides'> = {
        translate: r.translate,
        ...(known(r.analyze) ? { analyze: r.analyze } : {}),
        ...(known(r.review) ? { review: r.review } : {}),
        ...(r.fallback ? { fallback: r.fallback.filter((id) => id === BASIC_FALLBACK || profileIds.has(id)) } : {}),
      };
      if (r.analyze && !known(r.analyze)) notes.push(i18n.t('options.portable.dropAnalyze', { model: r.analyze }));
      if (r.review && !known(r.review)) notes.push(i18n.t('options.portable.dropReview', { model: r.review }));
      if (r.fallback && next.fallback?.length !== r.fallback.length) notes.push(i18n.t('options.portable.dropFallback'));
      if (next.fallback?.length === 0) delete next.fallback;
      items[ROUTING_KEY] = { ...next, [BASIC_MIGRATED_FIELD]: true };
      routing = 'replaced';
    }
  }
  if (plan.siteRules.length > 0) {
    const kept = plan.siteRules.filter((r) => profileIds.has(r.translate));
    if (kept.length < plan.siteRules.length) notes.push(i18n.t('options.portable.skipSiteRulesModel'));
    const patterns = new Set(kept.map((r) => r.pattern));
    const merged = [...(settings.routing.siteOverrides ?? []).filter((r) => !patterns.has(r.pattern)), ...kept];
    if (kept.length > 0) items[SITE_RULES_KEY] = merged.slice(0, MAX_SITE_RULES);
  }
  if (plan.prefs) items[PREFS_KEY] = { ...prefs, ...plan.prefs };
  if (plan.quality) items[QUALITY_KEY] = plan.quality;

  let glossaryCount: number | null = null;
  if (plan.glossary && plan.glossary.length > 0) {
    items[GLOSSARY_KEY] = cleanGlossary([...plan.glossary, ...glossary]);
    glossaryCount = plan.glossary.length;
  }

  const never = new Set(plan.never ?? []);
  const allow = (plan.allow ?? []).filter((p) => !never.has(p));
  if (plan.allow || plan.never) {
    if (allow.length < (plan.allow?.length ?? 0)) notes.push(i18n.t('options.portable.bothLists'));
    items[SITE_ALLOWLIST_KEY] = cleanSiteList([...lists.allow.filter((p) => !never.has(p)), ...allow]);
    items[SITE_NEVER_KEY] = cleanSiteList([...lists.never.filter((p) => !allow.includes(p)), ...never]);
  }

  const secrets: Record<string, string> = {};
  const inFile = Object.keys(plan.keys).length;
  let wouldWrite = 0;
  let wouldReplace = 0;
  for (const [id, key] of Object.entries(plan.keys)) {
    if (!connectionIds.has(id)) {
      notes.push(i18n.t('options.portable.keyConnectionMissing', { id }));
      continue;
    }
    const current = local[`${SECRET_PREFIX}${id}`];
    if (current === key) continue;
    wouldWrite++;
    if (typeof current === 'string' && current !== '') wouldReplace++;
    if (withKeys) secrets[secretKey(id)] = key;
  }
  // A key saved here goes wherever its connection points. A file that points a connection you
  // already have somewhere else must not carry your key along with it (DESIGN §8, §4.3.4).
  const redirects: Redirect[] = [];
  const removeSecrets: string[] = [];
  for (const c of plan.connections) {
    const current = settings.connections.find((x) => x.id === c.id);
    if (!current) continue;
    const changed = changedRouteOf(current, c);
    if (changed.length === 0) continue;
    const saved = local[secretKey(c.id)];
    const hasKey = typeof saved === 'string' && saved !== '';
    let keyAction: Redirect['keyAction'] = 'none';
    if (secretKey(c.id) in secrets) keyAction = 'replaced';
    else if (hasKey) {
      keyAction = keepKeys.has(c.id) ? 'kept' : 'removed';
      if (keyAction === 'removed') removeSecrets.push(secretKey(c.id));
    }
    redirects.push({ id: c.id, label: current.label, from: redactAddress(current.baseUrl).url, to: redactAddress(c.baseUrl).url, changed, keyAction });
  }
  const endpoints = [...new Set(plan.connections.map((c) => redactAddress(c.baseUrl).url).filter((u) => u !== ''))];
  return {
    items,
    secrets,
    removeSecrets,
    report: {
      connections: { added: plan.connections.filter((c) => !storedConn.has(c.id)).length, replaced: plan.connections.filter((c) => storedConn.has(c.id)).length },
      profiles: { added: plan.profiles.filter((p) => !storedProf.has(p.id)).length, replaced: plan.profiles.filter((p) => storedProf.has(p.id)).length },
      routing,
      siteRules: Array.isArray(items[SITE_RULES_KEY]) ? plan.siteRules.filter((r) => profileIds.has(r.translate)).length : 0,
      prefs: plan.prefs !== undefined,
      quality: plan.quality !== undefined,
      glossary: glossaryCount,
      sites: { allow: plan.allow?.length ?? 0, never: plan.never?.length ?? 0 },
      keys: { inFile, wouldWrite, wouldReplace, written: Object.keys(secrets).length, removed: removeSecrets.length },
      redirects,
      endpoints,
      notes,
    },
  };
}

/** What importing `plan` would do here, without doing it (the preview the user confirms). */
export function previewImport(api: Browser, plan: ImportPlan, options: ImportOptions): Promise<ImportReport> {
  return resolveImport(api, plan, options).then((r) => r.report);
}

/** The lists an import writes: each one too large to sync stays on this device (sync-quota.ts). */
const LIST_KEYS: readonly string[] = [GLOSSARY_KEY, SITE_RULES_KEY, SITE_ALLOWLIST_KEY, SITE_NEVER_KEY];

/**
 * Merges `plan` into storage: one sync write for the records (it fits the sync quota or nothing
 * changes), then each list (to sync, or kept on this device when too large), then the keys, only
 * when `withKeys` and only the ones the file carries. Nothing the file does not mention is removed
 * or changed, except the saved key of a connection the file points somewhere else (`redirects`),
 * which goes unless the user kept it.
 */
export function applyImport(api: Browser, plan: ImportPlan, options: ImportOptions): Promise<ImportReport> {
  return queued(async () => {
    const { items, secrets, removeSecrets, report } = await resolveImport(api, plan, options);
    const records = Object.fromEntries(Object.entries(items).filter(([k]) => !LIST_KEYS.includes(k)));
    if (Object.keys(records).length > 0) {
      await assertFits(api, records);
      await api.storage.sync.set(records);
    }
    for (const key of LIST_KEYS) if (key in items) await saveListWithOverflow(api, key, items[key]);
    if (Object.keys(secrets).length > 0) await api.storage.local.set(secrets);
    if (removeSecrets.length > 0) await api.storage.local.remove(removeSecrets);
    return report;
  });
}
