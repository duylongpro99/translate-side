// The local diagnostics log (DESIGN.md §8: nothing leaves the device unless the user sends it). The panel
// records each run of a page job, and a crash of the panel itself, in storage.local; Settings shows the
// log and saves it as a file the user may share. Nothing is sent anywhere, by anyone but the user.
// - One key per entry (`diag:<ms>-<random>`), so two panels writing at once never overwrite each other's
//   entries; after each new entry the log is cut to the newest MAX_ENTRIES.
// - A run is written when it starts and again when it ends: a run whose panel closed or whose worker
//   restarted stays in the log as `started`.
// - Only facts the extension owns: versions, strategy and prompt ids, the preset and model ids, counts,
//   tokens, durations, the outcome and, per error kind, the HTTP status and a fixed message of ours.
//   Never the provider's message or body, a stack, page text, an address or a base URL. The page's origin
//   only when the user turned on "include site names", and the export can still leave it out.
import type { browser } from 'wxt/browser';
import type { LLMErrorKind } from '@/llm/types';
import { PRESETS } from './presets.ts';

type Browser = typeof browser;

export const DIAG_PREFIX = 'diag:';
export const MAX_ENTRIES = 50;
/** storage.local: whether new entries keep the page's origin (off unless the user turns it on). */
export const DIAG_SITES_KEY = 'diagnosticsSites';
export const DIAG_FORMAT = 'translate-side-diagnostics';

/** Our own words for each error kind: the provider's message can echo the request, so it is never kept. */
export const KIND_MESSAGES: Record<LLMErrorKind, string> = {
  auth: 'The provider refused the key.',
  rate_limit: 'The provider rate-limited the request.',
  overloaded: 'The provider was overloaded.',
  context_length: 'The request was too large for the model.',
  bad_request: 'The provider rejected the request, or the connection is set up wrongly.',
  model_not_found: 'The provider does not know the model.',
  network: 'The request did not reach the provider, or timed out.',
  cors: 'The browser blocked the request (no access to the host, or the server refused the origin).',
  unknown: 'An unexpected error.',
  quota: 'The key has no allowance left for this model.',
};

/** One run of a page job, as the panel's jobs report it (src/entrypoints/sidepanel/jobs.ts). */
export interface JobRecord {
  /** `<startedAt>-<random>`: the same at the run's start and end. */
  id: string;
  startedAt: number;
  endedAt?: number;
  outcome: 'started' | 'done' | 'cancelled' | 'stopped' | 'skipped' | 'replaced';
  strategy: string;
  promptIds: readonly string[];
  presetId?: string;
  model?: string;
  lazy: boolean;
  /** Translatable segments the run had to do at its start, and how many of them the cache answered. */
  segments: number;
  cached: number;
  chunks: number;
  /** Requests sent, retries included. */
  calls: number;
  tokens: { input: number; cachedInput: number; output: number };
  firstTextAt?: number;
  failed: number;
  /**
   * Best (`refine`): how many segments its review replaced, left as they were, whose candidate
   * failed a post-check, and that were not reviewed (budget, a failed call, dropped). Absent otherwise.
   */
  review?: { accepted: number; unchanged: number; rejected: number; skipped: number };
  /** The errors that stopped the run or failed its segments: kind, HTTP status, how many. */
  errors: readonly { kind: LLMErrorKind; status?: number; count: number }[];
  /** The page's origin; kept only when the user turned on site names. */
  origin?: string;
}

export interface JobEntry {
  type: 'page-job';
  id: string;
  at: string;
  endedAt?: string;
  extension: string;
  chrome: string;
  outcome: JobRecord['outcome'];
  strategy: string;
  promptIds: string[];
  presetId?: string;
  model?: string;
  lazy: boolean;
  segments: number;
  cached: number;
  chunks: number;
  calls: number;
  tokens: JobRecord['tokens'];
  durationMs?: number;
  firstTextMs?: number;
  failed: number;
  review?: NonNullable<JobRecord['review']>;
  errors: { kind: LLMErrorKind; status?: number; count: number; message: string }[];
  origin?: string;
}

export interface PanelErrorEntry {
  type: 'panel-error';
  id: string;
  at: string;
  extension: string;
  chrome: string;
  /** The panel component the error came out of, and the error's class (`TypeError`): never its message or stack. */
  component: string;
  error: string;
}

export type DiagnosticEntry = JobEntry | PanelErrorEntry;

function versions(api: Browser): { extension: string; chrome: string } {
  let extension = '';
  try {
    extension = api.runtime.getManifest().version;
  } catch {
    // Not in an extension page (tests).
  }
  const chrome = /Chrome\/([\d.]+)/.exec(globalThis.navigator?.userAgent ?? '')?.[1] ?? '';
  return { extension, chrome };
}

const iso = (ms: number) => new Date(ms).toISOString();

/** A preset id is settings data (an imported file can hold any string): only one of ours is logged, else `custom`. */
const KNOWN_PRESETS: ReadonlySet<string> = new Set(PRESETS.map((p) => p.id));
const presetOf = (id: string) => (KNOWN_PRESETS.has(id) ? id : 'custom');

