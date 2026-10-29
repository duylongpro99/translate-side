// Voice settings (Settings › Voice), independent of the translation provider: the engine, the
// reader's voice for Vietnamese and for English, and read-on. One storage.sync item, `tts`, plus one
// item per cloud provider the reader set up, `ttsConn:<id>`. A provider's key lives in
// storage.local under `ttsSecret:<id>`, a namespace of its own: a translation connection (whose
// key is `secret:<id>`, any id, even one an imported file names) can never read it. Or the
// connection names the translation connection whose key it reuses (`keyFrom`), never a copy, and
// only a connection of the same service at that service's own address.
import type { browser } from 'wxt/browser';
import { readApiKey } from '@/shared/settings';
import { TTS_PRESET_IDS, ttsPreset, type TtsPresetId } from './presets.ts';
import type { TtsEngineId } from './types.ts';

type Browser = typeof browser;

export const TTS_KEY = 'tts';
export const TTS_CONN_PREFIX = 'ttsConn:';
export const ttsConnKey = (id: string) => `${TTS_CONN_PREFIX}${id}`;
export const TTS_SECRET_PREFIX = 'ttsSecret:';
export const ttsSecretKey = (id: string) => `${TTS_SECRET_PREFIX}${id}`;

/** The languages a reader picks a voice for. */
export type VoiceLang = 'vi' | 'en';
export const VOICE_LANGS: readonly VoiceLang[] = ['vi', 'en'];

export interface TtsSettings {
  engine: TtsEngineId;
  /** The cloud connection, for engine `cloud`. */
  connectionId?: string;
  /** A Voice.id of the current engine per language; absent: the engine picks. */
  voices: Partial<Record<VoiceLang, string>>;
  /** When a block ends, read the following ones. */
  readOn: boolean;
}

export interface TtsConnection {
  /** `tts-<presetId>`: one connection per provider, never a translation connection's id. */
  id: string;
  presetId: TtsPresetId;
  /** The preset's, or the reader's for an OpenAI-compatible server. */
  baseUrl: string;
  /** Azure's region ("southeastasia"). */
  region?: string;
  /** Vbee's app id, sent with the token (not a secret). */
  appId?: string;
  model?: string;
  /** The translation connection whose key this one reuses. */
  keyFrom?: string;
}

export const ENGINES: readonly TtsEngineId[] = ['system', 'cloud'];

export const defaultTtsSettings = (): TtsSettings => ({ engine: 'system', voices: {}, readOn: true });

export const ttsConnectionId = (presetId: TtsPresetId) => `tts-${presetId}`;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

export function cleanTtsSettings(raw: unknown): TtsSettings {
  const out = defaultTtsSettings();
  if (!isRecord(raw)) return out;
  if (ENGINES.includes(raw.engine as TtsEngineId)) out.engine = raw.engine as TtsEngineId;
  if (nonEmpty(raw.connectionId)) out.connectionId = raw.connectionId;
  if (isRecord(raw.voices)) for (const l of VOICE_LANGS) if (nonEmpty(raw.voices[l])) out.voices[l] = raw.voices[l];
  if (typeof raw.readOn === 'boolean') out.readOn = raw.readOn;
  // A cloud engine with no connection reads with the system voice.
  if (out.engine === 'cloud' && !out.connectionId) out.engine = 'system';
  return out;
}

export function cleanTtsConnection(raw: unknown): TtsConnection | null {
  if (!isRecord(raw) || !TTS_PRESET_IDS.includes(raw.presetId as TtsPresetId)) return null;
  const preset = ttsPreset(raw.presetId as string);
  if (!preset) return null;
  const baseUrl = preset.editableBaseUrl && nonEmpty(raw.baseUrl) && /^https?:\/\//.test(raw.baseUrl) ? raw.baseUrl.trim().replace(/\/+$/, '') : preset.baseUrl;
  return {
    id: ttsConnectionId(preset.id),
    presetId: preset.id,
    baseUrl,
    ...(preset.needsRegion && nonEmpty(raw.region) && /^[a-z0-9-]+$/i.test(raw.region) ? { region: raw.region.trim().toLowerCase() } : {}),
    ...(preset.needsAppId && nonEmpty(raw.appId) ? { appId: raw.appId.trim() } : {}),
    ...(nonEmpty(raw.model) ? { model: raw.model.trim() } : preset.model ? { model: preset.model } : {}),
    // A translation key goes only to its own service's address, never to a server the reader typed (or a file named).
    ...(nonEmpty(raw.keyFrom) && baseUrl === preset.baseUrl ? { keyFrom: raw.keyFrom } : {}),
  };
}

/** The URL requests go to: the base URL with Azure's region filled in. */
export function endpointOf(conn: TtsConnection): string {
  return conn.baseUrl.replace('{region}', conn.region ?? '');
}

/** The voice the reader picked for a language ("vi-VN" → voices.vi), if any. */
export function voiceFor(settings: TtsSettings, lang: string): string | undefined {
  const p = lang.trim().toLowerCase().split(/[-_]/)[0];
  return p === 'vi' || p === 'en' ? settings.voices[p] : undefined;
}

