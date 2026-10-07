// Settings v0 (plan M1-E9, user decision M1-D13): one hard-wired connection and its model profile,
// the API key in storage.local under `secret:<connectionId>` (DESIGN.md §4.3.4), and the target and
// source languages. The default is APIBOX with ds/deepseek-v4-pro (M2-D11, M2-D14); ds/deepseek-flash
// (M2-D13) and the Gemini preset stay defined. Provider choice, presets, Test connection and routing are M4.
import type { browser } from 'wxt/browser';
import type { GlossaryEntry, GlossMode, StyleMode } from '@/engine/types';
import { APIBOX_BASE_URL, APIBOX_DEEPSEEK_QUIRKS, GEMINI_OPENAI_BASE_URL } from '@/llm/presets';
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
  baseUrl: GEMINI_OPENAI_BASE_URL,
  auth: { style: 'bearer' },
  quirks: {},
};

/** The Gemini connection's origin pattern (§4.3.3 step 3, §8). */
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

export const APIBOX_CONNECTION: ProviderConnection = {
  id: 'apibox',
  label: 'APIBOX',
  presetId: 'apibox',
  protocol: 'openai-chat',
  baseUrl: APIBOX_BASE_URL,
  auth: { style: 'bearer' },
  // DeepSeek thinks by default and the thinking eats max_tokens: switched off (src/llm/presets.ts).
  quirks: APIBOX_DEEPSEEK_QUIRKS,
};

/** The M2-D13 translator, kept selectable: cheaper, but it seldom adds the first-use glosses (M2-D14). */
export const APIBOX_FLASH_PROFILE: ModelProfile = {
  id: 'apibox-deepseek-flash',
  connectionId: APIBOX_CONNECTION.id,
  model: 'ds/deepseek-flash',
  maxConcurrency: 2,
  chunkTokens: 1200,
  // scripts/eval/pricing.ts (the gateway's nominal USD, unverified); a test keeps the two equal.
  pricing: { inPerM: 0.1, cachedInPerM: 0.002, outPerM: 0.4 },
};

/** The translator from M2-D14 on, thinking off like flash (probed 2026-10-07). */
export const APIBOX_PRO_PROFILE: ModelProfile = {
  id: 'apibox-deepseek-v4-pro',
  connectionId: APIBOX_CONNECTION.id,
  model: 'ds/deepseek-v4-pro',
  maxConcurrency: 2,
  chunkTokens: 1200,
  pricing: { inPerM: 0.44, cachedInPerM: 0.0146, outPerM: 1.32 },
};

/** The connection and profile the extension uses (M2-D11, M2-D14). */
export const DEFAULT_CONNECTION = APIBOX_CONNECTION;
export const DEFAULT_PROFILE = APIBOX_PRO_PROFILE;
/** The origin pattern the extension asks for when the key is saved (§4.3.3 step 3, §8), from the base URL. */
export const DEFAULT_ORIGIN = originPattern(DEFAULT_CONNECTION.baseUrl);
/** "api.ai-box.vn": how the settings and the panel name the host they need access to. */
export const DEFAULT_HOST = new URL(DEFAULT_CONNECTION.baseUrl).hostname;

/** §4.3.1 Routing, stubbed: `analyze` is unset, so it defaults to `translate` (§4.3.1); `review` is M7. */
export const ROUTING: { translate: string; analyze?: string } = { translate: DEFAULT_PROFILE.id };

const PROFILES = new Map([GEMINI_PROFILE, APIBOX_FLASH_PROFILE, APIBOX_PRO_PROFILE].map((p) => [p.id, p]));
const CONNECTIONS = new Map([GEMINI_CONNECTION, APIBOX_CONNECTION].map((c) => [c.id, c]));

/** §4.3.5 Resolve, M1 stub: no site overrides and no tab override yet. */
export function resolveProfile(role: ModelRole): { profile: ModelProfile; connection: ProviderConnection } {
  if (role === 'review') throw new Error(`no model profile is routed for the ${role} role yet`);
  const id = role === 'analyze' ? (ROUTING.analyze ?? ROUTING.translate) : ROUTING.translate;
  const profile = PROFILES.get(id);
  const connection = profile && CONNECTIONS.get(profile.connectionId);
  if (!profile || !connection) throw new Error(`the ${role} route points at no profile`);
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
  /** "auto" = detected (src/shared/language.ts: LanguageDetector, then the page's `lang`); otherwise a code that overrides it. */
  sourceLang: 'auto' | (string & {});
  /** Style mode (DESIGN §3 "Style control"); Natural by default. */
  style: StyleMode;
  /** Term glosses (plan M2 §5, decision M2-D1): first occurrence only by default, or never. */
  gloss: GlossMode;
}

export const PREFS_KEY = 'prefs';

export const STYLES: readonly StyleMode[] = ['natural', 'faithful', 'simplified'];
export const GLOSS_MODES: readonly GlossMode[] = ['first', 'off'];

