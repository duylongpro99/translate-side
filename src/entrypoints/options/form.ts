// The add / edit connection form's state and how it maps to stored records (DESIGN.md §4.3.3 A,
// plan M4-E3). Pure, so the per-preset fields and the records a save writes are unit-tested apart
// from the UI (Providers.tsx).
import type { AuthStyle, ModelInfo, Protocol, Quirks } from '@/llm/types';
import type { TestInput, TestResult } from '@/shared/connect';
import { fixBaseUrl } from '@/shared/connect';
import { presetFor, type ConnectionPreset, type PresetId } from '@/shared/presets';
import { originPattern, type ModelProfile, type ProviderConnection } from '@/shared/settings';

export interface QuirkToggles {
  /** Send `max_completion_tokens` instead of `max_tokens`. */
  maxCompletionTokens: boolean;
  noTemperature: boolean;
  noSystemRole: boolean;
}

export interface ConnectionDraft {
  presetId: PresetId;
  label: string;
  protocol: Protocol | 'auto';
  baseUrl: string;
  authStyle: AuthStyle;
  headerName: string;
  /** A new key; empty keeps the stored one (edit). */
  apiKey: string;
  /** "Name: value" per line. */
  extraHeaders: string;
  /** "name=value" per line. */
  queryParams: string;
  toggles: QuirkToggles;
  model: string;
}

/** Which fields the form shows for a preset (§4.3.3 step 1: only the relevant ones). */
export interface FormFields {
  /** Base URL in the main form (Custom and local presets); the others have it under Advanced. */
  baseUrl: boolean;
  apiFormat: boolean;
  auth: boolean;
  key: boolean;
  /** Advanced: extra headers, query params, quirk toggles. Collapsed. */
  advanced: boolean;
}

export function fieldsFor(preset: ConnectionPreset, authStyle: AuthStyle): FormFields {
  return { baseUrl: preset.custom === true || preset.local !== undefined, apiFormat: preset.custom === true, auth: preset.custom === true, key: authStyle !== 'none', advanced: true };
}

const togglesOf = (q: Quirks): QuirkToggles => ({ maxCompletionTokens: q.maxTokensParam === 'max_completion_tokens', noTemperature: q.supportsTemperature === false, noSystemRole: q.supportsSystemRole === false });

export function draftFromPreset(id: PresetId): ConnectionDraft {
  const preset = presetFor(id);
  return {
    presetId: preset.id,
    label: preset.custom ? '' : preset.label,
    protocol: preset.protocol,
    baseUrl: preset.baseUrl,
    authStyle: preset.auth,
    headerName: '',
    apiKey: '',
    extraHeaders: '',
    queryParams: '',
    toggles: togglesOf(preset.quirks),
    model: preset.defaultModel ?? '',
  };
}

const lines = (record: Record<string, string> | undefined, sep: string) =>
  Object.entries(record ?? {})
    .map(([k, v]) => `${k}${sep}${v}`)
    .join('\n');

export function draftFromConnection(c: ProviderConnection, model = ''): ConnectionDraft {
  return {
    presetId: presetFor(c.presetId, c.protocol).id,
    label: c.label,
    protocol: c.protocol,
    baseUrl: c.baseUrl,
    authStyle: c.auth.style,
    headerName: c.auth.headerName ?? '',
    apiKey: '',
    extraHeaders: lines(c.extraHeaders, ': '),
    queryParams: lines(c.queryParams, '='),
    toggles: togglesOf(c.quirks),
    model,
  };
}

/** "Name: value" (or "name=value") lines as a record; blank lines and lines without a separator are skipped. */
export function parseLines(text: string, sep: ':' | '='): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf(sep);
    if (at <= 0) continue;
    const name = line.slice(0, at).trim();
    if (name !== '') out[name] = line.slice(at + 1).trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The preset's quirks with the Advanced toggles over them (only the flags the toggles own change). */
export function quirksOf(draft: ConnectionDraft, base: Quirks): Quirks {
  const q: Quirks = { ...base };
  if (draft.toggles.maxCompletionTokens) q.maxTokensParam = 'max_completion_tokens';
  else if (q.maxTokensParam === 'max_completion_tokens') delete q.maxTokensParam;
  if (draft.toggles.noTemperature) q.supportsTemperature = false;
  else delete q.supportsTemperature;
  if (draft.toggles.noSystemRole) q.supportsSystemRole = false;
  else delete q.supportsSystemRole;
  return q;
}

const auth = (d: ConnectionDraft): ProviderConnection['auth'] => (d.authStyle === 'custom-header' ? { style: 'custom-header', headerName: d.headerName.trim() || 'api-key' } : { style: d.authStyle });

const originOf = (url: string) => {
  try {
    return originPattern(fixBaseUrl(url).url);
  } catch {
    return url.trim();
  }
};

/** Has an edit moved the connection to another origin (§4.3.4: a key goes only to its own)? */
export function originMoved(d: ConnectionDraft, editing: ProviderConnection | undefined): boolean {
  return editing !== undefined && originOf(d.baseUrl) !== originOf(editing.baseUrl);
}

