// Job orchestration in the panel (plan M1-E8, decision S1: the panel is the engine host). One job
// per tab; the engine owns chunking and runs `maxConcurrency` (2) chunks in flight. The shell
// owns the job lifecycle only: it never builds prompts or reads model output (DESIGN.md §5.1),
// it just folds EngineEvents into what the panel shows.
//
// - Cancel: the Cancel button, a navigation (the content connection drops), the tab closing or
//   moving to another window, and the panel closing (the page unloads; `cancelAll` on pagehide).
// - Viewport first (plan M3-E1): the content script reports what is on screen (setViewport); the
//   engine reads it each time a chunk is about to start, so scrolling moves what is translated
//   next. Chunks in flight are never aborted (M3-D3).
// - Cache (plan M3-E2, DESIGN §7): before a run, segments found in the translation cache are shown
//   as final and never sent; a cached brief seeds the run. What the run produces is stored as it
//   arrives (highest revision only; a failure removes the entry), so a retry, a reload or a revisit
//   re-runs only what is missing. `fresh` (retranslate) skips the lookup, never the store.
// - Pause on tab switch (decision S5 R1, M0 D14): only the active tab's job starts new model
//   requests. A background job's requests already streaming finish; the next one waits at the
//   gate until its tab is active again. Repairs and retries wait too, since they are requests.
import { briefCacheKey, contextual, createDefaultPromptRegistry, createEngine, decideRetry, normalizeBrief, singlePass, type DocumentBrief, type EngineEvent, type GlossaryEntry, type GlossMode, type StyleMode, type Segment, type StrategyId, type TranslationEngine, type TranslationJob, type RetryPolicy } from '@/engine/index';
import type { SnippetRequest } from '@/engine/types';
import type { LLMClient, LLMError, LLMErrorKind, NormalizedRequest } from '@/llm/types';
import { keyScope, scopeHash, segmentKey, type CachedSegment, type TranslationCache } from '@/shared/cache';
import { costUsd, formatUsd, type UsageTotals } from '@/shared/cost';
import type { Detection } from '@/shared/language';
import type { LimitReached, SpendDelta } from '@/shared/spend';
import type { ModelProfile } from '@/shared/settings';

export type SegStatus = 'pending' | 'streaming' | 'final' | 'failed';

export interface SegState {
  status: SegStatus;
  /** Partial preview or final text, with the light markers (§4.1). Absent while pending and after a failure. */
  text?: string;
  /** Of the shown final (§5.2). */
  revision?: number;
  attempt?: number;
  error?: LLMError;
  /** The last Retranslate of this final failed (M3-E5): the text shown is the earlier one. */
  redoError?: LLMError;
  /**
   * The model that produced the shown final (`producedBy.model`, §5.2). When it is not the job's
   * model, a fallback translated the block (M4-E9): the block shows it as a badge, and its cache
   * entry is keyed by it (§7). Absent for a final from the cache.
   */
  model?: string;
}

export type JobStatus =
  /** Requests may be in flight. */
  | 'running'
  | 'done'
  | 'cancelled'
  /** A failure that every further request would hit too (bad key, no allowance, no access): the job stopped itself. */
  | 'stopped'
  /** The page is already in the target language (plan M2-E5): nothing was sent. `resume` translates it anyway. */
  | 'skipped';

/**
 * The strategy the panel runs: `contextual`, so the brief exists for "About this document" (plan
 * M2 §2). Whether it stays the default is decided at the end of M2 (plan §9); `single-pass` is one
 * line away.
 */
export const PANEL_STRATEGY: StrategyId = contextual.id;

/** A chunk's request waiting out a rate limit or a provider/network hiccup before its retry (plan M3-E8). */
export interface Backoff {
  /** The chunk's place in the order the job's chunks started (NormalizedRequest.chunkIndex); -1 for the analyze call. */
  chunk: number;
  kind: LLMErrorKind;
  /** Failed attempts of this request so far. */
  attempt: number;
  /** Epoch ms the provider asked us to wait until (Retry-After); absent when it gave no hint. */
  until?: number;
}

export interface JobView {
  status: JobStatus;
  /** Running, but its tab is in the background: no new requests start (D14). */
  paused: boolean;
  model: string;
  targetLang: string;
  /** The source language the job uses: the detection chain's, or the brief's when that was silent; "" if unknown. */
  sourceLang: string;
  /** How the source language was found (shell side); absent in jobs built without detection. */
  detection?: Detection;
  /** The document brief (analyze stage), for "About this document". Absent until it arrives, or when there is none. */
  brief?: DocumentBrief;
  /** Every segment of the page, in page order (code blocks included: they are shown as is). */
  segments: readonly Segment[];
  /**
   * Per translatable segment id. The job's live map (read it when rendering, don't keep it): a
   * SegState in it is replaced, never mutated, so a renderer can compare by identity.
   */
  segs: ReadonlyMap<string, SegState>;
  counts: { total: number; final: number; failed: number };
  usage: UsageTotals;
  /** Segments of this run shown from the translation cache instead of being sent (M3-E2). */
  cached?: number;
  /** USD for this page so far, across runs (cancel + resume, a language change); undefined without pricing or usage. */
  cost: number | undefined;
  /**
   * Requests of this page that were aborted before they reported usage (providers send it at the
   * end of a stream), so `usage` and `cost` leave them out. Not estimated: the readout says so.
   */
  unmetered: number;
  /** The error that stopped the job (status `stopped`). */
  stopError?: LLMError;
  /**
   * The monthly soft limit stopped the job before it sent anything (M4-E10): "Continue anyway" goes
   * on. `failed`: why that click could not go on (the setting was not saved, review 3 #3).
   */
  limit?: LimitReached & { failed?: string };
  /** The connection the job runs on, for "Fix key" (M3-E8). Absent until the client is resolved. */
  connection?: JobConnection;
  /** Requests waiting out a retryable failure right now, one per chunk (M3-E8). Absent when none. */
  backoff?: readonly Backoff[];
  /**
   * The latest hand-over to a fallback profile in this run (M4-E9): `from` gave up on `error`
   * (rate limit, overloaded, network) and the job goes on with `to`. Absent when none.
   */
  fallback?: { from: string; to: string; error: LLMError };
  /** The page is under a local-only site rule (its pattern): a stop says why nothing fell back to the cloud (M4-D tester O1). */
  localOnly?: string;
  /** Epoch ms: when this run started, when its first text became visible, when it ended. */
  startedAt: number;
  firstVisibleAt?: number;
  /**
   * Epoch ms: when every segment this run had to translate that was on screen at its start was
   * final or failed (plan M3 §3 #1). Absent while some are pending, and when none was on screen.
   */
  screenDoneAt?: number;
  endedAt?: number;
}