export async function readTtsSettings(api: Browser): Promise<TtsSettings> {
  try {
    return cleanTtsSettings((await api.storage.sync.get(TTS_KEY))[TTS_KEY]);
  } catch {
    return defaultTtsSettings();
  }
}

export async function saveTtsSettings(api: Browser, settings: TtsSettings): Promise<void> {
  await api.storage.sync.set({ [TTS_KEY]: cleanTtsSettings(settings) });
}

/** Changing the engine forgets the voices, which belong to the old engine. */
export async function updateTtsSettings(api: Browser, patch: Partial<TtsSettings>): Promise<TtsSettings> {
  const cur = await readTtsSettings(api);
  const engineChanged = (patch.engine !== undefined && patch.engine !== cur.engine) || (patch.connectionId !== undefined && patch.connectionId !== cur.connectionId);
  const next = cleanTtsSettings({ ...cur, ...(engineChanged && !patch.voices ? { voices: {} } : {}), ...patch });
  await saveTtsSettings(api, next);
  return next;
}

/** Calls `fn` with the settings whenever they change (another page saved them); returns the unsubscribe. */
export function watchTtsSettings(api: Browser, fn: (s: TtsSettings) => void): () => void {
  const onChange = (changes: Record<string, { newValue?: unknown }>) => {
    if (TTS_KEY in changes) fn(cleanTtsSettings(changes[TTS_KEY]?.newValue));
  };
  api.storage.sync.onChanged.addListener(onChange);
  return () => api.storage.sync.onChanged.removeListener(onChange);
}

export async function readTtsConnections(api: Browser): Promise<TtsConnection[]> {
  const items = await api.storage.sync.get(null);
  return Object.entries(items).flatMap(([k, v]) => {
    const c = k.startsWith(TTS_CONN_PREFIX) ? cleanTtsConnection(v) : null;
    return c && ttsConnKey(c.id) === k ? [c] : [];
  });
}

export async function readTtsConnection(api: Browser, id: string): Promise<TtsConnection | null> {
  return cleanTtsConnection((await api.storage.sync.get(ttsConnKey(id)))[ttsConnKey(id)]);
}

/**
 * Saves a provider's connection and, when given, its own key. A connection that reuses a
 * translation key drops any key of its own, so no secret is kept twice.
 */
export async function saveTtsConnection(api: Browser, conn: TtsConnection, key?: string): Promise<TtsConnection> {
  const clean = cleanTtsConnection(conn);
  if (!clean) throw new Error('Not a voice provider');
  await api.storage.sync.set({ [ttsConnKey(clean.id)]: clean });
  if (clean.keyFrom) await api.storage.local.remove(ttsSecretKey(clean.id));
  else if (key !== undefined && key.trim() !== '') await api.storage.local.set({ [ttsSecretKey(clean.id)]: key.trim() });
  return clean;
}

export async function removeTtsConnection(api: Browser, id: string): Promise<void> {
  await api.storage.sync.remove(ttsConnKey(id));
  await api.storage.local.remove(ttsSecretKey(id));
  const settings = await readTtsSettings(api);
  if (settings.connectionId === id) await saveTtsSettings(api, { ...defaultTtsSettings(), readOn: settings.readOn });
}

/**
 * Whether a translation connection (as stored) is the same service as a voice preset, at that
 * service's own address: only then may the voice reuse its key.
 */
export function sameService(presetId: TtsPresetId, translation: unknown): boolean {
  if (!isRecord(translation)) return false;
  if (presetId === 'gemini') return translation.presetId === 'gemini';
  if (presetId === 'openai') return translation.presetId === 'openai' && typeof translation.baseUrl === 'string' && /^https:\/\/api\.openai\.com(\/|$)/.test(translation.baseUrl);
  return false;
}

/** The key a connection sends: its own, or that of the translation connection it names when that is the same service. */
export async function readTtsKey(api: Browser, conn: TtsConnection): Promise<string | undefined> {
  if (conn.keyFrom) {
    const k = `conn:${conn.keyFrom}`;
    const stored = (await api.storage.sync.get(k))[k];
    return sameService(conn.presetId, stored) ? readApiKey(api, conn.keyFrom) : undefined;
  }
  const k = ttsSecretKey(conn.id);
  const v = (await api.storage.local.get(k))[k];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/** Calls `fn` when a voice provider or its key changes (a re-save with a new address or key); returns the unsubscribe. */
export function watchTtsConnections(api: Browser, fn: () => void): () => void {
  const on = (changes: Record<string, unknown>) => {
    if (Object.keys(changes).some((k) => k.startsWith(TTS_CONN_PREFIX) || k.startsWith(TTS_SECRET_PREFIX) || k.startsWith('conn:') || k.startsWith('secret:'))) fn();
  };
  api.storage.sync.onChanged.addListener(on);
  api.storage.local.onChanged.addListener(on);
  return () => {
    api.storage.sync.onChanged.removeListener(on);
    api.storage.local.onChanged.removeListener(on);
  };
}