/** A new entry id: the time first, so ids sort by age. */
export const entryId = (now: number) => `${now}-${Math.random().toString(36).slice(2, 8)}`;

const ageOf = (key: string) => Number(key.slice(DIAG_PREFIX.length).split('-')[0]) || 0;

async function diagKeys(api: Browser): Promise<string[]> {
  const local = api.storage.local as typeof api.storage.local & { getKeys?: () => Promise<string[]> };
  const keys = typeof local.getKeys === 'function' ? await local.getKeys() : Object.keys(await local.get(null));
  return keys.filter((k) => k.startsWith(DIAG_PREFIX));
}

/** Writes `entry` under its own key, then cuts the log to the newest MAX_ENTRIES. */
async function put(api: Browser, entry: DiagnosticEntry, fresh: boolean): Promise<void> {
  await api.storage.local.set({ [`${DIAG_PREFIX}${entry.id}`]: entry });
  if (!fresh) return;
  const keys = (await diagKeys(api)).sort((a, b) => ageOf(b) - ageOf(a) || (a < b ? 1 : -1));
  const old = keys.slice(MAX_ENTRIES);
  if (old.length) await api.storage.local.remove(old);
}

export function jobEntry(api: Browser, record: JobRecord, sites: boolean): JobEntry {
  const v = versions(api);
  return {
    type: 'page-job',
    id: record.id,
    at: iso(record.startedAt),
    ...(record.endedAt === undefined ? {} : { endedAt: iso(record.endedAt), durationMs: record.endedAt - record.startedAt }),
    ...v,
    outcome: record.outcome,
    strategy: record.strategy,
    promptIds: [...record.promptIds],
    ...(record.presetId === undefined ? {} : { presetId: presetOf(record.presetId) }),
    ...(record.model ? { model: record.model } : {}),
    lazy: record.lazy,
    segments: record.segments,
    cached: record.cached,
    chunks: record.chunks,
    calls: record.calls,
    tokens: { input: record.tokens.input, cachedInput: record.tokens.cachedInput, output: record.tokens.output },
    ...(record.firstTextAt === undefined ? {} : { firstTextMs: record.firstTextAt - record.startedAt }),
    failed: record.failed,
    ...(record.review === undefined ? {} : { review: { accepted: record.review.accepted, unchanged: record.review.unchanged, rejected: record.review.rejected, skipped: record.review.skipped } }),
    errors: record.errors.map((e) => ({ kind: e.kind, ...(e.status === undefined ? {} : { status: e.status }), count: e.count, message: KIND_MESSAGES[e.kind] ?? KIND_MESSAGES.unknown })),
    ...(sites && record.origin ? { origin: record.origin } : {}),
  };
}

export interface DiagnosticsLog {
  /** A page run started or ended. Never throws: a log that can't be written is no reason to stop a job. */
  record(record: JobRecord): Promise<void>;
  /** The panel crashed in `component` with an error of class `error`. */
  crash(component: string, error: string): Promise<void>;
}

export function createDiagnosticsLog(api: Browser, now: () => number = Date.now): DiagnosticsLog {
  return {
    async record(record) {
      try {
        const sites = (await api.storage.local.get(DIAG_SITES_KEY))[DIAG_SITES_KEY] === true;
        await put(api, jobEntry(api, record, sites), record.outcome === 'started');
      } catch (err) {
        console.warn('[translate-side] could not write the diagnostics log', err);
      }
    },
    async crash(component, error) {
      try {
        const at = now();
        await put(api, { type: 'panel-error', id: entryId(at), at: iso(at), ...versions(api), component, error }, true);
      } catch (err) {
        console.warn('[translate-side] could not write the diagnostics log', err);
      }
    },
  };
}

/** The log, newest first. */
export async function readDiagnostics(api: Browser): Promise<DiagnosticEntry[]> {
  const keys = await diagKeys(api);
  if (keys.length === 0) return [];
  const got = await api.storage.local.get(keys);
  return keys
    .sort((a, b) => ageOf(b) - ageOf(a) || (a < b ? 1 : -1))
    .map((k) => got[k] as DiagnosticEntry | undefined)
    .filter((e): e is DiagnosticEntry => typeof e === 'object' && e !== null);
}

export async function clearDiagnostics(api: Browser): Promise<void> {
  const keys = await diagKeys(api);
  if (keys.length) await api.storage.local.remove(keys);
}

/** The file Settings saves: the entries, with their origins only when `sites`. */
export function diagnosticsFile(entries: readonly DiagnosticEntry[], { sites, exportedAt }: { sites: boolean; exportedAt: number }): string {
  const out = entries.map((e) => {
    if (sites || e.type !== 'page-job' || e.origin === undefined) return e;
    const copy = { ...e };
    delete copy.origin;
    return copy;
  });
  return JSON.stringify({ format: DIAG_FORMAT, formatVersion: 1, exportedAt: iso(exportedAt), entries: out }, null, 2);
}