/**
 * These hit every request of the job alike, so the job stops at the first one (§4.3.5: "stop", no
 * silent fallback). `network` is here for the retries that ran out (the engine already backed off):
 * the page is offline, so the rest would fail the same way; the finals stay and Retry runs the rest (M3-E8).
 */
const STOP_KINDS: ReadonlySet<LLMErrorKind> = new Set(['auth', 'quota', 'cors', 'model_not_found', 'network']);

/**
 * Whether an error of a single-segment Retry stops a job that is not running. A network failure
 * only fails that segment: the page itself was translated, so the job stays done (review C1).
 */
const stopsJob = (error: LLMError) => STOP_KINDS.has(error.kind) && error.kind !== 'network';

/** The errors the engine's retry waits out (retry.ts RETRYABLE): seen at the shell, they mean "backing off". */
const BACKOFF_KINDS: ReadonlySet<LLMErrorKind> = new Set(['rate_limit', 'overloaded', 'network']);

// ---- The panel rule for EngineEvents (§5.2), pure so it can be tested on its own --------------

/**
 * Folds one segment event into the segment's state. §5.2: for the same id and revision a higher
 * attempt replaces the text in place; a later `segment.failed` for that revision replaces any
 * attempt; a higher revision always wins. A partial only previews a segment with no final yet.
 *
 * A `segment.failed` without a revision replaces a revision-1 final (review B-N1: a first-pass
 * final the repair could not confirm); a higher revision (contextual's revise pass M2-D17, refine
 * M7) is a better text than the failed pass, so it stays (§5.6) and only gets the error. A failure
 * naming a revision (the check stage) replaces a final of that revision or lower: the shown text
 * is the one that failed (review D-B1).
 */
export function applySegmentEvent(cur: SegState | undefined, e: EngineEvent): SegState | undefined {
  switch (e.type) {
    case 'segment.partial':
      if (cur?.status === 'final' || cur?.status === 'failed') return cur;
      if (cur?.status === 'streaming' && cur.text === e.text) return cur;
      return { status: 'streaming', text: e.text };
    case 'segment.final': {
      const attempt = e.attempt ?? 1;
      if (cur?.status === 'final') {
        const newer = e.revision > (cur.revision ?? 1) || (e.revision === cur.revision && attempt > (cur.attempt ?? 1));
        if (!newer) return cur;
      } else if (cur?.status === 'failed' && e.revision <= (cur.revision ?? 1)) return cur;
      return { status: 'final', text: e.text, revision: e.revision, attempt, model: e.producedBy.model };
    }
    case 'segment.failed':
      if (cur?.status === 'final' && (cur.revision ?? 1) > (e.revision ?? 1)) return { ...cur, error: e.error };
      return { status: 'failed', error: e.error, revision: Math.max(cur?.revision ?? 1, e.revision ?? 1) };
    default:
      return cur;
  }
}

// ---- The D14 gate --------------------------------------------------------------------------

/** Open while the job's tab is active. `wait` resolves when it is open; rejects with the signal's reason on abort. */
export class Gate {
  private isOpen = true;
  private waiters = new Set<() => void>();

  get open(): boolean {
    return this.isOpen;
  }

  set(open: boolean): void {
    this.isOpen = open;
    if (!open) return;
    const waiters = [...this.waiters];
    this.waiters.clear();
    for (const w of waiters) w();
  }

  wait(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.isOpen) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.waiters.delete(go);
        reject(signal.reason);
      };
      const go = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      this.waiters.add(go);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

/**
 * Tells when a request starts and ends, and whether it was aborted before its usage arrived.
 * Wrap it inside the gate: a request still waiting there was never sent.
 */
export function meteredClient(inner: LLMClient, meter: { start(): void; end(unmetered: boolean): void }): LLMClient {
  return {
    model: inner.model,
    reasoningReserveTokens: (req) => inner.reasoningReserveTokens(req),
    async *stream(req: NormalizedRequest) {
      let metered = false;
      meter.start();
      try {
        for await (const e of inner.stream(req)) {
          if (e.type === 'usage') metered = true;
          yield e;
        }
      } finally {
        meter.end(!metered && req.signal.aborted);
      }
    },
  };
}

/** Every request waits at the gate before it is sent; a stream already running is not touched. */
export function gatedClient(inner: LLMClient, gate: Gate): LLMClient {
  return {
    model: inner.model,
    reasoningReserveTokens: (req) => inner.reasoningReserveTokens(req),
    async *stream(req: NormalizedRequest) {
      await gate.wait(req.signal);
      yield* inner.stream(req);
    },
  };
}

/**
 * Reports a request that failed in a way the engine's retry waits out (it sits outside this client
 * and sleeps before the next attempt), and that its next attempt started (or that it ended). A
 * request that already streamed text is never retried, so it is not reported. Plan M3-E8.
 */
export function backoffClient(inner: LLMClient, watch: { waiting(chunk: number, error: LLMError): void; started(chunk: number): void; streaming(chunk: number): void }): LLMClient {
  return {
    model: inner.model,
    reasoningReserveTokens: (req) => inner.reasoningReserveTokens(req),
    async *stream(req: NormalizedRequest) {
      const chunk = req.chunkIndex ?? -1;
      watch.started(chunk);
      let text = false;
      for await (const e of inner.stream(req)) {
        if (e.type === 'text' && e.delta !== '' && !text) {
          text = true;
          watch.streaming(chunk);
        }
        if (e.type === 'error' && !text && BACKOFF_KINDS.has(e.error.kind)) watch.waiting(chunk, e.error);
        yield e;
      }
    },
  };
}

/** Tells of a request refused for its key (`auth`, §4.3.5): the job's connection is marked `error`. */
export function authClient(inner: LLMClient, onAuth: (error: LLMError) => void): LLMClient {
  return {
    model: inner.model,
    reasoningReserveTokens: (req) => inner.reasoningReserveTokens(req),
    async *stream(req: NormalizedRequest) {
      for await (const e of inner.stream(req)) {
        if (e.type === 'error' && e.error.kind === 'auth') onAuth(e.error);
        yield e;
      }
    },
  };
}

// ---- Jobs ---------------------------------------------------------------------------------

/** The connection a job runs on; `origin` is its host-permission pattern, for "Grant access". */
export interface JobConnection {
  id: string;
  label: string;
  origin?: string;
}

/** A fallback profile's client (§4.3.5 `Routing.fallback`, M4-E9), already filtered by the privacy rule. */
export interface FallbackLink {
  client: LLMClient;
  profile: ModelProfile;
  connection?: JobConnection;
}

/** A role's client for the routed profile, or why there is none. */
export type AnalyzeResult = { ok: true; client: LLMClient; profile: ModelProfile; connection?: JobConnection } | { ok: false; error: LLMError; connection?: JobConnection };

