// Settings v0 (plan M1-E9, user decision M1-D13): one hard-wired Gemini connection and its model
// profile, the API key in storage.local under `secret:<connectionId>` (DESIGN.md §4.3.4), and the
// target and source languages. Provider choice, presets, Test connection and routing are M4.
import type { browser } from 'wxt/browser';
import type { ModelRole, Protocol, AuthStyle, Quirks, ResolvedConnection } from '@/llm/types';

type Browser = typeof browser;

/** §4.3.1 ProviderConnection, the fields M1 uses. Stored nowhere yet: a constant until M4. */
export interface ProviderConnection {
  id: string;
  label: string;
  presetId: string;
  protocol: Protocol;
  baseUrl: string;
  auth: { style: AuthStyle; headerName?: string };
  quirks: Quirks;
}

/** §4.3.1 ModelProfile. `pricing` adds `cachedInPerM` to the spec's `{ inPerM, outPerM }` (plan M1 §5: usage has cachedInput). */
export interface ModelProfile {
  id: string;
  connectionId: string;
  model: string;
  maxConcurrency: number;
  chunkTokens: number;
  /** USD per million tokens. */
  pricing?: { inPerM: number; cachedInPerM: number; outPerM: number };
}

export const GEMINI_CONNECTION: ProviderConnection = {
  id: 'gemini',
  label: 'Google Gemini',
  presetId: 'gemini',
  protocol: 'openai-chat',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  auth: { style: 'bearer' },
  quirks: {},
};

/** The origin pattern the extension asks for when the key is saved (§4.3.3 step 3, §8). */
export const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com/*';

export const GEMINI_PROFILE: ModelProfile = {
  id: 'gemini-flash-lite',
  connectionId: GEMINI_CONNECTION.id,
  model: 'gemini-3.5-flash-lite',
  // §4.3.1 defaults: 2 in flight (plan M1 criterion 2), 1,200-token chunks.
  maxConcurrency: 2,
  chunkTokens: 1200,
  // scripts/eval/pricing.ts (verified 2026-10-06); a test keeps the two equal.
  pricing: { inPerM: 0.3, cachedInPerM: 0.03, outPerM: 2.5 },
};

/** §4.3.1 Routing, stubbed: `translate` is the only role M1 resolves (analyze/review are M2+). */
export const ROUTING = { translate: GEMINI_PROFILE.id } as const;

const PROFILES = new Map([[GEMINI_PROFILE.id, GEMINI_PROFILE]]);
const CONNECTIONS = new Map([[GEMINI_CONNECTION.id, GEMINI_CONNECTION]]);

/** §4.3.5 Resolve, M1 stub: no site overrides and no tab override yet. */
export function resolveProfile(role: ModelRole): { profile: ModelProfile; connection: ProviderConnection } {
  if (role !== 'translate') throw new Error(`no model profile is routed for the ${role} role yet`);
  const profile = PROFILES.get(ROUTING.translate);
  const connection = profile && CONNECTIONS.get(profile.connectionId);
  if (!profile || !connection) throw new Error('the translate route points at no profile');
  return { profile, connection };
}

export const secretKey = (connectionId: string) => `secret:${connectionId}`;

/** storage.local only, never sync (§4.3.4). Trimmed, as S4 requires. */
export async function saveApiKey(api: Browser, connectionId: string, key: string): Promise<void> {
  await api.storage.local.set({ [secretKey(connectionId)]: key.trim() });
}

export async function readApiKey(api: Browser, connectionId: string): Promise<string | undefined> {
  const k = secretKey(connectionId);
  const got = await api.storage.local.get(k);
  const value = got[k];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export async function removeApiKey(api: Browser, connectionId: string): Promise<void> {
  await api.storage.local.remove(secretKey(connectionId));
}

/** The only form a saved key is ever shown in (§4.3.4): `sk-…abcd`. Short keys show nothing of themselves. */
export function maskKey(key: string): string {
  return key.length >= 12 ? `${key.slice(0, 3)}…${key.slice(-4)}` : '••••';
}

/** The host-permission pattern for a base URL: `https://host/*` (ports are not part of a match pattern). */
export function originPattern(baseUrl: string): string {
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.hostname}/*`;
}

export function hasHostPermission(api: Browser, baseUrl: string): Promise<boolean> {
  return api.permissions.contains({ origins: [originPattern(baseUrl)] });
}

/** The connection as the adapter receives it (src/llm/types.ts), key included; null without a key. */
export async function resolveConnection(api: Browser, connection: ProviderConnection): Promise<ResolvedConnection | null> {
  const apiKey = await readApiKey(api, connection.id);
  if (apiKey === undefined && connection.auth.style !== 'none') return null;
  return {
    id: connection.id,
    protocol: connection.protocol,
    baseUrl: connection.baseUrl,
    auth: connection.auth,
    ...(apiKey === undefined ? {} : { apiKey }),
    // A copy: the adapter flips quirks in place (§4.2.4); M4 persists what it learns.
    quirks: structuredClone(connection.quirks),
    hasHostPermission: () => hasHostPermission(api, connection.baseUrl),
  };
}

// ---- Preferences (storage.sync: no secrets, follows the user, §4.3.1) ---------------------------

export interface Preferences {
  /** BCP 47 code, e.g. "vi". */
  targetLang: string;
  /** "auto" = the page's `lang`, else unknown; otherwise a code that overrides it. */
  sourceLang: 'auto' | (string & {});
}

const PREFS_KEY = 'prefs';

/** The browser's language, the native-language guess before onboarding exists (§4.3.3 C, M5). */
export function defaultPreferences(uiLanguage = 'en'): Preferences {
  return { targetLang: uiLanguage.split('-')[0] || 'en', sourceLang: 'auto' };
}

export async function readPreferences(api: Browser): Promise<Preferences> {
  const got = await api.storage.sync.get(PREFS_KEY);
  const stored = (got[PREFS_KEY] ?? {}) as Partial<Preferences>;
  const base = defaultPreferences(api.i18n?.getUILanguage?.() ?? 'en');
  return {
    targetLang: typeof stored.targetLang === 'string' && stored.targetLang !== '' ? stored.targetLang : base.targetLang,
    sourceLang: typeof stored.sourceLang === 'string' && stored.sourceLang !== '' ? stored.sourceLang : base.sourceLang,
  };
}

export async function savePreferences(api: Browser, prefs: Preferences): Promise<void> {
  await api.storage.sync.set({ [PREFS_KEY]: prefs });
}

/** The job's source language: the override, else the page's `lang`, else "" (the prompt says "the source language"). */
export function sourceLanguage(prefs: Preferences, pageLang: string | undefined): string {
  if (prefs.sourceLang !== 'auto') return prefs.sourceLang;
  return pageLang?.trim() ?? '';
}

/** Languages offered in options v0. A curated list; any BCP 47 code works in the prompt. */
export const LANGUAGES: readonly { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'zh-CN', name: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: 'Chinese (Traditional)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)' },
  { code: 'it', name: 'Italian' },
  { code: 'ru', name: 'Russian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'pl', name: 'Polish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'id', name: 'Indonesian' },
  { code: 'th', name: 'Thai' },
];