/** The browser's language, the native-language guess before onboarding exists (§4.3.3 C, M5). */
export function defaultPreferences(uiLanguage = 'en'): Preferences {
  return { targetLang: uiLanguage.split('-')[0] || 'en', sourceLang: 'auto', style: 'natural', gloss: 'first' };
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

export async function readPreferences(api: Browser): Promise<Preferences> {
  const got = await api.storage.sync.get(PREFS_KEY);
  const stored = (got[PREFS_KEY] ?? {}) as Partial<Preferences>;
  const base = defaultPreferences(api.i18n?.getUILanguage?.() ?? 'en');
  return {
    targetLang: typeof stored.targetLang === 'string' && stored.targetLang !== '' ? stored.targetLang : base.targetLang,
    sourceLang: typeof stored.sourceLang === 'string' && stored.sourceLang !== '' ? stored.sourceLang : base.sourceLang,
    style: oneOf(stored.style, STYLES, base.style),
    gloss: oneOf(stored.gloss, GLOSS_MODES, base.gloss),
  };
}

export async function savePreferences(api: Browser, prefs: Preferences): Promise<void> {
  await api.storage.sync.set({ [PREFS_KEY]: prefs });
}

let prefsWrite: Promise<unknown> = Promise.resolve();

/**
 * Applies `patch` to the stored preferences. Updates run one after another, each on what the last
 * one wrote, so two settings changed in quick succession (two option sections) both stick.
 */
export function updatePreferences(api: Browser, patch: Partial<Preferences>): Promise<Preferences> {
  const run = prefsWrite.then(async () => {
    const next = { ...(await readPreferences(api)), ...patch };
    await savePreferences(api, next);
    return next;
  });
  prefsWrite = run.catch(() => undefined);
  return run;
}

// ---- Personal glossary (storage.sync, plan M2-E6) ----------------------------------------------
// One sync item, `glossary`: an array of { term, rendering, note? }. "Keep as is" is a rendering
// equal to the term. A basic quota guard refuses a save that would exceed chrome.storage.sync's
// per-item or total quota (it would fail anyway, losing the edit silently) and warns from 80% of
// the per-item quota. Splitting across items, compression and conflict handling are M6-E6.

export const GLOSSARY_KEY = 'glossary';
/** chrome.storage.sync.QUOTA_BYTES_PER_ITEM and QUOTA_BYTES (fixed by Chrome). */
export const SYNC_QUOTA_BYTES_PER_ITEM = 8192;
export const SYNC_QUOTA_BYTES = 102400;
/** Warn once an item reaches this share of its quota. */
export const GLOSSARY_WARN_RATIO = 0.8;
const TERM_MAX = 120;
const RENDERING_MAX = 200;
const NOTE_MAX = 200;

/** Bytes chrome.storage.sync counts for one item: the key plus the value's JSON, in UTF-8. */
export function syncItemBytes(key: string, value: unknown): number {
  return new TextEncoder().encode(key + JSON.stringify(value)).length;
}

/** Trimmed and capped entries; blank terms and repeated terms (case-insensitive, first wins) dropped. */
export function cleanGlossary(entries: readonly unknown[]): GlossaryEntry[] {
  const seen = new Set<string>();
  const out: GlossaryEntry[] = [];
  for (const raw of entries) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const term = typeof r.term === 'string' ? r.term.trim().slice(0, TERM_MAX) : '';
    const key = term.toLowerCase();
    if (term === '' || seen.has(key)) continue;
    seen.add(key);
    const rendering = typeof r.rendering === 'string' && r.rendering.trim() !== '' ? r.rendering.trim().slice(0, RENDERING_MAX) : term;
    const note = typeof r.note === 'string' ? r.note.trim().slice(0, NOTE_MAX) : '';
    out.push(note ? { term, rendering, note } : { term, rendering });
  }
  return out;
}

export async function readGlossary(api: Browser): Promise<GlossaryEntry[]> {
  const got = await api.storage.sync.get(GLOSSARY_KEY);
  const stored = got[GLOSSARY_KEY];
  return Array.isArray(stored) ? cleanGlossary(stored) : [];
}

export type GlossarySave =
  | { ok: true; entries: GlossaryEntry[]; bytes: number; warning?: string }
  | { ok: false; reason: 'item-quota' | 'total-quota' | 'error'; message: string };

/** Checks the quota first; nothing is written when the save would not fit. */
export async function saveGlossary(api: Browser, entries: readonly GlossaryEntry[]): Promise<GlossarySave> {
  const clean = cleanGlossary(entries);
  const bytes = syncItemBytes(GLOSSARY_KEY, clean);
  if (bytes > SYNC_QUOTA_BYTES_PER_ITEM) {
    return { ok: false, reason: 'item-quota', message: `The glossary would take ${bytes} bytes, over Chrome's sync limit of ${SYNC_QUOTA_BYTES_PER_ITEM} bytes for one setting. Remove or shorten some entries.` };
  }
  try {
    const sync = api.storage.sync as { getBytesInUse?: (keys?: string | string[] | null) => Promise<number> };
    if (typeof sync.getBytesInUse === 'function') {
      const [total, current] = await Promise.all([sync.getBytesInUse(null), sync.getBytesInUse(GLOSSARY_KEY)]);
      if (total - current + bytes > SYNC_QUOTA_BYTES) {
        return { ok: false, reason: 'total-quota', message: `Synced settings would exceed Chrome's ${SYNC_QUOTA_BYTES}-byte limit. Remove some glossary entries.` };
      }
    }
    await api.storage.sync.set({ [GLOSSARY_KEY]: clean });
  } catch (error) {
    return { ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  const warning =
    bytes >= SYNC_QUOTA_BYTES_PER_ITEM * GLOSSARY_WARN_RATIO ? `The glossary uses ${Math.round((100 * bytes) / SYNC_QUOTA_BYTES_PER_ITEM)}% of the space Chrome syncs for it.` : undefined;
  return { ok: true, entries: clean, bytes, ...(warning ? { warning } : {}) };
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