/** What a job needs from the panel: the translate client for the routed profile, or why there is none. */
export type ClientResult =
  | {
      ok: true;
      client: LLMClient;
      profile: ModelProfile;
      connection?: JobConnection;
      /** The fallback chain after `client`, in order (M4-E9). Absent or empty: none. */
      fallback?: FallbackLink[];
      /** The local-only site rule (its pattern) that routed the page: no cloud link in `fallback` (§4.3.5). */
      localOnly?: string;
      /**
       * Resolves the `analyze` role's client (the document brief); called only when the run will
       * make an analyze call. Undefined from it = the translate client serves it (§4.3.1).
       */
      analyze?: () => Promise<AnalyzeResult | undefined>;
    }
  | { ok: false; error: LLMError; connection?: JobConnection };

/** What the route is resolved for (§4.3.5): the page's tab (its override) and URL (site rules). */
export interface ClientTarget {
  tabId: number;
  url: string;
  /** The run may make an analyze call (not single-pass, not a segment retry): give a resolver for that role too. */
  analyze?: boolean;
}

const addUsage = (a: UsageTotals, b: UsageTotals): UsageTotals => ({ input: a.input + b.input, cachedInput: a.cachedInput + b.cachedInput, output: a.output + b.output });

/**
 * The page's cost: its usage priced with the translate profile, except what the analyze call
 * spent on its own profile (`job.apart`, priced as it came). Undefined when nothing is priced.
 * Without an analyze profile of its own this is `costUsd(profile.pricing, usage)` exactly.
 */
function pageCost(job: Job, profile: ModelProfile, usage: UsageTotals): number | undefined {
  const a = job.apart.usage;
  const own = a.input === 0 && a.output === 0 && a.cachedInput === 0 ? usage : { input: usage.input - a.input, cachedInput: usage.cachedInput - a.cachedInput, output: usage.output - a.output };
  const main = costUsd(profile.pricing, own);
  return main === undefined && job.apart.usd === undefined ? undefined : (main ?? 0) + (job.apart.usd ?? 0);
}

/**
 * The profile a usage event is priced with: the one whose client spent it (`event.client`, the
 * profile id the job tags its clients with); else, for a test engine without ids, the analyze
 * call's own profile or a fallback by its model (M4-E9); else the translate profile.
 */
function spendingProfile(job: Job, event: { role: string; model: string; client?: string }, profile: ModelProfile): ModelProfile {
  const all = [profile, ...(job.analyzeProfile ? [job.analyzeProfile] : []), ...job.fallbackProfiles];
  const byId = event.client === undefined ? undefined : all.find((p) => p.id === event.client);
  if (byId) return byId;
  if (event.role === 'analyze' && job.analyzeProfile !== undefined && event.model === job.analyzeProfile.model) return job.analyzeProfile;
  if (event.model === profile.model) return profile;
  return job.fallbackProfiles.find((p) => p.model === event.model) ?? (event.role === 'analyze' && job.analyzeProfile ? job.analyzeProfile : profile);
}

export interface JobDeps {
  /** Resolves the `translate` role (§4.3.5) for a page: key, host permission, profile. Called once per run. */
  translateClient: (target: ClientTarget) => Promise<ClientResult>;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** The engine's retry policy (default DEFAULT_RETRY_POLICY); the backoff and fallback notes follow the same one. */
  retry?: RetryPolicy;
  /** Test seam: the engine to run (default: single-pass and contextual over the given clients). */
  engine?: (client: LLMClient, analyze?: LLMClient, fallback?: readonly LLMClient[]) => TranslationEngine;
  /** Test seam: the strategy jobs run (default PANEL_STRATEGY). */
  strategy?: StrategyId;
  /** The translation cache (M3-E2). Absent: every run goes to the model. */
  cache?: TranslationCache | undefined;
  /** How long a run waits for the cache before it goes to the model without it (default 1500). */
  cacheTimeoutMs?: number;
  /** Every usage report, priced (the running total in settings, M3-E9), with the profile that spent it (M4-E10). */
  onSpend?: (delta: SpendDelta) => void;
  /**
   * A request was refused for its key (401, 403: `auth`) on this connection: settings mark it
   * `error` (§4.3.5). Not called for a missing key (nothing was sent).
   */
  onAuthError?: (connectionId: string, error: LLMError) => void;
  /**
   * The monthly soft limit (M4-E10), asked before a run sends its first request (after the cache:
   * a page that is all cached costs nothing): reached → the run stops and says so. Absent: none.
   */
  spendLimit?: () => Promise<LimitReached | undefined>;
}

/** What a run stopped by the soft limit shows as its error. */
export const limitError = (l: LimitReached): LLMError => ({ kind: 'unknown', message: `This month's spend (${formatUsd(l.monthUsd)}) reached your soft limit of ${formatUsd(l.limitUsd)}` });

export interface JobDoc {
  url: string;
  title: string;
  /** The page's own `lang`, kept so a changed source-language setting can be re-applied. */
  pageLang?: string;
  sourceLang: string;
  targetLang: string;
  /** The detection chain's answer (src/shared/language.ts). */
  detection?: Detection;
  /** Per-segment detection (flag): translatable segments already in the target language, kept as they are. */
  keep?: ReadonlySet<string>;
  segments: Segment[];
  /** From the settings (plan M2-E6); absent = Natural, gloss on first use, no personal glossary. */
  style?: StyleMode;
  gloss?: GlossMode;
  glossary?: readonly GlossaryEntry[];
  /** The per-page token ceiling from the settings (plan M2-E7); absent or 0 = no limit. */
  budgetTokens?: number;
}