/**
 * The stored key Test and Save may use for this draft: none once the base URL points at another
 * origin, so the key is typed again rather than sent to a server it was not made for (review C1 #1).
 */
export function usableStoredKey(d: ConnectionDraft, editing: ProviderConnection | undefined, storedKey: string | undefined): string | undefined {
  return originMoved(d, editing) ? undefined : storedKey;
}

/** What Test connection sends for this draft; `storedKey` stands in when no new key was typed (edit). */
export function testInputOf(d: ConnectionDraft, storedKey?: string, baseQuirks: Quirks = presetFor(d.presetId).quirks): TestInput {
  const key = d.apiKey.trim() || storedKey;
  const extraHeaders = parseLines(d.extraHeaders, ':');
  const queryParams = parseLines(d.queryParams, '=');
  return {
    preset: presetFor(d.presetId),
    protocol: d.protocol,
    baseUrl: d.baseUrl,
    auth: auth(d),
    ...(key && d.authStyle !== 'none' ? { apiKey: key } : {}),
    ...(extraHeaders ? { extraHeaders } : {}),
    ...(queryParams ? { queryParams } : {}),
    quirks: quirksOf(d, baseQuirks),
    ...(d.model.trim() ? { model: d.model.trim() } : {}),
  };
}

/** The test's outcome as the connection stores it. */
export type TestStatus = Pick<ProviderConnection, 'status' | 'lastError' | 'lastErrorKind'>;

/**
 * The connection a save writes. A test that passed sets the detected protocols and the corrected
 * base URL; on Auto-detect the connection keeps `auto` with what was detected (the profile picks
 * per model, §4.3.1 `protocolOverride`).
 */
export function toConnection(d: ConnectionDraft, id: string, previous: ProviderConnection | undefined, test: TestResult | undefined, status: TestStatus): ProviderConnection {
  const preset = presetFor(d.presetId);
  const extraHeaders = parseLines(d.extraHeaders, ':');
  const queryParams = parseLines(d.queryParams, '=');
  const passed = test?.ok === true ? test : undefined;
  const baseUrl = passed ? passed.baseUrl : fixBaseUrl(d.baseUrl).url;
  const protocol: Protocol | 'auto' = d.protocol === 'auto' ? (passed && passed.detected.length === 1 ? (passed.detected[0] as Protocol) : 'auto') : d.protocol;
  const detected = passed ? passed.detected : previous?.detectedProtocols;
  // Auto-detect found which auth each path takes (§4.2.5 step 1): that is what is saved.
  const learned = d.protocol === 'auto' && passed ? passed : undefined;
  // Without a new test, what was learned holds only while the auth and the origin are as they were
  // (review C3 #1): otherwise it would override the user's new choice at runtime.
  const same = previous !== undefined && JSON.stringify(auth(d)) === JSON.stringify(previous.auth) && !originMoved(d, previous);
  const authByProtocol = learned ? learned.authByProtocol : d.protocol === 'auto' && same ? previous.authByProtocol : undefined;
  return {
    id,
    label: d.label.trim() || preset.label,
    presetId: preset.id,
    protocol,
    baseUrl,
    auth: learned ? learned.auth : auth(d),
    ...(authByProtocol ? { authByProtocol } : {}),
    ...(extraHeaders ? { extraHeaders } : {}),
    ...(queryParams ? { queryParams } : {}),
    quirks: quirksOf(d, previous?.quirks ?? preset.quirks),
    ...(detected && detected.length > 0 ? { detectedProtocols: detected } : {}),
    status: status.status,
    ...(status.lastError ? { lastError: status.lastError } : {}),
    ...(status.lastErrorKind ? { lastErrorKind: status.lastErrorKind } : {}),
  };
}

/**
 * The profile a save creates for the chosen model (§4.3.3 step 5), or the existing one for that
 * connection and model. Local presets get one request at a time and smaller chunks (§4.3.6); a
 * context size discovered with the model is kept. `protocol` is the dual-protocol switch's choice.
 */
export function toProfile(connection: ProviderConnection, model: string, id: string, existing: readonly ModelProfile[], models: readonly ModelInfo[], protocol?: Protocol): ModelProfile {
  const same = existing.find((p) => p.connectionId === connection.id && p.model === model);
  const preset = presetFor(connection.presetId, connection.protocol);
  const info = models.find((m) => m.id === model);
  const base: ModelProfile = same ?? { id, connectionId: connection.id, model, maxConcurrency: preset.profile.maxConcurrency, chunkTokens: preset.profile.chunkTokens };
  const dual = (connection.detectedProtocols?.length ?? 0) > 1;
  const rest = { ...base };
  delete rest.protocolOverride;
  return {
    ...rest,
    ...(dual && protocol ? { protocolOverride: protocol } : {}),
    ...(info?.contextWindow && base.contextWindow === undefined ? { contextWindow: info.contextWindow } : {}),
  };
}