interface Job {
  /** The document the job belongs to (content script `docId`). */
  docId: string;
  doc: JobDoc;
  view: JobView;
  segs: Map<string, SegState>;
  controller: AbortController;
  gate: Gate;
  /** Requests sent and not ended yet. */
  inflight: number;
  /** Bumped per run, so a finished run can't overwrite a newer one. */
  run: number;
  /** Segments on screen at the run's start still to settle (view.screenDoneAt). */
  screen: Set<string>;
  /** Cache key per translatable segment id; empty without a cache. */
  keys: Map<string, string>;
  /** Cache writes waiting for the end of this tick (coalesced), and the keys to drop. */
  writes: Map<string, CachedSegment>;
  drops: Set<string>;
  /** Cache writes run one after another, so a later delete can't overtake an earlier put. */
  chain: Promise<void>;
  flush?: boolean;
  /** A retranslate run: its stored finals replace whatever the cache has. */
  fresh?: boolean;
  /** Cache keys whose next write replaces the stored entry (a retranslated block, M3-E5). */
  replaceKeys: Set<string>;
  /** The brief cache key of this document; undefined without a cache. */
  briefKey?: string | undefined;
  /** The analyze role's own profile, when routing sends it elsewhere than translate (its usage is priced with it). */
  analyzeProfile?: ModelProfile;
  /** The fallback profiles of this run (M4-E9): usage a fallback answered is priced with its profile. */
  fallbackProfiles: ModelProfile[];
  /** Cache scope per model other than the job's (a fallback's finals are stored under it, §7). */
  scopes: Map<string, string>;
  /** Usage on profiles other than translate's (analyze, fallback) and its cost, across the page's runs; the rest of `view.usage` is priced with the translate profile. */
  apart: { usage: UsageTotals; usd: number | undefined };
  /** Requests waiting out a retryable failure, and the failed attempts so far per link and chunk (M3-E8). */
  backoff: Map<number, Backoff>;
  failures: Map<string, number>;
  /** Single-segment retries in flight, by segment id (M3-E8). */
  retrying: Map<string, AbortController>;
  /** Counts segment retries, for their backoff keys. */
  retrySeq: number;
}

export type JobsListener = (tabId: number, view: JobView | undefined) => void;

const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

export class Jobs {
  private readonly jobs = new Map<number, Job>();
  /** What is on screen per tab, for the document it was reported for. */
  private readonly viewports = new Map<number, { docId: string; ids: readonly string[] }>();
  private readonly listeners = new Set<JobsListener>();
  private activeTabId: number | undefined;
  private readonly now: () => number;

  constructor(private readonly deps: JobDeps) {
    this.now = deps.now ?? Date.now;
  }

  subscribe(fn: JobsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(tabId: number): JobView | undefined {
    return this.jobs.get(tabId)?.view;
  }

  /** The job's document id, so the panel can tell a job of a previous page. */
  docOf(tabId: number): string | undefined {
    return this.jobs.get(tabId)?.docId;
  }

  /**
   * What is on screen in the tab's document (plan M3-E1), in page order. An empty list (scrolled
   * past the article) keeps the last one, so the job reads on from where the reader was.
   */
  setViewport(tabId: number, docId: string, ids: readonly string[]): void {
    if (ids.length === 0 && this.viewports.get(tabId)?.docId === docId) return;
    this.viewports.set(tabId, { docId, ids: [...ids] });
  }

  /** The segment ids on screen in the tab's document, as last reported. */
  private screenOf(tabId: number, docId: string): readonly string[] {
    const v = this.viewports.get(tabId);
    return v?.docId === docId ? v.ids : [];
  }

  /** D14: only the active tab's job sends new requests. */
  setActive(tabId: number | undefined): void {
    this.activeTabId = tabId;
    for (const [id, job] of this.jobs) {
      job.gate.set(id === tabId);
      this.patch(id, job, { paused: job.view.status === 'running' && id !== tabId });
    }
  }

  /**
   * Translates the page in `tabId`. A job of another document in that tab is cancelled and
   * replaced. `resume` keeps a cancelled or finished job's finals and its cost, and translates
   * only what is left (pending or failed). `keepCost` keeps only the cost of the same document's
   * earlier runs (a restart in other languages): the page total stays honest. `keepBrief` keeps
   * the same document's brief when the target language is unchanged (a restart for a new style or
   * glossary): the brief doesn't depend on them, so no second analyze call. `fresh` ignores the
   * translation cache for this run (retranslate, M3 decision D2); results are still stored.
   */
  async start(tabId: number, docId: string, doc: JobDoc, { resume = false, keepCost = false, keepBrief = false, fresh = false } = {}): Promise<void> {
    const prev = this.jobs.get(tabId);
    const keep = resume && prev?.docId === docId && prev.view.status !== 'running' ? prev : undefined;
    const costFrom = keep ?? (keepCost && prev?.docId === docId ? prev : undefined);
    const brief = keep?.view.brief ?? (keepBrief && prev?.docId === docId && prev.view.targetLang === doc.targetLang ? prev.view.brief : undefined);
    // A replaced run's requests in flight end without usage; they are this page's spend too.
    const abandoned = costFrom && costFrom.view.status === 'running' ? costFrom.inflight : 0;
    if (prev?.view.status === 'running') prev.controller.abort(new DOMException('replaced', 'AbortError'));
    if (prev) this.stopRetries(prev);

    // Segments already in the target language (per-segment detection) are shown as is, like code.
    const segments = doc.keep?.size ? doc.segments.map((s) => (s.translate && doc.keep?.has(s.id) ? { ...s, translate: false } : s)) : doc.segments;
    const translatable = segments.filter((s) => s.translate);
    const segs = new Map<string, SegState>();
    for (const s of translatable) {
      const old = keep?.segs.get(s.id);
      segs.set(s.id, old?.status === 'final' ? old : { status: 'pending' });
    }
    const todo = new Set(translatable.filter((s) => segs.get(s.id)?.status !== 'final').map((s) => s.id));
    const screen = new Set(this.screenOf(tabId, docId).filter((id) => todo.has(id)));
    const gate = new Gate();
    gate.set(tabId === this.activeTabId);
    const job: Job = {
      docId,
      doc,
      segs,
      controller: new AbortController(),
      gate,
      inflight: 0,
      run: (prev?.run ?? 0) + 1,
      screen,
      keys: new Map(),
      writes: new Map(),
      drops: new Set(),
      chain: Promise.resolve(),
      backoff: new Map(),
      failures: new Map(),
      fallbackProfiles: [],
      scopes: new Map(),
      retrying: new Map(),
      retrySeq: 0,
      replaceKeys: new Set(),
      apart: costFrom ? { usage: { ...costFrom.apart.usage }, usd: costFrom.apart.usd } : { usage: { input: 0, cachedInput: 0, output: 0 }, usd: undefined },
      fresh,
      view: {
        status: 'running',
        paused: !gate.open,
        model: keep?.view.model ?? '',
        targetLang: doc.targetLang,
        // A resumed run keeps its brief, and the brief's language when detection found none.
        sourceLang: doc.sourceLang || (brief?.language ?? ''),
        ...(doc.detection ? { detection: doc.detection } : {}),
        ...(brief ? { brief } : {}),
        segments,
        segs,
        counts: count(segs),
        usage: costFrom ? { ...costFrom.view.usage } : { input: 0, cachedInput: 0, output: 0 },
        cached: 0,
        cost: costFrom?.view.cost,
        unmetered: (costFrom?.view.unmetered ?? 0) + abandoned,
        startedAt: this.now(),
      },
    };
    this.jobs.set(tabId, job);
    this.emit(tabId, job.view);

    const signal = job.controller.signal;
    const resolved = await this.deps.translateClient({ tabId, url: doc.url, analyze: (this.deps.strategy ?? PANEL_STRATEGY) !== 'single-pass' });
    if (signal.aborted || this.jobs.get(tabId) !== job) return;
    if (resolved.connection) this.patch(tabId, job, { connection: resolved.connection });
    if (!resolved.ok) {
      this.finish(tabId, job, 'stopped', resolved.error);
      return;
    }
    const { client, profile } = resolved;
    if (resolved.localOnly !== undefined) this.patch(tabId, job, { localOnly: resolved.localOnly });
    job.fallbackProfiles = resolved.fallback?.map((l) => l.profile) ?? [];
    this.patch(tabId, job, { model: client.model });
    await this.fromCache(tabId, job, { todo, translatable, model: client.model, fresh });
    if (signal.aborted || this.jobs.get(tabId) !== job) return;
    // The analyze call sees only the segments still to translate. A brief stored under the key of
    // the whole page must come from the whole page, so a run that skips any segment stores none.
    if (todo.size !== translatable.length) job.briefKey = undefined;
    if (todo.size === 0) {
      this.finish(tabId, job, 'done');
      return;
    }
    // The soft limit warns before anything is sent (M4-E10); a run already going is never cut.
    const limit = await this.deps.spendLimit?.().catch(() => undefined);
    if (signal.aborted || this.jobs.get(tabId) !== job) return;
    if (limit) {
      this.patch(tabId, job, { limit });
      this.finish(tabId, job, 'stopped', limitError(limit));
      return;
    }
    // The analyze role is resolved only when the brief will be asked for: a kept or cached brief
    // means no analyze call, so its route must not stop the run.
    const analyze = resolved.analyze && !job.view.brief ? await resolved.analyze() : undefined;
    if (signal.aborted || this.jobs.get(tabId) !== job) return;
    if (analyze && !analyze.ok) {
      if (analyze.connection) this.patch(tabId, job, { connection: analyze.connection });
      this.finish(tabId, job, 'stopped', analyze.error);
      return;
    }
    if (analyze) job.analyzeProfile = analyze.profile;
    const engine = this.engineFor(tabId, job, { client, profile, ...(resolved.connection ? { connection: resolved.connection } : {}) }, undefined, analyze, resolved.fallback);
    const engineJob: TranslationJob = {
      doc: {
        url: doc.url,
        title: doc.title,
        sourceLang: doc.sourceLang,
        targetLang: doc.targetLang,
        outline: segments.filter((s) => s.kind === 'heading').map((s) => s.text),
        // Already-final segments are not sent again (resume). Code blocks ride along; the engine skips them.
        segments: segments.filter((s) => !s.translate || todo.has(s.id)),
      },
      // Viewport first (M3-E1): what is on screen now, read again each time a chunk starts.
      priority: [...this.screenOf(tabId, docId)],
      livePriority: () => this.screenOf(tabId, docId),
      strategy: this.deps.strategy ?? PANEL_STRATEGY,
      options: {
        style: doc.style ?? 'natural',
        ...(doc.gloss ? { gloss: doc.gloss } : {}),
        glossary: [...(doc.glossary ?? [])],
        ...(doc.budgetTokens ? { budget: { maxTokens: doc.budgetTokens } } : {}),
        maxConcurrency: profile.maxConcurrency,
        chunkTokens: profile.chunkTokens,
        // A resumed run keeps its brief: no second analyze call (and none made from the leftover segments only).
        ...(job.view.brief ? { brief: job.view.brief } : {}),
      },
    };
    try {
      for await (const event of engine.translate(engineJob, signal)) {
        if (this.jobs.get(tabId) !== job) return;
        this.onEvent(tabId, job, event, profile);
      }
      if (job.view.status === 'running') this.finish(tabId, job, 'done');
    } catch (err) {
      if (this.jobs.get(tabId) !== job || job.view.status !== 'running') return;
      // A cancel throws the abort reason; anything else is an engine bug (it degrades rather than throws).
      this.finish(tabId, job, signal.aborted ? 'cancelled' : 'stopped', signal.aborted ? undefined : { kind: 'unknown', message: err instanceof Error ? err.message : String(err), raw: err });
    }
  }

  /**
   * The page is already in the target language (plan M2 criterion 6): a job that sends nothing,
   * shown as a note. A running job of the tab is replaced. `resume` translates it anyway.
   */
  skip(tabId: number, docId: string, doc: JobDoc): void {
    const prev = this.jobs.get(tabId);
    if (prev?.view.status === 'running') prev.controller.abort(new DOMException('replaced', 'AbortError'));
    if (prev) this.stopRetries(prev);
    const segs = new Map<string, SegState>();
    const keepCost = prev?.docId === docId ? prev : undefined;
    const now = this.now();
    const job: Job = {
      docId,
      doc,
      segs,
      controller: new AbortController(),
      gate: new Gate(),
      inflight: 0,
      run: (prev?.run ?? 0) + 1,
      screen: new Set(),
      keys: new Map(),
      writes: new Map(),
      drops: new Set(),
      chain: Promise.resolve(),
      backoff: new Map(),
      failures: new Map(),
      fallbackProfiles: [],
      scopes: new Map(),
      retrying: new Map(),
      retrySeq: 0,
      replaceKeys: new Set(),
      apart: keepCost ? { usage: { ...keepCost.apart.usage }, usd: keepCost.apart.usd } : { usage: { input: 0, cachedInput: 0, output: 0 }, usd: undefined },
      view: {
        status: 'skipped',
        paused: false,
        model: '',
        targetLang: doc.targetLang,
        sourceLang: doc.sourceLang,
        ...(doc.detection ? { detection: doc.detection } : {}),
        segments: doc.segments,
        segs,
        counts: { total: 0, final: 0, failed: 0 },
        usage: keepCost ? { ...keepCost.view.usage } : { input: 0, cachedInput: 0, output: 0 },
        cached: 0,
        cost: keepCost?.view.cost,
        unmetered: keepCost?.view.unmetered ?? 0,
        startedAt: now,
        endedAt: now,
      },
    };
    this.jobs.set(tabId, job);
    this.emit(tabId, job.view);
  }

  /** "Continue anyway" past the soft limit failed (its setting could not be saved): the stopped bar says so. */
  limitFailed(tabId: number, message: string): void {
    const job = this.jobs.get(tabId);
    if (!job?.view.limit || job.view.status !== 'stopped') return;
    this.patch(tabId, job, { limit: { ...job.view.limit, failed: message } });
  }

  /** Translates what the tab's job left (cancelled, failed or stopped segments) for the same document. */
  resume(tabId: number): Promise<void> {
    const job = this.jobs.get(tabId);
    if (!job || job.view.status === 'running') return Promise.resolve();
    return this.start(tabId, job.docId, job.doc, { resume: true });
  }

  /** Resolves when every cache write the jobs have queued so far has finished (tests, harness). */
  async cacheIdle(): Promise<void> {
    await Promise.resolve();
    await Promise.all([...this.jobs.values()].map((j) => j.chain));
  }

  /** The tab's job document, for a restart with other languages. */
  docFor(tabId: number): { docId: string; doc: JobDoc } | undefined {
    const job = this.jobs.get(tabId);
    return job && { docId: job.docId, doc: job.doc };
  }

  /** The Cancel button, a navigation, the tab closing. Finals stay; previews are dropped. */
  cancel(tabId: number): void {
    const job = this.jobs.get(tabId);
    if (job) this.stopRetries(job);
    if (!job || job.view.status !== 'running') return;
    job.controller.abort(new DOMException('cancelled', 'AbortError'));
    this.finish(tabId, job, 'cancelled');
  }

  /**
   * Translates one failed segment again (its inline Retry, M3-E8), and only that one: a single
   * request through the engine's snippet path, folded into the job like any other result. Works
   * on a running, finished or stopped job; Cancel and a navigation abort it. A failure puts the
   * earlier error back.
   */
  retrySegment(tabId: number, id: string): Promise<void> {
    return this.redoSegment(tabId, id, 'retry');
  }

  /**
   * Translates one finished block again (its Retranslate action, M3-E5): the same single request
   * as a Retry, never answered from the cache (the snippet path has no lookup), and its new final
   * replaces the stored entry whatever its revision (decision M3-D2). The earlier text stays on
   * screen until the new one streams in; a failure keeps it and says so (`redoError`).
   */
  retranslateSegment(tabId: number, id: string): Promise<void> {
    return this.redoSegment(tabId, id, 'retranslate');
  }

  private async redoSegment(tabId: number, id: string, mode: 'retry' | 'retranslate'): Promise<void> {
    const job = this.jobs.get(tabId);
    const before = job?.segs.get(id);
    const segment = job?.view.segments.find((s) => s.id === id);
    if (!job || !segment || before?.status !== (mode === 'retry' ? 'failed' : 'final') || job.retrying.has(id)) return;
    const failedWith = (error: LLMError): SegState => (mode === 'retry' ? { ...before, error } : { ...before, redoError: error });
    const controller = new AbortController();
    const { signal } = controller;
    job.retrying.set(id, controller);
    const settle = (state: SegState) => {
      if (this.jobs.get(tabId) !== job) return;
      job.segs.set(id, state);
      this.remember(job, id, state);
      this.patch(tabId, job, { counts: count(job.segs) });
    };
    // A retranslated block keeps its earlier text on screen until the new one streams in.
    settle(mode === 'retry' ? { status: 'pending' } : { status: 'pending', ...(before.text === undefined ? {} : { text: before.text }) });
    try {
      const resolved = await this.deps.translateClient({ tabId, url: job.doc.url });
      if (signal.aborted) return settle(before);
      const limit = await this.deps.spendLimit?.().catch(() => undefined);
      if (signal.aborted) return settle(before);
      if (limit) return settle(failedWith(limitError(limit)));
      if (!resolved.ok) {
        settle(failedWith(resolved.error));
        if (stopsJob(resolved.error) && job.view.status !== 'running') this.finish(tabId, job, 'stopped', resolved.error);
        return;
      }
      const { doc } = job;
      const request: SnippetRequest = {
        doc: { url: doc.url, title: doc.title, sourceLang: doc.sourceLang, targetLang: doc.targetLang, outline: [] },
        segments: [segment],
        options: {
          style: doc.style ?? 'natural',
          ...(doc.gloss ? { gloss: doc.gloss } : {}),
          glossary: [...(doc.glossary ?? [])],
          maxConcurrency: 1,
          chunkTokens: resolved.profile.chunkTokens,
          ...(job.view.brief ? { brief: job.view.brief } : {}),
        },
      };
      let outcome: SegState | undefined;
      job.fallbackProfiles = resolved.fallback?.map((l) => l.profile) ?? [];
      const primary = { client: resolved.client, profile: resolved.profile, ...(resolved.connection ? { connection: resolved.connection } : {}) };
      for await (const event of this.engineFor(tabId, job, primary, -2 - ++job.retrySeq, undefined, resolved.fallback).translateSnippet(request, signal)) {
        if (this.jobs.get(tabId) !== job) return;
        if (event.type === 'usage') this.onEvent(tabId, job, event, resolved.profile);
        if (event.type !== 'segment.partial' && event.type !== 'segment.final' && event.type !== 'segment.failed') continue;
        if (event.id !== id) continue;
        const next = applySegmentEvent(outcome ?? { status: 'pending' }, event);
        if (!next || next === outcome) continue;
        outcome = next;
        if (next.status === 'streaming') {
          job.segs.set(id, next);
          this.patch(tabId, job, { counts: count(job.segs) });
        }
      }
      if (signal.aborted || !outcome || outcome.status === 'streaming' || outcome.status === 'pending') return settle(before);
      if (outcome.status === 'failed' && mode === 'retranslate') settle(failedWith(outcome.error ?? { kind: 'unknown', message: 'no translation came back' }));
      else {
        const key = this.keyFor(job, id, outcome.model);
        if (mode === 'retranslate' && key !== undefined) job.replaceKeys.add(key);
        settle(outcome);
      }
      if (outcome.status === 'failed' && outcome.error && stopsJob(outcome.error) && job.view.status !== 'running') this.finish(tabId, job, 'stopped', outcome.error);
    } catch (err) {
      settle(signal.aborted ? before : failedWith({ kind: 'unknown', message: err instanceof Error ? err.message : String(err), raw: err }));
    } finally {
      if (job.retrying.get(id) === controller) job.retrying.delete(id);
    }
  }

  private stopRetries(job: Job): void {
    for (const c of job.retrying.values()) c.abort(new DOMException('cancelled', 'AbortError'));
    job.retrying.clear();
  }

  /**
   * The engine over the job's clients: each counted, gated by the tab being active and watched for
   * backoff (M3-E8), and for a refused key (§4.3.5: the connection is marked `error`, "Fix key"
   * names it). `primary` is the routed profile; `fallback` its chain (M4-E9), shared by both roles.
   */
  private engineFor(tabId: number, job: Job, primary: FallbackLink, retryKey?: number, analyze?: FallbackLink, fallback: readonly FallbackLink[] = []): TranslationEngine {
    const { profile } = primary;
    const meter = {
      start: () => void job.inflight++,
      end: (unmetered: boolean) => {
        job.inflight--;
        if (unmetered) this.patch(tabId, job, { unmetered: job.view.unmetered + 1, cost: pageCost(job, profile, job.view.usage) });
      },
    };
    const publish = () => this.patch(tabId, job, { backoff: job.backoff.size ? [...job.backoff.values()] : [] });
    // A segment retry has its own key (-2 and below), apart from the chunks (0 and up) and the analyze call (-1).
    const keyed = (chunk: number) => retryKey ?? chunk;
    // Each link of a chain counts its own failed attempts: the next link starts its backoff afresh.
    const watchFor = (link: number, next: FallbackLink | undefined, model: string) => ({
      waiting: (chunk: number, error: LLMError) => {
        chunk = keyed(chunk);
        const at = `${link}:${chunk}`;
        const attempt = (job.failures.get(at) ?? 0) + 1;
        job.failures.set(at, attempt);
        // The engine gives up (or hands over) after its retries: that is a failure, not a wait.
        if (decideRetry(error, attempt - 1, this.deps.retry).action !== 'retry') {
          job.backoff.delete(chunk);
          job.failures.delete(at);
          if (next && job.view.status === 'running') this.patch(tabId, job, { fallback: { from: model, to: next.client.model, error } });
        } else job.backoff.set(chunk, { chunk, kind: error.kind, attempt, ...(error.retryAfterMs === undefined ? {} : { until: this.now() + error.retryAfterMs }) });
        publish();
      },
      started: (chunk: number) => {
        if (job.backoff.delete(keyed(chunk))) publish();
      },
      streaming: (chunk: number) => void job.failures.delete(`${link}:${keyed(chunk)}`),
    });
    const onAuth = (link: FallbackLink) => (error: LLMError) => {
      if (!link.connection || this.jobs.get(tabId) !== job) return;
      this.patch(tabId, job, { connection: link.connection });
      this.deps.onAuthError?.(link.connection.id, error);
    };
    // One wrapped client per profile: the analyze route and a fallback on the same profile are one
    // link to the engine, so a link that gave up is skipped by both (fallback.ts `dead`).
    const wrapped = new Map<string, LLMClient>();
    const wrap = (link: FallbackLink, index: number, next: FallbackLink | undefined) => {
      let c = wrapped.get(link.profile.id);
      if (c === undefined) {
        // Tagged with its profile (LLMClient.id): usage it spends is priced with that profile.
        c = { ...gatedClient(authClient(backoffClient(meteredClient(link.client, meter), watchFor(index, next, link.client.model)), onAuth(link)), job.gate), id: link.profile.id };
        wrapped.set(link.profile.id, c);
      }
      return c;
    };
    const chain = [primary, ...fallback];
    const gated = wrap(primary, 0, fallback[0]);
    const gatedFallback = fallback.map((l, i) => wrap(l, i + 1, chain[i + 2]));
    const gatedAnalyze = analyze ? wrap(analyze, chain.findIndex((l) => l.profile.id === analyze.profile.id), fallback[0]) : undefined;
    return this.deps.engine?.(gated, gatedAnalyze, gatedFallback) ?? this.defaultEngine(gated, gatedAnalyze, gatedFallback);
  }

  /** The tab is gone (closed, moved to another window): cancel and forget its job. */
  drop(tabId: number): void {
    this.cancel(tabId);
    this.viewports.delete(tabId);
    if (this.jobs.delete(tabId)) this.emit(tabId, undefined);
  }

  /** The panel is closing. */
  cancelAll(): void {
    for (const tabId of this.jobs.keys()) this.cancel(tabId);
  }

  private defaultEngine(client: LLMClient, analyze?: LLMClient, fallback: readonly LLMClient[] = []): TranslationEngine {
    return createEngine({
      // The engine asks by role (§5.1); route.ts resolved each through routing (src/shared/providers.ts
      // resolveRoute): `analyze` has its own client only when routed elsewhere, else it is translate's (§4.3.1).
      llm: (role) => {
        if (role === 'review') throw new Error(`no model profile is routed for the ${role} role yet`);
        return role === 'analyze' && analyze ? analyze : client;
      },
      // Both roles hand over to the same chain (M4-E9), so a link that gave up is skipped by both.
      fallback: () => fallback,
      now: this.now,
      sleep: this.deps.sleep ?? abortableSleep,
      ...(this.deps.retry === undefined ? {} : { retry: this.deps.retry }),
      strategies: [singlePass, contextual],
      prompts: createDefaultPromptRegistry(),
    });
  }

  private onEvent(tabId: number, job: Job, event: EngineEvent, profile: ModelProfile): void {
    switch (event.type) {
      case 'segment.partial':
      case 'segment.final':
      case 'segment.failed': {
        // A job that ended (cancel, stop) keeps what it showed: a late event of another chunk in
        // flight must not bring back a preview or change a count (review E-R2). Usage still
        // counts below: it was spent.
        if (job.view.status !== 'running' || !job.segs.has(event.id)) return;
        const cur = job.segs.get(event.id);
        const next = applySegmentEvent(cur, event);
        if (next === cur || next === undefined) return;
        job.segs.set(event.id, next);
        this.remember(job, event.id, next);
        const patch: Partial<JobView> = { counts: count(job.segs) };
        if (job.view.firstVisibleAt === undefined && next.text) patch.firstVisibleAt = this.now();
        if ((next.status === 'final' || next.status === 'failed') && job.screen.delete(event.id) && job.screen.size === 0) patch.screenDoneAt = this.now();
        this.patch(tabId, job, patch);
        if (event.type === 'segment.failed' && STOP_KINDS.has(event.error.kind)) {
          job.controller.abort(new DOMException('stopped', 'AbortError'));
          this.finish(tabId, job, 'stopped', event.error);
        }
        return;
      }
      case 'artifact': {
        // The engine's brief is already normalized; checked again because the view renders it.
        if (event.kind !== 'brief' || job.view.status !== 'running') return;
        const brief = normalizeBrief(event.data);
        if (!brief) return;
        const sourceLang = job.view.sourceLang || brief.language || '';
        this.patch(tabId, job, { brief, sourceLang });
        if (job.briefKey !== undefined) void this.deps.cache?.putBrief(job.briefKey, brief).catch(() => {});
        return;
      }
      case 'usage': {
        const spent = { input: event.input, cachedInput: event.cachedInput ?? 0, output: event.output };
        // Priced with the profile that answered (§4.3.5 usage meter): the analyze call's own
        // profile, or a fallback's (M4-E9); the rest is the translate profile's.
        const by = spendingProfile(job, event, profile);
        const apart = by !== profile;
        const usd = costUsd(by.pricing, spent);
        this.deps.onSpend?.({ usage: spent, usd, profileId: by.id, model: event.model });
        if (apart) job.apart = { usage: addUsage(job.apart.usage, spent), usd: usd === undefined ? job.apart.usd : (job.apart.usd ?? 0) + usd };
        const usage = addUsage(job.view.usage, spent);
        this.patch(tabId, job, { usage, cost: pageCost(job, profile, usage) });
        return;
      }
      default:
        return;
    }
  }

  /**
   * Shows what the translation cache has for the run's segments as final (never sent), and seeds
   * the brief from the brief cache when the run has none. Any cache error just means a normal run.
   * Mutates `todo`: the segments still to translate.
   */
  private async fromCache(tabId: number, job: Job, run: { todo: Set<string>; translatable: readonly Segment[]; model: string; fresh: boolean }): Promise<void> {
    const cache = this.deps.cache;
    if (!cache) return;
    const { doc } = job;
    const segments = job.view.segments;
    const scope = scopeHash(keyScope({ targetLang: doc.targetLang, model: run.model, style: doc.style, gloss: doc.gloss, strategy: this.deps.strategy ?? PANEL_STRATEGY, glossary: doc.glossary }));
    for (const s of run.translatable) job.keys.set(s.id, segmentKey(scope, s));
    job.briefKey = briefCacheKey({ url: doc.url, title: doc.title, targetLang: doc.targetLang, outline: segments.filter((s) => s.kind === 'heading').map((s) => s.text) }, segments);
    if (run.fresh) return;
    try {
      const wanted = run.translatable.filter((s) => run.todo.has(s.id));
      // A cache that never answers (a blocked or dead database) must not hold the translation.
      const timedOut = Symbol('timeout');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const lookup = Promise.all([cache.getMany([...new Set(wanted.map((s) => job.keys.get(s.id) as string))]), job.view.brief ?? cache.getBrief(job.briefKey)]);
      const found = await Promise.race([lookup, new Promise<typeof timedOut>((resolve) => (timer = setTimeout(() => resolve(timedOut), this.deps.cacheTimeoutMs ?? 1500)))]);
      clearTimeout(timer);
      lookup.catch(() => {});
      if (found === timedOut) return;
      const [hits, brief] = found;
      if (job.controller.signal.aborted || this.jobs.get(tabId) !== job) return;
      const patch: Partial<JobView> = {};
      let shown = 0;
      for (const s of wanted) {
        const hit = hits.get(job.keys.get(s.id) as string);
        if (!hit) continue;
        job.segs.set(s.id, { status: 'final', text: hit.text, revision: hit.revision, attempt: hit.attempt });
        run.todo.delete(s.id);
        job.screen.delete(s.id);
        shown++;
      }
      if (shown > 0) {
        patch.cached = shown;
        patch.counts = count(job.segs);
        patch.firstVisibleAt = this.now();
        if (job.screen.size === 0 && this.screenOf(tabId, job.docId).some((id) => job.segs.get(id)?.status === 'final')) patch.screenDoneAt = this.now();
      }
      if (brief && !job.view.brief) {
        patch.brief = brief;
        if (!job.view.sourceLang && brief.language) patch.sourceLang = brief.language;
      }
      if (Object.keys(patch).length > 0) this.patch(tabId, job, patch);
    } catch {
      // A broken cache is a cache miss.
    }
  }

  /** Stores the final a segment now shows (the highest revision only), or drops the entry of one that failed. */
  private remember(job: Job, id: string, state: SegState): void {
    // A final is stored under the model that produced it (§7); a failure drops the job model's entry.
    const key = state.status === 'final' ? this.keyFor(job, id, state.model) : job.keys.get(id);
    if (key === undefined || !this.deps.cache) return;
    if (state.status === 'final' && state.text !== undefined) {
      job.drops.delete(key);
      job.writes.set(key, { text: state.text, revision: state.revision ?? 1, attempt: state.attempt ?? 1 });
    } else if (state.status === 'failed') {
      job.writes.delete(key);
      job.drops.add(key);
    } else return;
    if (job.flush) return;
    job.flush = true;
    // Coalesced: one transaction for the finals of a tick.
    queueMicrotask(() => this.flushCache(job));
  }

  /** The cache key of a segment's final from `model` (the job's model when absent); undefined without a cache. */
  private keyFor(job: Job, id: string, model: string | undefined): string | undefined {
    const own = job.keys.get(id);
    if (own === undefined || model === undefined || model === job.view.model) return own;
    const segment = job.view.segments.find((s) => s.id === id);
    if (!segment) return undefined;
    let scope = job.scopes.get(model);
    if (scope === undefined) {
      const { doc } = job;
      scope = scopeHash(keyScope({ targetLang: doc.targetLang, model, style: doc.style, gloss: doc.gloss, strategy: this.deps.strategy ?? PANEL_STRATEGY, glossary: doc.glossary }));
      job.scopes.set(model, scope);
    }
    return segmentKey(scope, segment);
  }

  private flushCache(job: Job): void {
    job.flush = false;
    const cache = this.deps.cache;
    if (!cache) return;
    const writes = new Map(job.writes);
    const drops = [...job.drops];
    job.writes.clear();
    job.drops.clear();
    // A retranslated block replaces its entry (M3-D2), even in a run that otherwise keeps a higher revision.
    const replacing = new Map<string, CachedSegment>();
    if (!job.fresh) {
      for (const [key, entry] of writes) {
        if (!job.replaceKeys.delete(key)) continue;
        replacing.set(key, entry);
        writes.delete(key);
      }
    }
    job.chain = job.chain
      .then(() => cache.delete(drops))
      .then(() => (replacing.size ? cache.putMany(replacing, { replace: true }) : undefined))
      .then(() => cache.putMany(writes, { replace: job.fresh === true }))
      .catch(() => {});
  }

  private finish(tabId: number, job: Job, status: Exclude<JobStatus, 'running'>, stopError?: LLMError): void {
    // Previews of a request that did not finish can't be trusted: back to the original.
    for (const [id, s] of job.segs) if (s.status === 'streaming' && !job.retrying.has(id)) job.segs.set(id, { status: 'pending' });
    job.backoff.clear();
    this.patch(tabId, job, { backoff: [], status, paused: false, counts: count(job.segs), endedAt: this.now(), ...(stopError ? { stopError } : {}) });
  }

  private patch(tabId: number, job: Job, patch: Partial<JobView>): void {
    job.view = { ...job.view, ...patch };
    if (this.jobs.get(tabId) === job) this.emit(tabId, job.view);
  }

  private emit(tabId: number, view: JobView | undefined): void {
    for (const fn of this.listeners) fn(tabId, view);
  }
}

function count(segs: ReadonlyMap<string, SegState>): JobView['counts'] {
  let final = 0;
  let failed = 0;
  for (const s of segs.values()) {
    if (s.status === 'final') final++;
    else if (s.status === 'failed') failed++;
  }
  return { total: segs.size, final, failed };
}
