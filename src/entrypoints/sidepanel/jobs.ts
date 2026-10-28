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
// - Lazy mode (plan M5-E4, DESIGN §9 very long docs): a page with more than `lazyAbove` translatable
//   segments is translated in rounds, each over the screen and ~2 screens after it
//   (`lazyWindow`); when a round is done and the reader has moved to blocks not translated yet,
//   the next round starts (`reach`). "Translate the rest" (`translateRest`) drops the window.
// - Cache (plan M3-E2, DESIGN §7): before a run, segments found in the translation cache are shown
//   as final and never sent; a cached brief seeds the run. What the run produces is stored as it
//   arrives (highest revision only; a failure removes the entry), so a retry, a reload or a revisit
//   re-runs only what is missing. `fresh` (retranslate) skips the lookup, never the store.
// - Retranslate page (M3 dogfood B2): each block keeps its earlier translation on screen until its
//   new final arrives; a block that fails, or one the run never reached (stop, cancel), keeps it,
//   and its cache entry is not dropped.
// - Best (`refine`, DESIGN.md §5.2–§5.3): the strategy is resolved once per run (`job.strategy`).
//   Drafts show as in Balanced; a block's reviewed revision replaces its draft with a "refined"
//   marker, the draft kept for "Show draft". Cache hits below the review revision, and Balanced's
//   entries on a miss, are shown at once as drafts and only reviewed. A review that is rejected,
//   skipped or cannot run leaves the draft: it never fails a block. In lazy mode, once a round's
//   drafts are done, the reader nearing the round's end drops its reviews not started.
// - Edits (the translation memory, src/shared/memory.ts): a block the user corrected shows the
//   correction, marked "edited", and is never sent again. Before a run, corrections of the same
//   source and target language are shown first, before the cache and even on a retranslate; the
//   engine's later events for such a block are ignored and it is never written to the cache.
//   Retranslate page keeps edited blocks; a block's Retranslate replaces its edit only when asked.
// - Pause on tab switch (decision S5 R1, M0 D14): only the active tab's job starts new model
//   requests. A background job's requests already streaming finish; the next one waits at the
//   gate until its tab is active again. Repairs and retries wait too, since they are requests.
import { BASIC_ID, BASIC_SWITCH_STAGE, CONTEXT_STAGE, DRAFTS_STAGE, REFINE_ID, REVIEWED_REVISION, basic, briefCacheKey, contextual, estimateTokens, createDefaultPromptRegistry, createEngine, decideRetry, explain, normalizeBrief, refine, singlePass, type DocumentBrief, type EngineEvent, type GlossaryEntry, type GlossMode, type StyleMode, type Segment, type StrategyId, type TranslationEngine, type TranslationJob, type RetryPolicy, type BasicSwitchInfo } from '@/engine/index';
import type { ReviewReport, SnippetRequest } from '@/engine/types';
import type { LLMClient, LLMError, LLMErrorKind, MTClient, NormalizedRequest } from '@/llm/types';
import type { OnDeviceEngine } from '@/llm/on-device';
import { needsActivation } from '@/llm/chrome-translator';
import { BEST_MODE_RELEASED } from '@/shared/quality';
import { keyScope, scopeHash, segmentKey, type CachedSegment, type TranslationCache } from '@/shared/cache';
import { cleanEditText, createMemorySnapshots, examplesFor, memoryKey, NO_ORIGIN, type MemoryEntry, type MemorySnapshots, type TranslationMemory } from '@/shared/memory';
import type { FeatureId } from '@/shared/features';
import { costUsd, formatUsd, type UsageTotals } from '@/shared/cost';
import type { Detection } from '@/shared/language';
import { entryId, MEMORY_IDS_LOGGED, type JobRecord } from '@/shared/diagnostics';
import { i18n } from '#i18n';
import { uiError } from './status.ts';
import { VOICE_PREP_SPEND_ID, type LimitReached, type SpendDelta } from '@/shared/spend';
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
  /**
   * The final came from the `basic` strategy (Chrome's Translator, plan M5-E7): every provider was
   * down. The block is labeled "basic translation" and the text is never cached, so the next run
   * asks the model again.
   */
  basic?: true;
  /**
   * The block's "Explain this" note (plan M5-E8): asked for on a finished block, shown under it.
   * Not part of the translation: it is never cached, and a Retranslate drops it with the old text.
   */
  explain?: { status: 'loading' | 'ready' | 'failed'; text?: string; error?: LLMError };
  /**
   * Best (`refine`): the shown final is the review's revision (DESIGN.md §5.2: the panel replaces
   * the text and marks it "refined"). From this run's review, `draft` is the text it replaced and
   * `reviewModel` the model that reviewed it (for "Show draft"); from the cache, neither.
   */
  refined?: true;
  draft?: string;
  reviewModel?: string;
  /**
   * The text is a correction from the translation memory, shown in place of the translation and
   * never sent: the user's own (`user`, "edited") or an imported one they chose to apply
   * (`import`). The engine's events for the block are ignored, and it is never cached.
   */
  edited?: MemoryEntry['by'];
  /** The user's edit could not be stored in the memory: it shows in this session only. */
  editUnsaved?: true;
}

/** The engine's review stage id (`producedBy.stage` of a review's final). */
const REVIEW_STAGE = 'review';

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
  /**
   * A Retranslate page that ended (done, stopped, cancelled) left this many blocks on their
   * earlier translation (M3 dogfood B2): they failed or were never reached. Retry redoes them.
   */
  kept?: number;
  /** A Retranslate page left this many edited blocks as the user corrected them. */
  editsKept?: number;
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
  fallback?: { from: string; to: string; error: LLMError; basic?: true; recovered?: true };
  /** The page is under a local-only site rule (its pattern): a stop says why nothing fell back to the cloud (M4-D tester O1). */
  localOnly?: string;
  /** Best asked for, but the review route cannot run (no key, no access…): this run goes on as Balanced, and says why. */
  reviewUnavailable?: LLMError;
  /**
   * Blocks failed because Chrome's Translator needs the reader's click for their pair first (a
   * second language on a mixed page, found mid-run): the first such pair, for its turn-on button.
   */
  onDeviceSetup?: { engine: OnDeviceEngine; from: string; to: string };
  /**
   * The turn-on click's download for a pair (src/llm/on-device.ts prepareOnDevice): its progress,
   * 0 to 1, or why it failed. Absent when none runs; the job runs again once it is done.
   */
  onDeviceDownload?: { engine: OnDeviceEngine; from: string; to: string; loaded: number; error?: string };
  /** Epoch ms: when this run started, when its first text became visible, when it ended. */
  startedAt: number;
  firstVisibleAt?: number;
  /**
   * Epoch ms: when every block on screen (the latest viewport report) was final, with at least one
   * of them translated by this run (plan M3 §3 #1). A failed block is not done: a screen with one
   * never gets the stamp. Absent while some are pending, and when the run owed nothing on screen.
   */
  screenDoneAt?: number;
  endedAt?: number;
  /**
   * A long page runs in lazy mode (plan M5-E4): only the screen and a few after it are translated,
   * the rest as the reader gets there, or all at once with Translate the rest. `rest` is how many
   * translatable blocks are still untranslated (neither final nor failed); absent when none are.
   */
  lazy?: { rest: number };
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
 *
 * A final of `refine`'s review stage is marked `refined`, keeps the text it replaces as `draft`
 * and names its reviewer (`reviewModel`), not as the block's model: it is no fallback. A rejected
 * review sends nothing, so the draft stays.
 */
export function applySegmentEvent(cur: SegState | undefined, e: EngineEvent): SegState | undefined {
  // The user's correction stands: a late final, a review revision or a failure leaves it as it is.
  // An edit made before its block's review started does not cancel that review (it runs, and is
  // paid for): its revision is discarded here. An accepted gap; the review is one call per chunk.
  if (cur?.edited) return cur;
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
      if (e.producedBy.stage === REVIEW_STAGE) {
        const draft = cur?.status === 'final' ? cur.text : undefined;
        return { status: 'final', text: e.text, revision: e.revision, attempt, refined: true, ...(draft === undefined ? {} : { draft }), reviewModel: e.producedBy.model };
      }
      return { status: 'final', text: e.text, revision: e.revision, attempt, model: e.producedBy.model, ...(e.producedBy.strategy === BASIC_ID ? { basic: true as const } : {}) };
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
  /** The connection's preset (`openai`, `custom-openai`…), for the diagnostics log. */
  presetId?: string;
}

/** A fallback profile's client (§4.3.5 `Routing.fallback`, M4-E9), already filtered by the privacy rule. */
export interface FallbackLink {
  client: LLMClient;
  profile: ModelProfile;
  connection?: JobConnection;
  /** The link runs on the device (a stored Gemini Nano profile): kept when it stands in for a primary with no key. */
  onDevice?: OnDeviceEngine;
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
      /** The chain ends in the terminal `basic` entry (M5-E7): Chrome's Translator when every provider is down. */
      basic?: boolean;
      /** The local-only site rule (its pattern) that routed the page: no cloud link in `fallback` (§4.3.5). */
      localOnly?: string;
      /**
       * The route runs on this device (src/llm/on-device.ts): Gemini Nano (`single-pass`) or Chrome's
       * Translator (the `basic` strategy, `client` takes no prompt). The run has no analyze or review.
       */
      onDevice?: OnDeviceEngine;
      /**
       * Resolves the `analyze` role's client (the document brief); called only when the run will
       * make an analyze call. Undefined from it = the translate client serves it (§4.3.1).
       */
      analyze?: () => Promise<AnalyzeResult | undefined>;
      /** Resolves the `review` role's client (a `refine` run), likewise. */
      review?: () => Promise<AnalyzeResult | undefined>;
    }
  | { ok: false; error: LLMError; connection?: JobConnection };

/** What the route is resolved for (§4.3.5): the page's tab (its override) and URL (site rules). */
export interface ClientTarget {
  tabId: number;
  url: string;
  /** The page's languages: the on-device route needs the pair ('' = the page's language is not known). */
  sourceLang?: string;
  targetLang?: string;
  /** The run may make an analyze call (not single-pass, not a segment retry): give a resolver for that role too. */
  analyze?: boolean;
  /** The run reviews its drafts (`refine`): give a resolver for the `review` role too. */
  review?: boolean;
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
  const all = [profile, ...(job.analyzeProfile ? [job.analyzeProfile] : []), ...(job.reviewProfile ? [job.reviewProfile] : []), ...job.fallbackProfiles];
  const byId = event.client === undefined ? undefined : all.find((p) => p.id === event.client);
  if (byId) return byId;
  if (event.role === 'analyze' && job.analyzeProfile !== undefined && event.model === job.analyzeProfile.model) return job.analyzeProfile;
  if (event.role === 'review' && job.reviewProfile !== undefined && event.model === job.reviewProfile.model) return job.reviewProfile;
  if (event.model === profile.model) return profile;
  return job.fallbackProfiles.find((p) => p.model === event.model) ?? (event.role === 'analyze' && job.analyzeProfile ? job.analyzeProfile : profile);
}

/**
 * The first-run privacy notice (privacy.ts PrivacyGate, §8), as the jobs ask it: once the route is
 * resolved, a route that sends text off the device waits until the notice is acknowledged.
 */
export interface PrivacyPort {
  acknowledged(): boolean;
  /** Runs `run` once acknowledged (now if it is); a later call with the same key replaces a held one. */
  whenAcknowledged(key: string, run: () => void): void;
  forget(key: string): void;
}

export interface JobDeps {
  /** Resolves the `translate` role (§4.3.5) for a page: key, host permission, profile. Called once per run. */
  translateClient: (target: ClientTarget) => Promise<ClientResult>;
  /**
   * The privacy notice, checked on the route each run resolves (a key added meanwhile can't send
   * unasked). Absent: nothing waits (tests, the latency script).
   */
  privacy?: PrivacyPort;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** The engine's retry policy (default DEFAULT_RETRY_POLICY); the backoff and fallback notes follow the same one. */
  retry?: RetryPolicy;
  /** Test seam: the engine to run (default: single-pass, contextual and refine over the given clients). */
  engine?: (client: LLMClient, analyze?: LLMClient, fallback?: readonly LLMClient[], review?: LLMClient) => TranslationEngine;
  /**
   * The strategy every job runs, whatever its document asks for (the selection's `single-pass`,
   * tests, the latency script). Absent: the document's (`JobDoc.strategy`), else PANEL_STRATEGY.
   */
  strategy?: StrategyId;
  /**
   * Whether a paid feature is available, read once per job start (a cached answer, no network).
   * `best-mode` gates `refine` from every source: without it a job asked for it runs `contextual`.
   * `translation-memory` gates only the retrieval of similar corrections as examples: edits and the
   * exact reuse of an edit stay free. Absent: always available.
   */
  featureAvailable?: (id: FeatureId) => Promise<boolean>;
  /** "Use corrections from other sites" (a device setting, off by default), read once per job start. Absent: off. */
  acrossSites?: () => Promise<boolean>;
  /** The `basic` strategy's translator (Chrome's Translator, plan M5-E7). Absent: none, and a switch to basic says so. */
  mt?: MTClient | undefined;
  /** The translation cache (M3-E2). Absent: every run goes to the model. */
  cache?: TranslationCache | undefined;
  /** The translation memory: the user's corrections, shown before the cache. Absent: edits last for the session. */
  memory?: TranslationMemory | undefined;
  /**
   * Whether a local-only site rule covers `url` now (read at edit time, so a rule added after the
   * run, or a run whose route never resolved, still marks the edit). Absent: no rules.
   */
  siteLocalOnly?: (url: string) => Promise<boolean>;
  /** How long a run waits for the cache (and the memory) before it goes to the model without it (default 1500). */
  cacheTimeoutMs?: number;
  /** Every usage report, priced (the running total in settings, M3-E9), with the profile that spent it (M4-E10). */
  onSpend?: (delta: SpendDelta) => void;
  /**
   * A request was refused for its key (401, 403, or Google's 400 `API_KEY_INVALID`: `auth`) on this connection: settings mark it
   * `error` (§4.3.5). Not called for a missing key (nothing was sent).
   */
  onAuthError?: (connectionId: string, error: LLMError) => void;
  /**
   * The monthly soft limit (M4-E10), asked before a run sends its first request (after the cache:
   * a page that is all cached costs nothing): reached → the run stops and says so. Absent: none.
   */
  spendLimit?: () => Promise<LimitReached | undefined>;
  /** Lazy mode starts above this many translatable segments (default LAZY_SEGMENTS; Infinity: never). */
  lazyAbove?: number;
  /** Each run, when it starts and again when it ends, for the local diagnostics log (src/shared/diagnostics.ts). */
  onJobRecord?: ((record: JobRecord) => void) | undefined;
}

/**
 * Lazy mode (plan M5-E4, decision §5 "long-page threshold"): above this many translatable segments
 * a page is translated around the reader instead of whole. ~400 segments is a long article or a
 * full docs page (about 40–60k source tokens, 25+ requests); below it, translating everything
 * costs little and the reader sees the whole page done. The fixtures: fixtures/long/long-100-screens
 * has 767 segments (~87 screens at 800 px: the target page), large-table 121 rows × 5 cells; the
 * docs and article fixtures of fixtures/sites run 40–340 segments and stay whole.
 */
export const LAZY_SEGMENTS = 400;
/** How many screens after the one on screen a round covers. */
export const LAZY_AHEAD_SCREENS = 2;
/** The least a round covers after the screen, when the screen holds few blocks (one tall block, no report yet). */
export const LAZY_MIN_AHEAD = 24;
/**
 * A round covers at least this much source text (two chunks of 1,500 tokens), so the profile's two
 * request slots both get a chunk; and the next round starts only when the reader gets within
 * `LAZY_LOW_WATER` of the end of what is translated (a screen, 8 blocks at least), so rounds are
 * big rather than one screen at a time.
 */
export const LAZY_MIN_TOKENS = 3000;
/** On-screen blocks further apart than this (in page order) belong to different clusters (see `lazyWindow`). */
export const LAZY_CLUSTER_GAP = 12;
export const LAZY_LOW_WATER = { screens: 1, minAhead: 8, minTokens: 0 } as const;

/**
 * The ids a lazy round covers: the segments on screen and `LAZY_AHEAD_SCREENS` screens after them
 * (a screen's size is the number of blocks on it). With no screen reported yet, from the top.
 */
export function lazyWindow(translatable: readonly Segment[], screen: readonly string[], reach: { screens?: number; minAhead?: number; minTokens?: number } = {}, pinned: readonly string[] = []): Set<string> {
  const { screens = LAZY_AHEAD_SCREENS, minAhead = LAZY_MIN_AHEAD, minTokens = LAZY_MIN_TOKENS } = reach;
  const fixed = new Set(pinned);
  const onScreen = new Set(screen.filter((id) => !fixed.has(id)));
  // A fixed or sticky element (header, TOC, cookie bar) is on screen from anywhere on the page: the
  // on-screen blocks form clusters in page order, and the reader's is the biggest one (the last of
  // equals). The window reaches ahead of that cluster only; the others count for what is on screen.
  const clusters: { lo: number; hi: number; n: number }[] = [];
  translatable.forEach((s, i) => {
    if (!onScreen.has(s.id)) return;
    const c = clusters[clusters.length - 1];
    if (c !== undefined && i - c.hi <= LAZY_CLUSTER_GAP) {
      c.hi = i;
      c.n++;
    } else clusters.push({ lo: i, hi: i, n: 1 });
  });
  let main = clusters[0];
  for (const c of clusters) if (main === undefined || c.n >= main.n) main = c;
  let lo = main?.lo ?? 0;
  const hi = main?.hi ?? -1;
  const others = translatable.filter((s, i) => fixed.has(s.id) || (onScreen.has(s.id) && main !== undefined && (i < main.lo || i > main.hi))).map((s) => s.id);
  const size = hi < lo ? 0 : hi - lo + 1;
  let end = Math.min(translatable.length - 1, Math.max(hi, lo) + Math.max(minAhead, Math.ceil(size * screens)));
  // Enough text for every request slot to get a chunk (two chunks of the profile's size): short blocks on a long page.
  let tokens = 0;
  for (let i = lo; i <= end; i++) tokens += estimateTokens(translatable[i]?.inlineMarkup ?? '');
  while (tokens < minTokens && end < translatable.length - 1) tokens += estimateTokens(translatable[++end]?.inlineMarkup ?? '');
  // A table row is one chunk (criterion M5-E5): the window takes whole rows at both edges.
  const row = (i: number) => translatable[i]?.groupId;
  while (lo > 0 && row(lo) !== undefined && row(lo - 1) === row(lo)) lo--;
  while (end < translatable.length - 1 && row(end) !== undefined && row(end + 1) === row(end)) end++;
  return new Set([...translatable.slice(lo, end + 1).map((s) => s.id), ...others]);
}

/** What a run stopped by the soft limit shows as its error. */
export const limitError = (l: LimitReached): LLMError => uiError('unknown', `This month's spend (${formatUsd(l.monthUsd)}) reached your soft limit of ${formatUsd(l.limitUsd)}`, 'limit', [formatUsd(l.monthUsd), formatUsd(l.limitUsd)]);

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
  /**
   * Mixed content (plan M5-E5, the preferences): captions off keep figure and table captions as
   * they are; alt text off leaves image descriptions out of the page altogether. Absent: captions on, alt text off.
   */
  media?: { captions: boolean; altText: boolean };
  /** The strategy asked for (the quality mode or its override); absent = PANEL_STRATEGY. `Jobs.start` decides what runs. */
  strategy?: StrategyId;
  /** Best: a refined revision of a block on screen waits until the block leaves the screen. */
  keepDraftsOnScreen?: boolean;
}

interface Job {
  /** The run is on the device (ClientResult.onDevice): its finals are cached, a basic one included. */
  onDevice?: OnDeviceEngine;
  /**
   * The strategy this run runs, resolved once at its start (JobDeps.strategy, else the document's,
   * else PANEL_STRATEGY; `refine` without `best-mode`, or without a review route, is `contextual`).
   */
  strategy: StrategyId;
  /** Best: the run's drafts are all done (the engine's `drafts` stage); only reviews are left. */
  draftsDone?: boolean;
  /** Best: whether review calls may still start (TranslationJob.reviewWanted); a lazy round turns it off. */
  reviewWanted: boolean;
  /**
   * Best with keepDraftsOnScreen: the refined state of a block on screen (`next`), shown once the
   * block leaves the screen, unless the text it would replace (`over`) was replaced meanwhile.
   */
  held: Map<string, { next: SegState; over: SegState | undefined }>;
  /** The review role's own profile, when routing sends it elsewhere than translate (its usage is priced with it). */
  reviewProfile?: ModelProfile;
  /** Best: the model the review runs on (in the cache scope). */
  reviewModel?: string;
  /** `strategy` is the one asked for: the best-mode answer has not come yet. */
  unsettled?: boolean;
  /**
   * Best: blocks whose review ran or was given up (budget, a failed call) in this run or the runs it
   * resumes; the others (dropped as the reader moved on, never reached) are still drafts to review.
   */
  reviewTried: Set<string>;
  /** Best: the blocks this run sent for review, and those a chunk report covered (diagnostics). */
  reviewScope?: ReadonlySet<string>;
  reported?: Set<string>;
  /** Cache keys this run stored a refined text under: a twin block left as drafted does not replace it. */
  refinedKeys: Set<string>;
  /**
   * Best in lazy mode: `reach` started the next round for drafts to review only (`forDrafts`); one
   * such round that ends without any review tried (it found nothing to send, or every review was
   * dropped before it started) keeps the next `reach` from starting another for drafts
   * (`noDrafts`), so rounds never follow each other for nothing.
   */
  forDrafts?: boolean;
  noDrafts?: boolean;
  /** This run is such a round (`forDrafts` of the run it resumes). */
  draftsRound?: boolean;
  /** Best: a review of this run ran or was given up (not only dropped). */
  reviewedAny?: boolean;
  /**
   * What the soft limit stopped (M4-E10): "Continue anyway" carries it out, whether a run (with
   * its own options: a Retranslate page skips the cache) or one block's redo.
   */
  afterLimit?: () => Promise<void>;
  /** Lazy mode is on for this job (a long page, Translate the rest not pressed): rounds over the reader's window. */
  lazy: boolean;
  /** Translate the rest was pressed while a round ran: it follows that round. */
  wantRest?: boolean;
  /** The translatable segments of the page (lazy mode asks on every viewport report). */
  translatable?: readonly Segment[];
  /** The reader left the round's window: chunks not started were cut again over this window (engine `within`). */
  within?: ReadonlySet<string>;
  /** The ids this lazy round covered (its window). */
  round?: ReadonlySet<string>;
  /** Lazy mode was switched off by Translate the rest; kept by a resume. */
  all: boolean;
  /** The last round ended with blocks of its window still pending (budget, skips): no more rounds until the reader asks. */
  stalled?: boolean;
  /**
   * A run of this page in this tab was routed under a local-only site rule: an edit made here is
   * marked local-only (kept across runs, so an edit between runs is never under-marked).
   */
  localOnly: boolean;
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
  /** Segments this run had to translate at its start (view.screenDoneAt counts a screen with one). */
  owed: ReadonlySet<string>;
  /**
   * Bumped by refocus (M3 dogfood B5): the engine cuts the chunks not started yet again around the
   * screen (TranslationJob.focus). `cutAround` is the screen they were last cut around.
   */
  focus: number;
  cutAround: readonly string[];
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
  /**
   * A Retranslate page on a lazy page, carried through its later rounds and a Translate the rest after it: a window the reader reaches
   * later holds no earlier finals, yet must be retranslated too, not served from the cache.
   */
  redo?: boolean;
  /**
   * A retranslate run's earlier finals, by segment, until a new final replaces them (M3 dogfood
   * B2): shown meanwhile, put back when the block fails or the run ends without it, and their
   * cache entries are never dropped. What is left when the run ends is still owed: a resume
   * retranslates it again.
   */
  earlier: Map<string, SegState>;
  /**
   * The basic note came from the run this one resumes and this run has not switched itself (M5-E7):
   * every request of this run started after that switch, so a model's final means a provider is
   * back. Within a run that switched, only the engine's `done` + `recovered` says so (a chunk that
   * was streaming when it switched still finishes on the model).
   */
  basicCarried?: boolean;
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
  /** What this run's diagnostics record counts as it goes (`onJobRecord`). */
  log: { id: string; promptIds: Set<string>; chunks: Set<number>; calls: number; tokens: UsageTotals; review?: NonNullable<JobRecord['review']>; memory?: { hits: number; ids: Set<string> } };
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
  private readonly viewports = new Map<number, { docId: string; ids: readonly string[]; fixed: readonly string[] }>();
  private readonly listeners = new Set<JobsListener>();
  private activeTabId: number | undefined;
  private readonly now: () => number;

  /** The memory's entries per target language, kept for the life of the panel and read again only when the store changed. */
  private readonly snapshots: MemorySnapshots | undefined;
  /** Memory writes (edits, discarded edits), one at a time and in the order they were asked. */
  private memoryWrites: Promise<void> = Promise.resolve();

  constructor(private readonly deps: JobDeps) {
    this.now = deps.now ?? Date.now;
    this.snapshots = deps.memory ? createMemorySnapshots(deps.memory) : undefined;
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
  setViewport(tabId: number, docId: string, ids: readonly string[], fixed: readonly string[] = []): void {
    if (ids.length === 0 && this.viewports.get(tabId)?.docId === docId) return;
    this.viewports.set(tabId, { docId, ids: [...ids], fixed: [...fixed] });
    // Scrolled onto blocks already done: the screen the reader sees is translated now.
    const job = this.jobs.get(tabId);
    if (job?.docId === docId && job.view.status === 'running') {
      const patch: Partial<JobView> = {};
      this.screenDone(tabId, job, patch);
      if (patch.screenDoneAt !== undefined) this.patch(tabId, job, patch);
    } else if (job?.docId === docId && job.lazy) {
      this.reach(tabId, job);
    }
    if (job?.docId === docId && job.held.size > 0 && this.release(job, new Set(this.screenOf(tabId, docId)))) this.patch(tabId, job, { counts: count(job.segs) });
    if (job?.docId === docId && job.lazy && job.view.status === 'running' && ids.length > 0) {
      this.dropReviews(tabId, job);
      this.leave(tabId, job);
    }
  }

  /**
   * Shows the held refined revisions of blocks not in `screen` (keepDraftsOnScreen), unless the
   * block's text changed meanwhile (a Retranslate). Returns whether any was shown.
   */
  private release(job: Job, screen: ReadonlySet<string>): boolean {
    let shown = false;
    for (const [id, { next, over }] of job.held) {
      if (screen.has(id)) continue;
      job.held.delete(id);
      const now = job.segs.get(id);
      if (now?.status !== 'final' || now.edited || now.text !== over?.text) continue;
      job.segs.set(id, next);
      shown = true;
    }
    return shown;
  }

  /**
   * Best in lazy mode: once the round's drafts are done, a reader who nears the round's end (the
   * low-water mark that starts the next round) or leaves its window no longer waits for its
   * reviews. Those not started are dropped (their blocks stay drafts, reviewed on a later visit),
   * so the round ends with the calls in flight and the next one starts at the reader.
   */
  private dropReviews(tabId: number, job: Job): void {
    const current = job.within ?? job.round;
    if (!job.lazy || job.strategy !== REFINE_ID || !job.draftsDone || !job.reviewWanted || current === undefined) return;
    const translatable = (job.translatable ??= job.view.segments.filter((s) => s.translate));
    const pinned = this.pinnedOf(tabId, job.docId);
    const screen = this.screenOf(tabId, job.docId);
    // The reader's own translatable blocks: a screen of code, or of text kept as it is, says
    // nothing about where the reader is in the round.
    const own = screen.filter((id) => !pinned.includes(id) && job.segs.has(id));
    if (own.length === 0) return;
    const left = !own.some((id) => current.has(id));
    const near = lazyWindow(translatable, screen, LAZY_LOW_WATER, pinned);
    if (left || [...near].some((id) => job.segs.get(id)?.status === 'pending')) job.reviewWanted = false;
  }

  /**
   * The reader asked again (Alt+T, the toolbar icon) on a page whose job is running (M3 dogfood B5):
   * from another screen than the one the job's chunks were cut around, the chunks not started yet
   * are cut again around the screen now, so it goes next as a chunk of its own. Requests in flight
   * are never aborted (M3-D3). The same screen, or no job running for this document: nothing.
   * Returns whether it re-cut.
   */
  refocus(tabId: number, docId: string): boolean {
    const job = this.jobs.get(tabId);
    if (job?.docId !== docId || job.view.status !== 'running') return false;
    const screen = this.screenOf(tabId, docId);
    const before = new Set(job.cutAround);
    if (screen.length === 0 || (screen.length === before.size && screen.every((id) => before.has(id)))) return false;
    job.cutAround = screen;
    job.focus++;
    return true;
  }

  /**
   * Stamps `screenDoneAt` into `patch` the first time every translatable block on screen now is
   * final (not failed, not a retranslate that failed back to its earlier text) and the run owed one
   * of them (M3 dogfood B4: the screen at the start, or failures, made the stamp too early).
   */
  private screenDone(tabId: number, job: Job, patch: Partial<JobView>): void {
    if (job.view.screenDoneAt !== undefined || patch.screenDoneAt !== undefined) return;
    const ids = this.screenOf(tabId, job.docId).filter((id) => job.segs.has(id));
    if (!ids.some((id) => job.owed.has(id))) return;
    const done = ids.every((id) => {
      const s = job.segs.get(id);
      return s?.status === 'final' && s.redoError === undefined;
    });
    if (done) patch.screenDoneAt = this.now();
  }

  /** The segment ids on screen in the tab's document, as last reported. */
  private screenOf(tabId: number, docId: string): readonly string[] {
    const v = this.viewports.get(tabId);
    return v?.docId === docId ? [...v.ids, ...v.fixed] : [];
  }

  /** The ones of them in a fixed or sticky box (the content script flags them by computed position). */
  private pinnedOf(tabId: number, docId: string): readonly string[] {
    const v = this.viewports.get(tabId);
    return v?.docId === docId ? v.fixed : [];
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
  async start(tabId: number, docId: string, doc: JobDoc, options: { resume?: boolean; keepCost?: boolean; keepBrief?: boolean; fresh?: boolean; all?: boolean } = {}): Promise<void> {
    const { resume = false, keepCost = false, keepBrief = false, fresh = false } = options;
    // The one async read of the strategy, awaited with the route below: the job is set up (and a
    // running one replaced) at once, as for any run; nothing reads `job.strategy` before it is settled.
    const asked = this.deps.strategy ?? doc.strategy ?? PANEL_STRATEGY;
    // A build that does not release Best runs Balanced for a refine request, whatever its source.
    const requested = asked === REFINE_ID && !BEST_MODE_RELEASED ? contextual.id : asked;
    const access = requested === REFINE_ID ? this.bestMode() : undefined;
    const unsettled = access !== undefined;
    const prev = this.jobs.get(tabId);
    const keep = resume && prev?.docId === docId && prev.view.status !== 'running' ? prev : undefined;
    const all = options.all ?? keep?.all ?? false;
    const costFrom = keep ?? (keepCost && prev?.docId === docId ? prev : undefined);
    const brief = keep?.view.brief ?? (keepBrief && prev?.docId === docId && prev.view.targetLang === doc.targetLang ? prev.view.brief : undefined);
    // A replaced run's requests in flight end without usage; they are this page's spend too.
    const abandoned = costFrom && costFrom.view.status === 'running' ? costFrom.inflight : 0;
    if (prev?.view.status === 'running') {
      this.record(prev, 'replaced');
      prev.controller.abort(new DOMException('replaced', 'AbortError'));
    }
    if (prev) this.stopRetries(prev);

    // Segments already in the target language (per-segment detection) are shown as is, like code.
    const kept = doc.keep?.size ? doc.segments.map((s) => (s.translate && doc.keep?.has(s.id) ? { ...s, translate: false } : s)) : doc.segments;
    const segments = withMedia(kept, doc.media);
    const translatable = segments.filter((s) => s.translate);
    const segs = new Map<string, SegState>();
    const earlier = new Map<string, SegState>();
    // A retranslate keeps the page's translation on screen until each block's new one arrives;
    // so does a resume of a retranslate that stopped, for the blocks it still owes.
    const before = fresh && prev?.docId === docId ? prev : undefined;
    // Lazy mode (M5-E4): a Retranslate page redoes the window; the blocks outside it go back to waiting,
    // not left on the old translation as if current.
    const lazy = !all && translatable.length > (this.deps.lazyAbove ?? LAZY_SEGMENTS);
    const around = lazy && before !== undefined ? lazyWindow(translatable, this.screenOf(tabId, docId), {}, this.pinnedOf(tabId, docId)) : undefined;
    for (const s of translatable) {
      const old = keep?.segs.get(s.id) ?? before?.segs.get(s.id);
      // An edited block stays as the user corrected it, a Retranslate page included; not after a
      // change of target language (the memory has that language's own corrections, if any).
      const sameLang = (keep ?? before)?.doc.targetLang === doc.targetLang;
      if (old?.status === 'final' && old.edited && sameLang) {
        segs.set(s.id, old);
        continue;
      }
      const owed = before !== undefined && (keep === undefined || keep.earlier.has(s.id)) && (around === undefined || around.has(s.id));
      // Started while another retranslate runs: a block it had not redone yet (pending or
      // streaming) still owes its earlier translation, which that run holds.
      const prior = old?.status === 'final' ? old : before?.earlier.get(s.id);
      if (owed && prior?.text !== undefined) {
        const shown = { ...prior };
        delete shown.redoError;
        delete shown.error;
        delete shown.edited;
        delete shown.editUnsaved;
        earlier.set(s.id, shown);
        segs.set(s.id, { status: 'pending', text: prior.text });
      } else segs.set(s.id, old?.status === 'final' && keep ? old : { status: 'pending' });
    }
    const todo = new Set(translatable.filter((s) => segs.get(s.id)?.status !== 'final').map((s) => s.id));
    const gate = new Gate();
    gate.set(tabId === this.activeTabId);
    const job: Job = {
      strategy: requested,
      ...(unsettled ? { unsettled } : {}),
      reviewWanted: true,
      held: new Map(),
      reviewTried: new Set(keep?.reviewTried),
      refinedKeys: new Set(),
      lazy,
      all,
      localOnly: prev?.docId === docId && prev.localOnly,
      docId,
      doc,
      segs,
      controller: new AbortController(),
      gate,
      inflight: 0,
      run: (prev?.run ?? 0) + 1,
      owed: new Set(todo),
      focus: 0,
      cutAround: this.screenOf(tabId, docId),
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
      log: { id: entryId(this.now()), promptIds: new Set(), chunks: new Set(), calls: 0, tokens: { input: 0, cachedInput: 0, output: 0 } },
      replaceKeys: new Set(),
      earlier,
      ...(keep?.view.fallback?.basic ? { basicCarried: true } : {}),
      apart: costFrom ? { usage: { ...costFrom.apart.usage }, usd: costFrom.apart.usd } : { usage: { input: 0, cachedInput: 0, output: 0 }, usd: undefined },
      fresh,
      ...((lazy && before !== undefined) || (resume && prev?.docId === docId && prev.redo) ? { redo: true } : {}),
      ...(keep?.forDrafts ? { draftsRound: true } : {}),
      view: {
        ...(lazy && todo.size > 0 ? { lazy: { rest: todo.size } } : {}),
        status: 'running',
        paused: !gate.open,
        model: keep?.view.model ?? '',
        targetLang: doc.targetLang,
        // A resumed run keeps its brief, and the brief's language when detection found none.
        sourceLang: doc.sourceLang || (brief?.language ?? ''),
        ...(doc.detection ? { detection: doc.detection } : {}),
        ...(brief ? { brief } : {}),
        // Chrome's Translator took over in the run this one resumes (a lazy round, Retry): its note
        // stays, so the reader learns when a model translates again, and what the “basic
        // translation” blocks still on the page are once it did (M5-D tester F2).
        ...(keep?.view.fallback?.basic ? { fallback: keep.view.fallback } : {}),
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
    if (access === undefined) this.record(job, 'started');

    const signal = job.controller.signal;
    // A refine request asks for the review resolver too; it is called only if the run stays refine.
    const target: ClientTarget = { tabId, url: doc.url, sourceLang: doc.sourceLang, targetLang: doc.targetLang, analyze: requested !== 'single-pass', ...(access ? { review: true } : {}) };
    const routing = this.deps.translateClient(target);
    // The translation-memory gate is read here, once for this run, together with the snapshot and
    // the setting, while the route resolves; all of it raced against the cache timeout, so a slow
    // store never delays the first request. A timeout or an error means no examples for this run.
    const featureAvailable = this.deps.featureAvailable ?? (() => Promise.resolve(true));
    const snapshots = this.snapshots;
    // Not for a single-pass run (a selection, a test): its prompt has no room for examples.
    const memoryAhead =
      snapshots === undefined || requested === 'single-pass'
        ? undefined
        : this.timed(
            (async () => {
              const [on, entries, acrossSites] = await Promise.all([featureAvailable('translation-memory').catch(() => false), snapshots.load(doc.targetLang), this.deps.acrossSites?.().catch(() => false) ?? false]);
              return { on, entries, acrossSites };
            })(),
          );
    if (access) {
      const allowed = await access;
      if (signal.aborted || this.jobs.get(tabId) !== job) {
        routing.catch(() => {});
        return;
      }
      if (!allowed) job.strategy = contextual.id;
      delete job.unsettled;
      this.record(job, 'started');
    }
    const resolved = await this.cleared(routing, () => this.deps.translateClient(target), `page:${tabId}`, signal);
    if (resolved === undefined || signal.aborted || this.jobs.get(tabId) !== job) return;
    if (resolved.connection) this.patch(tabId, job, { connection: resolved.connection });
    if (!resolved.ok) {
      this.finish(tabId, job, 'stopped', resolved.error);
      return;
    }
    const { client, profile } = resolved;
    // On the device the route decides the strategy, before the cache is read (its scope names it):
    // Gemini Nano translates single-pass, Chrome's Translator block by block; no brief, no review.
    if (resolved.onDevice) {
      job.onDevice = resolved.onDevice;
      job.strategy = resolved.onDevice === 'nano' ? singlePass.id : BASIC_ID;
    }
    const refining = job.strategy === REFINE_ID;
    if (resolved.localOnly !== undefined) {
      job.localOnly = true;
      this.patch(tabId, job, { localOnly: resolved.localOnly });
    }
    job.fallbackProfiles = resolved.fallback?.map((l) => l.profile) ?? [];
    this.patch(tabId, job, { model: client.model });
    // Best: the review route decides the cache scope (its model is in the key), so it is resolved
    // before the lookup, with the analyze route alongside (that one is used only if a brief is asked for).
    let review: AnalyzeResult | undefined;
    let analyzeAhead: Promise<AnalyzeResult | undefined> | undefined;
    if (refining) {
      analyzeAhead = resolved.analyze?.();
      // Used only if a brief is asked for; a run that never awaits it must not leave a rejection behind.
      analyzeAhead?.catch(() => {});
      review = resolved.review ? await resolved.review() : undefined;
      if (signal.aborted || this.jobs.get(tabId) !== job) return;
      if (review && !review.ok) {
        // Best never translates less than Balanced: without its reviewer the run is Balanced.
        job.strategy = contextual.id;
        this.patch(tabId, job, { reviewUnavailable: review.error });
        review = undefined;
      } else {
        job.reviewModel = review?.client.model ?? client.model;
        if (review) job.reviewProfile = review.profile;
      }
    }
    const drafts = new Map<string, { text: string; revision: number }>();
    await this.fromCache(tabId, job, { todo, translatable, model: client.model, fresh, drafts });
    if (signal.aborted || this.jobs.get(tabId) !== job) return;
    if (fresh) {
      let edited = 0;
      for (const s of translatable) if (segs.get(s.id)?.edited) edited++;
      if (edited > 0) this.patch(tabId, job, { editsKept: edited });
    }
    // Best: finals kept from an earlier run (a lazy round, a resume) that no review has looked at
    // yet are drafts too, so the reviews dropped or never reached are made where the run goes.
    if (job.strategy === REFINE_ID) {
      for (const s of translatable) {
        const state = segs.get(s.id);
        if (!drafts.has(s.id) && this.unreviewed(job, s.id, state)) drafts.set(s.id, { text: state.text, revision: state.revision ?? 1 });
      }
    }
    // Lazy mode: this round covers the screen and what follows it, the rest waits (M5-E4).
    if (job.lazy) {
      const window = lazyWindow(translatable, this.screenOf(tabId, docId), {}, this.pinnedOf(tabId, docId));
      for (const id of [...todo]) if (!window.has(id)) todo.delete(id);
      for (const id of [...drafts.keys()]) if (!window.has(id)) drafts.delete(id);
      job.round = window;
    }
    // The analyze call sees only the segments still to translate. A brief stored under the key of
    // the whole page must come from the whole page, so a run that skips any segment stores none.
    // A lazy round's analyze call reads the whole page (`briefFrom`), so its brief is stored.
    if (todo.size !== translatable.length && !job.lazy) job.briefKey = undefined;
    // Best: drafts from the cache are only reviewed; with none left either, nothing is sent.
    if (todo.size === 0 && drafts.size === 0) {
      this.finish(tabId, job, 'done');
      return;
    }
    // The soft limit warns before anything is sent (M4-E10); a run already going is never cut.
    const limit = await this.deps.spendLimit?.().catch(() => undefined);
    if (signal.aborted || this.jobs.get(tabId) !== job) return;
    if (limit) {
      // The same run again, its cost kept: a Retranslate page still skips the cache.
      job.afterLimit = () => this.start(tabId, docId, doc, { ...options, keepCost: true });
      this.patch(tabId, job, { limit });
      this.finish(tabId, job, 'stopped', limitError(limit));
      return;
    }
    // The analyze role is resolved only when the brief will be asked for: a kept or cached brief
    // means no analyze call, so its route must not stop the run.
    const analyze = resolved.analyze && !job.view.brief && !job.onDevice ? await (analyzeAhead ?? resolved.analyze()) : undefined;
    if (signal.aborted || this.jobs.get(tabId) !== job) return;
    if (analyze && !analyze.ok) {
      if (analyze.connection) this.patch(tabId, job, { connection: analyze.connection });
      this.finish(tabId, job, 'stopped', analyze.error);
      return;
    }
    if (analyze) job.analyzeProfile = analyze.profile;
    const engine = this.engineFor(tabId, job, { client, profile, ...(resolved.connection ? { connection: resolved.connection } : {}) }, undefined, analyze, resolved.fallback, review?.ok ? review : undefined);
    if (job.strategy === REFINE_ID) job.reviewScope = new Set([...todo, ...drafts.keys()]);
    // The sending rules (src/shared/memory.ts examplesFor): the route decides what may leave the device.
    const looked = await memoryAhead;
    if (signal.aborted || this.jobs.get(tabId) !== job) return;
    const examples = looked?.on && !job.onDevice ? examplesFor(looked.entries, { origin: originOf(doc.url), localOnly: resolved.localOnly !== undefined, acrossSites: looked.acrossSites }) : undefined;
    const engineJob: TranslationJob = {
      doc: {
        url: doc.url,
        title: doc.title,
        sourceLang: doc.sourceLang,
        targetLang: doc.targetLang,
        outline: segments.filter((s) => s.kind === 'heading').map((s) => s.text),
        // Already-final segments are not sent again (resume). Code blocks ride along; the engine skips them.
        // Best: drafts from the cache go too, to be reviewed (not drafted again).
        segments: segments.filter((s) => !s.translate || todo.has(s.id) || drafts.has(s.id)),
      },
      // Viewport first (M3-E1): what is on screen now, read again each time a chunk starts.
      priority: [...this.screenOf(tabId, docId)],
      livePriority: () => this.screenOf(tabId, docId),
      focus: () => job.focus,
      within: () => job.within,
      ...(job.lazy ? { briefFrom: segments } : {}),
      ...(job.strategy === REFINE_ID ? { reviewWanted: () => job.reviewWanted, ...(drafts.size > 0 ? { drafts } : {}) } : {}),
      strategy: job.strategy,
      options: {
        style: doc.style ?? 'natural',
        ...(doc.gloss ? { gloss: doc.gloss } : {}),
        glossary: [...(doc.glossary ?? [])],
        ...(doc.budgetTokens ? { budget: { maxTokens: doc.budgetTokens } } : {}),
        maxConcurrency: profile.maxConcurrency,
        chunkTokens: profile.chunkTokens,
        // A resumed run keeps its brief: no second analyze call (and none made from the leftover segments only).
        ...(job.view.brief && !job.onDevice ? { brief: job.view.brief } : {}),
        // The chain ends in Chrome's Translator (M5-E7); on Gemini Nano, what Nano can't do goes there too.
        ...(resolved.basic ? { basicFallback: true, ...(job.onDevice === 'nano' ? { onDeviceSwitch: true } : {}) } : {}),
        ...(examples && examples.length > 0 ? { memory: examples } : {}),
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
    if (prev?.view.status === 'running') {
      this.record(prev, 'replaced');
      prev.controller.abort(new DOMException('replaced', 'AbortError'));
    }
    if (prev) this.stopRetries(prev);
    const segs = new Map<string, SegState>();
    const keepCost = prev?.docId === docId ? prev : undefined;
    const now = this.now();
    const job: Job = {
      // Nothing runs, so the gate is not read: Best counts as Balanced here (a resume runs `start`).
      strategy: ((s) => (s === REFINE_ID ? contextual.id : s))(this.deps.strategy ?? doc.strategy ?? PANEL_STRATEGY),
      reviewWanted: true,
      held: new Map(),
      reviewTried: new Set(),
      refinedKeys: new Set(),
      lazy: false,
      all: false,
      localOnly: prev?.docId === docId && prev.localOnly,
      docId,
      doc,
      segs,
      controller: new AbortController(),
      gate: new Gate(),
      inflight: 0,
      run: (prev?.run ?? 0) + 1,
      owed: new Set(),
      focus: 0,
      cutAround: [],
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
      log: { id: entryId(this.now()), promptIds: new Set(), chunks: new Set(), calls: 0, tokens: { input: 0, cachedInput: 0, output: 0 } },
      replaceKeys: new Set(),
      earlier: new Map(),
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

  /**
   * "Continue anyway" (M4-E10): what the limit stopped, to run now that it no longer applies, or
   * undefined when nothing waits on it. The limit leaves the view.
   */
  takeAfterLimit(tabId: number): (() => Promise<void>) | undefined {
    const job = this.jobs.get(tabId);
    if (!job?.view.limit) return undefined;
    const next = job.afterLimit;
    delete job.afterLimit;
    const view = { ...job.view };
    delete view.limit;
    job.view = view;
    this.emit(tabId, job.view);
    return next;
  }

  /** "Continue anyway" past the soft limit failed (its setting could not be saved): the stopped bar says so. */
  limitFailed(tabId: number, message: string): void {
    const job = this.jobs.get(tabId);
    if (!job?.view.limit) return;
    this.patch(tabId, job, { limit: { ...job.view.limit, failed: message } });
  }

  /**
   * The turn-on click's download for the tab's job (JobView.onDeviceDownload); undefined clears it.
   * `ready`: the pair is set up, so its turn-on prompt (JobView.onDeviceSetup) goes too.
   */
  onDeviceDownload(tabId: number, download: JobView['onDeviceDownload'], ready = false): void {
    const job = this.jobs.get(tabId);
    if (!job) return;
    if (download) return this.patch(tabId, job, { onDeviceDownload: download });
    if (!job.view.onDeviceDownload && !(ready && job.view.onDeviceSetup)) return;
    const view = { ...job.view };
    delete view.onDeviceDownload;
    if (ready) delete view.onDeviceSetup;
    job.view = view;
    this.emit(tabId, view);
  }

  /** Translates what the tab's job left (cancelled, failed or stopped segments) for the same document. */
  resume(tabId: number): Promise<void> {
    const job = this.jobs.get(tabId);
    if (!job || job.view.status === 'running') return Promise.resolve();
    // A retranslate that ended early goes on retranslating what it still owes, not from the
    // cache: the blocks that kept their earlier translation (failed or never reached) are redone,
    // on purpose, since the user asked for them to be retranslated (the bar's note says so).
    return this.start(tabId, job.docId, job.doc, { resume: true, ...(job.earlier.size || job.redo ? { fresh: true, keepCost: true } : {}) });
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

  /**
   * The user's correction of a finished block: shown at once, marked "edited", and saved in the
   * translation memory with where it was made (the page origin, and whether the page runs under a
   * local-only site rule). From then on the engine's events for the block are ignored, and later
   * runs show it instead of translating the block. A block's own request (an Explain) is aborted.
   * A save that fails leaves the edit on screen for this session and says so.
   */
  async edit(tabId: number, id: string, text: string): Promise<void> {
    const job = this.jobs.get(tabId);
    const cur = job?.segs.get(id);
    const segment = job?.view.segments.find((s) => s.id === id);
    const target = cleanEditText(text);
    if (!job || !segment || cur?.status !== 'final' || target === '') return;
    job.retrying.get(id)?.abort(new DOMException('edited', 'AbortError'));
    job.retrying.delete(id);
    // A held review revision and a retranslate's earlier text are both replaced by the edit.
    job.held.delete(id);
    job.earlier.delete(id);
    const next: SegState = { status: 'final', text: target, revision: cur.revision ?? 1, attempt: cur.attempt ?? 1, edited: 'user' };
    job.segs.set(id, next);
    this.patch(tabId, job, { counts: count(job.segs) });
    let saved: boolean;
    try {
      // Queued behind the other memory writes, and skipped when the block no longer shows this
      // edit (a later save of it, or a Retranslate that discarded it): an older text never lands
      // after a newer one, and a discard is never undone by a save that was still waiting.
      saved = await this.queueMemory(async () => {
        if (job.segs.get(id) !== next) return true;
        // The site rule as it stands now counts too; a rule that cannot be read counts as local-only.
        const ruled = this.deps.siteLocalOnly ? await this.deps.siteLocalOnly(job.doc.url).catch(() => true) : false;
        if (job.segs.get(id) !== next) return true;
        await this.deps.memory?.put({
          source: segment.inlineMarkup || segment.text,
          target,
          sourceLang: job.view.sourceLang,
          targetLang: job.doc.targetLang,
          origin: originOf(job.doc.url) ?? NO_ORIGIN,
          localOnly: ruled || job.localOnly || job.view.localOnly !== undefined,
        });
        return this.deps.memory !== undefined;
      });
    } catch {
      saved = false;
    }
    if (saved || this.jobs.get(tabId) !== job || job.segs.get(id) !== next) return;
    job.segs.set(id, { ...next, editUnsaved: true });
    this.patch(tabId, job, {});
  }

  /**
   * The user's corrections found in the memory are read in advance for `targetLang`, so a run's
   * first request does not wait for the store. Never throws; a store that is slow or broken only
   * means the run itself reads it (and gives up at the cache timeout).
   */
  warmMemory(targetLang: string): Promise<void> {
    return this.snapshots?.load(targetLang).then(
      () => undefined,
      () => undefined,
    ) ?? Promise.resolve();
  }

  /**
   * Counts the corrections a chunk's prompt used, by their hashed ids: never text. The translate
   * and revise passes report them; a chunk's repair call in the check stage reuses the prompt and
   * is not counted again, so `hits` counts prompts built, not requests sent.
   */
  private logMemory(job: Job, info: unknown): void {
    const refs = (info as { memory?: unknown } | undefined)?.memory;
    if (!Array.isArray(refs)) return;
    const log = (job.log.memory ??= { hits: 0, ids: new Set() });
    for (const ref of refs as { id?: unknown }[]) {
      if (typeof ref?.id !== 'string') continue;
      log.hits++;
      log.ids.add(ref.id);
    }
  }

  /** Runs `task` after the earlier memory writes, whatever their outcome; its result or error is the caller's. */
  private queueMemory<T>(task: () => Promise<T>): Promise<T> {
    const run = this.memoryWrites.then(task);
    this.memoryWrites = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Retranslate on an edited block, once the user confirmed it: the block is translated again
   * and, when its new final arrives, the correction is deleted from the memory. A retranslate that
   * fails (or a memory that cannot delete) keeps the edit, on screen and in the memory.
   */
  discardEdit(tabId: number, id: string): Promise<void> {
    return this.jobs.get(tabId)?.segs.get(id)?.edited ? this.redoSegment(tabId, id, 'retranslate', true) : Promise.resolve();
  }

  /**
   * A short note on the idioms and cultural references of one finished block (its "Explain this",
   * plan M5-E8): one request through the engine's snippet path with the `explain` strategy, on the
   * job's translate route (so a local-only site stays local). The note streams into the block's
   * `explain`; the translation is never touched, and a failure only fails the note. Cancel and a
   * navigation abort it.
   */
  async explainSegment(tabId: number, id: string): Promise<void> {
    const job = this.jobs.get(tabId);
    const before = job?.segs.get(id);
    const segment = job?.view.segments.find((s) => s.id === id);
    if (!job || !segment || before?.status !== 'final' || before.explain?.status === 'loading' || job.retrying.has(id)) return;
    const controller = new AbortController();
    const { signal } = controller;
    job.retrying.set(id, controller);
    const set = (explain: SegState['explain']) => {
      if (this.jobs.get(tabId) !== job) return;
      const cur = job.segs.get(id);
      if (cur?.status !== 'final') return;
      const next: SegState = { ...cur };
      if (explain) next.explain = explain;
      else delete next.explain;
      job.segs.set(id, next);
      this.patch(tabId, job, {});
    };
    set({ status: 'loading' });
    try {
      const route = () => this.deps.translateClient({ tabId, url: job.doc.url, sourceLang: job.doc.sourceLang, targetLang: job.doc.targetLang });
      const resolved = await this.cleared(route(), route, `explain:${tabId}:${id}`, signal);
      if (resolved === undefined || signal.aborted) return set(undefined);
      const limit = await this.deps.spendLimit?.().catch(() => undefined);
      if (signal.aborted) return set(undefined);
      if (limit) {
        // The bar offers "Continue anyway", which asks for this note again (M4-E10).
        job.afterLimit = () => this.explainSegment(tabId, id);
        this.patch(tabId, job, { limit });
        return set({ status: 'failed', error: limitError(limit) });
      }
      if (!resolved.ok) return set({ status: 'failed', error: resolved.error });
      // Chrome's Translator takes text, not a question.
      if (resolved.onDevice === 'translator') return set({ status: 'failed', error: uiError('bad_request', 'Explain needs a language model', 'explainNeedsModel') });
      // Usage from a fallback link is priced with its own profile (as in redoSegment).
      job.fallbackProfiles = resolved.fallback?.map((l) => l.profile) ?? [];
      const { doc } = job;
      const request: SnippetRequest = {
        doc: { url: doc.url, title: doc.title, sourceLang: doc.sourceLang, targetLang: doc.targetLang, outline: [] },
        segments: [segment],
        strategy: explain.id,
        options: { style: doc.style ?? 'natural', glossary: [], maxConcurrency: 1, chunkTokens: resolved.profile.chunkTokens },
      };
      const primary = { client: resolved.client, profile: resolved.profile, ...(resolved.connection ? { connection: resolved.connection } : {}) };
      let outcome: SegState['explain'];
      for await (const event of this.engineFor(tabId, job, primary, -2 - ++job.retrySeq, undefined, resolved.fallback).translateSnippet(request, signal)) {
        if (this.jobs.get(tabId) !== job) return;
        if (event.type === 'usage') this.onEvent(tabId, job, event, resolved.profile);
        else if (event.type === 'segment.partial' && event.id === id) {
          outcome = { status: 'loading', text: event.text };
          set(outcome);
        } else if (event.type === 'segment.final' && event.id === id) outcome = { status: 'ready', text: event.notes?.join('\n') ?? event.text };
        else if (event.type === 'segment.failed' && event.id === id) outcome = { status: 'failed', error: event.error };
      }
      if (signal.aborted) return set(undefined);
      set(outcome?.status === 'loading' || outcome === undefined ? { status: 'failed', error: uiError('unknown', 'no explanation came back', 'noExplanation') } : outcome);
    } catch (err) {
      set(signal.aborted ? undefined : { status: 'failed', error: { kind: 'unknown', message: err instanceof Error ? err.message : String(err), raw: err } });
    } finally {
      if (job.retrying.get(id) === controller) job.retrying.delete(id);
    }
  }

  /**
   * Whether a local-only site rule covers the page: its text must not reach a cloud voice either.
   * The rule is read on its own, so it counts even when the route can't be resolved (no key, no
   * access); a rule or route that can't be read is taken as local-only, to be safe.
   */
  async localOnly(target: ClientTarget): Promise<boolean> {
    try {
      if (this.deps.siteLocalOnly && (await this.deps.siteLocalOnly(target.url).catch(() => true))) return true;
      const resolved = await this.deps.translateClient(target);
      return resolved.ok && resolved.localOnly !== undefined;
    } catch {
      return true;
    }
  }

  /**
   * The client a cloud voice's text preparation (src/tts/prepare.ts) may use for a page: its
   * translate route, so a local-only site stays on the device. Never waits and never asks: it is
   * undefined while the privacy notice is unanswered for a route that leaves the device, past the
   * spend limit, without a language model (Chrome's Translator) or on any failure, and the voice
   * then reads the text as it is. What the call spends is counted under VOICE_PREP_SPEND_ID.
   */
  async speechClient(target: ClientTarget): Promise<{ client: LLMClient; spend(usage: UsageTotals): void } | undefined> {
    try {
      const resolved = await this.deps.translateClient(target);
      if (!resolved.ok || resolved.onDevice === 'translator') return undefined;
      const gate = this.deps.privacy;
      const offDevice = resolved.onDevice === undefined || (resolved.fallback?.length ?? 0) > 0;
      if (gate && offDevice && !gate.acknowledged()) return undefined;
      if (await this.deps.spendLimit?.().catch(() => undefined)) return undefined;
      const { client, profile } = resolved;
      return { client, spend: (usage) => this.deps.onSpend?.({ usage, usd: costUsd(profile.pricing, usage), profileId: VOICE_PREP_SPEND_ID, model: client.model }) };
    } catch {
      return undefined;
    }
  }

  private async redoSegment(tabId: number, id: string, mode: 'retry' | 'retranslate', discard = false): Promise<void> {
    const job = this.jobs.get(tabId);
    const before = job?.segs.get(id);
    const segment = job?.view.segments.find((s) => s.id === id);
    if (!job || !segment || before?.status !== (mode === 'retry' ? 'failed' : 'final') || job.retrying.has(id)) return;
    // An edit is replaced only through discardEdit (the user confirmed it).
    if (before.edited && !discard) return;
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
      const route = () => this.deps.translateClient({ tabId, url: job.doc.url, sourceLang: job.doc.sourceLang, targetLang: job.doc.targetLang });
      const resolved = await this.cleared(route(), route, `redo:${tabId}:${id}`, signal);
      if (resolved === undefined || signal.aborted) return settle(before);
      const limit = await this.deps.spendLimit?.().catch(() => undefined);
      if (signal.aborted) return settle(before);
      if (limit) {
        // The bar offers "Continue anyway", which redoes this block (M4-E10).
        job.afterLimit = () => this.redoSegment(tabId, id, mode, discard);
        this.patch(tabId, job, { limit });
        return settle(failedWith(limitError(limit)));
      }
      if (!resolved.ok) {
        settle(failedWith(resolved.error));
        if (stopsJob(resolved.error) && job.view.status !== 'running') this.finish(tabId, job, 'stopped', resolved.error);
        return;
      }
      const { doc } = job;
      const request: SnippetRequest = {
        doc: { url: doc.url, title: doc.title, sourceLang: doc.sourceLang, targetLang: doc.targetLang, outline: [] },
        segments: [segment],
        // On Chrome's Translator the block is translated as text (basic); on Nano single-pass, the snippet default.
        ...(resolved.onDevice === 'translator' ? { strategy: BASIC_ID } : {}),
        options: {
          style: doc.style ?? 'natural',
          ...(doc.gloss ? { gloss: doc.gloss } : {}),
          glossary: [...(doc.glossary ?? [])],
          maxConcurrency: 1,
          chunkTokens: resolved.profile.chunkTokens,
          ...(job.view.brief && !resolved.onDevice ? { brief: job.view.brief } : {}),
          ...(resolved.basic ? { basicFallback: true, ...(resolved.onDevice === 'nano' ? { onDeviceSwitch: true } : {}) } : {}),
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
      if (outcome.status === 'failed' && mode === 'retranslate') settle(failedWith(outcome.error ?? uiError('unknown', 'no translation came back', 'noTranslation')));
      else {
        const key = this.keyFor(job, id, outcome.model);
        if (mode === 'retranslate' && key !== undefined) job.replaceKeys.add(key);
        if (discard && outcome.status === 'final') {
          const source = segment.inlineMarkup || segment.text;
          try {
            await this.queueMemory(async () => this.deps.memory?.delete([memoryKey(job.doc.targetLang, source)]));
          } catch (err) {
            return settle(failedWith({ kind: 'unknown', message: `the edit could not be deleted: ${err instanceof Error ? err.message : String(err)}`, raw: err }));
          }
          if (this.jobs.get(tabId) !== job) return;
        }
        if (outcome.status === 'final' && job.earlier.delete(id) && job.view.kept !== undefined) {
          const view = { ...job.view, kept: job.earlier.size };
          if (view.kept === 0) delete (view as Partial<JobView>).kept;
          job.view = view;
        }
        settle(outcome);
      }
      if (outcome.status === 'failed' && outcome.error && stopsJob(outcome.error) && job.view.status !== 'running') this.finish(tabId, job, 'stopped', outcome.error);
    } catch (err) {
      settle(signal.aborted ? before : failedWith({ kind: 'unknown', message: err instanceof Error ? err.message : String(err), raw: err }));
    } finally {
      if (job.retrying.get(id) === controller) job.retrying.delete(id);
    }
  }

  /**
   * The route this run may send text over (§8): `first`, when it stays on the device (no fallback
   * link) or the privacy notice was acknowledged. Otherwise the run waits for the notice, then
   * resolves the route again with `again`: settings changed while the notice waited (a local-only
   * rule, another model) apply, and nothing goes out over the route resolved before. Undefined when
   * `signal` aborted first.
   */
  private async cleared(first: Promise<ClientResult>, again: () => Promise<ClientResult>, key: string, signal: AbortSignal): Promise<ClientResult | undefined> {
    let resolved = await first;
    for (;;) {
      if (signal.aborted) return undefined;
      const gate = this.deps.privacy;
      const offDevice = resolved.ok && (resolved.onDevice === undefined || (resolved.fallback?.length ?? 0) > 0);
      if (!gate || !offDevice || gate.acknowledged()) return resolved;
      if (!(await this.acknowledged(gate, key, signal))) return undefined;
      resolved = await again();
    }
  }

  /** Waits for the privacy notice; false when `signal` aborted first. */
  private acknowledged(gate: PrivacyPort, key: string, signal: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (signal.aborted) return resolve(false);
      const onAbort = () => {
        gate.forget(key);
        resolve(false);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      gate.whenAcknowledged(key, () => {
        signal.removeEventListener('abort', onAbort);
        resolve(!signal.aborted);
      });
    });
  }

  private stopRetries(job: Job): void {
    for (const c of job.retrying.values()) c.abort(new DOMException('cancelled', 'AbortError'));
    job.retrying.clear();
  }

  /**
   * The engine over the job's clients: each counted, gated by the tab being active and watched for
   * backoff (M3-E8), and for a refused key (§4.3.5: the connection is marked `error`, "Fix key"
   * names it). `primary` is the routed profile; `fallback` its chain (M4-E9), shared by every role.
   */
  private engineFor(tabId: number, job: Job, primary: FallbackLink, retryKey?: number, analyze?: FallbackLink, fallback: readonly FallbackLink[] = [], review?: FallbackLink): TranslationEngine {
    const { profile } = primary;
    const meter = {
      start: () => {
        job.inflight++;
        job.log.calls++;
      },
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
    const gatedReview = review ? wrap(review, chain.findIndex((l) => l.profile.id === review.profile.id), fallback[0]) : undefined;
    return this.deps.engine?.(gated, gatedAnalyze, gatedFallback, gatedReview) ?? this.defaultEngine(gated, gatedAnalyze, gatedFallback, gatedReview);
  }

  /** `best-mode` for this run (JobDeps.featureAvailable); an answer that fails is "no". */
  private async bestMode(): Promise<boolean> {
    try {
      return (await this.deps.featureAvailable?.('best-mode')) ?? true;
    } catch {
      return false;
    }
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

  private defaultEngine(client: LLMClient, analyze?: LLMClient, fallback: readonly LLMClient[] = [], review?: LLMClient): TranslationEngine {
    return createEngine({
      // The engine asks by role (§5.1); route.ts resolved each through routing (src/shared/providers.ts
      // resolveRoute): `analyze` and `review` have their own client only when routed elsewhere, else
      // it is translate's (§4.3.1).
      llm: (role) => (role === 'analyze' && analyze ? analyze : role === 'review' && review ? review : client),
      // Every role hands over to the same chain (M4-E9), so a link that gave up is skipped by all.
      fallback: () => fallback,
      now: this.now,
      sleep: this.deps.sleep ?? abortableSleep,
      ...(this.deps.retry === undefined ? {} : { retry: this.deps.retry }),
      strategies: [singlePass, contextual, refine, explain, basic],
      prompts: createDefaultPromptRegistry(),
      ...(this.deps.mt === undefined ? {} : { mt: this.deps.mt }),
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
        let next = applySegmentEvent(cur, event);
        if (next === cur || next === undefined) return;
        // A review's final is the job model's block (no fallback badge), stored under the job's key.
        if (next.refined) next = { ...next, model: job.view.model };
        // A retranslated block that fails keeps its earlier translation, and its cache entry (B2).
        const earlier = job.earlier.get(event.id);
        const restored = next.status === 'failed' && earlier !== undefined;
        if (restored) next = { ...earlier, redoError: next.error ?? uiError('unknown', 'no translation came back', 'noTranslation') };
        else if (next.status === 'final') job.earlier.delete(event.id);
        // Keep drafts on screen: the refined text waits until the block leaves the screen (stored now).
        if (next.refined && job.doc.keepDraftsOnScreen && this.screenOf(tabId, job.docId).includes(event.id)) {
          job.held.set(event.id, { next, over: cur });
          this.remember(job, event.id, next);
          return;
        }
        job.segs.set(event.id, next);
        if (!restored) this.remember(job, event.id, next);
        const patch: Partial<JobView> = { counts: count(job.segs) };
        const pair = event.type === 'segment.failed' && job.view.onDeviceSetup === undefined ? needsActivation(event.error) : undefined;
        if (pair) patch.onDeviceSetup = { engine: 'translator', from: pair.from, to: pair.to };
        if (job.view.firstVisibleAt === undefined && next.text) patch.firstVisibleAt = this.now();
        // A model translated a block again after Chrome's Translator took over in an earlier run of
        // the page (a lazy round, Retry: the note was carried over). See `basicCarried`.
        const fb = job.view.fallback;
        if (job.basicCarried && event.type === 'segment.final' && next.status === 'final' && !next.basic && fb?.basic && !fb.recovered) patch.fallback = { ...fb, recovered: true };
        this.screenDone(tabId, job, patch);
        this.patch(tabId, job, patch);
        if (event.type === 'segment.failed' && STOP_KINDS.has(event.error.kind)) {
          job.controller.abort(new DOMException('stopped', 'AbortError'));
          this.finish(tabId, job, 'stopped', event.error);
        }
        return;
      }
      case 'stage': {
        if (event.stage === CONTEXT_STAGE) {
          this.logMemory(job, event.info);
          return;
        }
        const promptId = (event.info as { promptId?: unknown } | undefined)?.promptId;
        if (event.status === 'start' && typeof promptId === 'string') job.log.promptIds.add(promptId);
        // Best: the drafts are done, only reviews are left (a lazy round may stop waiting for them).
        if (event.stage === DRAFTS_STAGE && event.status === 'done') {
          job.draftsDone = true;
          if (job.view.status === 'running') this.dropReviews(tabId, job);
          return;
        }
        // Every provider gave up and the job switched to Chrome's Translator (M5-E7); `done` with
        // `recovered`: a provider answered again and the job went back to it.
        if (event.stage !== BASIC_SWITCH_STAGE || job.view.status !== 'running') return;
        const info = event.info as BasicSwitchInfo;
        if (event.status === 'start') {
          job.basicCarried = false;
          this.patch(tabId, job, { fallback: { from: info.from, to: info.to ?? i18n.t('panel.segment.basic'), error: info.error, basic: true } });
        }
        else if (event.status === 'done' && info.recovered && job.view.fallback?.basic) this.patch(tabId, job, { fallback: { ...job.view.fallback, recovered: true } });
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
      case 'chunk':
        if (event.review) this.reviewed(job, event.review);
        else if (!event.revise) job.log.chunks.add(event.index);
        return;
      case 'usage': {
        const spent = { input: event.input, cachedInput: event.cachedInput ?? 0, output: event.output };
        job.log.tokens = addUsage(job.log.tokens, spent);
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
   * Shows the user's corrections (the translation memory) and then what the translation cache has
   * for the run's segments as final (never sent), and seeds the brief from the brief cache when the
   * run has none. A retranslate (`fresh`) reads the corrections only. Both reads run together, each
   * raced against the cache timeout; any error just means a normal run. Mutates `todo`: the
   * segments still to translate.
   */
  private async fromCache(tabId: number, job: Job, run: { todo: Set<string>; translatable: readonly Segment[]; model: string; fresh: boolean; drafts: Map<string, { text: string; revision: number }> }): Promise<void> {
    const { cache, memory } = this.deps;
    const { doc } = job;
    const segments = job.view.segments;
    if (cache) {
      const scope = this.scopeOf(job, run.model);
      for (const s of run.translatable) job.keys.set(s.id, segmentKey(scope, s));
      job.briefKey = briefCacheKey({ url: doc.url, title: doc.title, targetLang: doc.targetLang, outline: segments.filter((s) => s.kind === 'heading').map((s) => s.text) }, segments);
    }
    const wanted = run.translatable.filter((s) => run.todo.has(s.id));
    if (wanted.length === 0 && job.view.brief) return;
    const memoryKeys = new Map(memory ? wanted.map((s) => [s.id, memoryKey(doc.targetLang, s.inlineMarkup || s.text)]) : []);
    // Best: where it has no entry, Balanced's entry of the same block (same model, style and glossary) is a draft.
    const refining = job.strategy === REFINE_ID;
    const balanced = cache && refining ? scopeHash(keyScope({ targetLang: doc.targetLang, model: run.model, style: doc.style, gloss: doc.gloss, strategy: contextual.id, glossary: doc.glossary })) : undefined;
    const draftKey = (s: Segment) => (balanced === undefined ? undefined : segmentKey(balanced, s));
    const briefKey = job.briefKey;
    const [overrides, found] = await Promise.all([
      memory && memoryKeys.size > 0 ? this.timed(memory.getMany([...new Set(memoryKeys.values())])) : undefined,
      cache && !run.fresh && briefKey !== undefined
        ? this.timed(
            Promise.all([
              cache.getMany([...new Set(wanted.map((s) => job.keys.get(s.id) as string))]),
              job.view.brief ?? cache.getBrief(briefKey),
              balanced === undefined ? undefined : cache.getMany([...new Set(wanted.map((s) => draftKey(s) as string))]),
            ]),
          )
        : undefined,
    ]);
    if (job.controller.signal.aborted || this.jobs.get(tabId) !== job) return;
    const patch: Partial<JobView> = {};
    let edited = 0;
    // Corrections first: shown as they are, never sent. An imported one only when the user chose so.
    for (const s of wanted) {
      const entry = overrides?.get(memoryKeys.get(s.id) as string);
      if (!entry?.override) continue;
      job.segs.set(s.id, { status: 'final', text: entry.target, revision: 1, attempt: 1, edited: entry.by });
      run.todo.delete(s.id);
      edited++;
    }
    let shown = 0;
    if (found !== undefined) {
      const [hits, brief, draftHits] = found;
      for (const s of wanted) {
        if (!run.todo.has(s.id)) continue;
        const hit = hits.get(job.keys.get(s.id) as string);
        // Best: an entry at the review revision was reviewed (refined, or kept as drafted); below it, it is a draft.
        if (hit && (!refining || hit.revision >= REVIEWED_REVISION)) {
          job.segs.set(s.id, { status: 'final', text: hit.text, revision: hit.revision, attempt: hit.attempt, ...(hit.refined ? { refined: true as const } : {}), ...(job.onDevice ? { model: run.model } : {}), ...(job.onDevice === 'translator' ? { basic: true as const } : {}) });
        } else {
          const draft = hit ?? (draftHits === undefined ? undefined : draftHits.get(draftKey(s) as string));
          if (!draft) continue;
          job.segs.set(s.id, { status: 'final', text: draft.text, revision: draft.revision, attempt: draft.attempt });
          run.drafts.set(s.id, { text: draft.text, revision: draft.revision });
        }
        run.todo.delete(s.id);
        shown++;
      }
      if (brief && !job.view.brief) {
        patch.brief = brief;
        if (!job.view.sourceLang && brief.language) patch.sourceLang = brief.language;
      }
    }
    if (shown > 0) patch.cached = shown;
    if (shown + edited > 0) {
      patch.counts = count(job.segs);
      patch.firstVisibleAt = this.now();
      this.screenDone(tabId, job, patch);
    }
    if (Object.keys(patch).length > 0) this.patch(tabId, job, patch);
  }

  /**
   * A store read raced against the cache timeout: a store that never answers (a blocked or dead
   * database) must not hold the translation. Undefined on a timeout or an error (a miss).
   */
  private async timed<T>(read: Promise<T>): Promise<T | undefined> {
    read.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([read, new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), this.deps.cacheTimeoutMs ?? 1500)))]);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Stores the final a segment now shows (the highest revision only), or drops the entry of one that failed. */
  private remember(job: Job, id: string, state: SegState): void {
    // A basic translation (M5-E7) is a stopgap: not stored, so the next run asks the model again;
    // on the device it is the translation, stored under its own model (a provider set up later
    // translates again). An edit is the user's, kept in the memory: the cache holds what the model translated.
    if ((state.basic && job.onDevice === undefined) || state.edited) return;
    // A final is stored under the model that produced it (§7); a failure drops the job model's entry.
    // A review's final goes under the job's own key (the reviewer is in its scope), so a reload finds it.
    const key = state.status === 'final' && !state.refined ? this.keyFor(job, id, state.model) : job.keys.get(id);
    if (state.status === 'final' && state.text !== undefined) this.store(job, key, { text: state.text, revision: state.revision ?? 1, attempt: state.attempt ?? 1, ...(state.refined ? { refined: true as const } : {}) });
    else if (state.status === 'failed') this.store(job, key, undefined);
  }

  /** Queues a cache write of `entry` under `key`, or the entry's removal (undefined). */
  private store(job: Job, key: string | undefined, entry: CachedSegment | undefined): void {
    if (key === undefined || !this.deps.cache) return;
    // Two blocks with the same text share a key: the refined one's entry is kept over its twin's
    // draft, in this flush and in a run that replaces entries (as the cache does across runs).
    if (entry?.refined) job.refinedKeys.add(key);
    else if (entry && job.refinedKeys.has(key) && !job.replaceKeys.has(key)) return;
    if (entry) {
      job.drops.delete(key);
      job.writes.set(key, entry);
    } else {
      job.writes.delete(key);
      job.drops.add(key);
    }
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
      scope = this.scopeOf(job, model);
      job.scopes.set(model, scope);
    }
    return segmentKey(scope, segment);
  }

  /** The cache scope of the job's finals from `model`: its strategy, settings and, for Best, its reviewer. */
  private scopeOf(job: Job, model: string): string {
    const { doc } = job;
    return scopeHash(keyScope({ targetLang: doc.targetLang, model, style: doc.style, gloss: doc.gloss, strategy: job.strategy, glossary: doc.glossary, reviewModel: job.reviewModel }));
  }

  /**
   * Best: what a chunk's review did (ReviewReport). Its counts go to the diagnostics record, and a
   * block the reviewer left as it was, or whose candidate was rejected, is stored at the review
   * revision with its draft: it was reviewed, so a reload shows it as final and asks nothing.
   * Accepted ones were stored with their final; skipped ones stay drafts, reviewed on a later visit.
   */
  private reviewed(job: Job, report: ReviewReport): void {
    const log = (job.log.review ??= { accepted: 0, unchanged: 0, rejected: 0, skipped: 0 });
    log.accepted += report.accepted.length;
    log.unchanged += report.unchanged.length;
    log.rejected += report.rejected.length;
    if (report.skipped !== undefined) log.skipped += report.ids.length;
    const reported = (job.reported ??= new Set());
    for (const id of report.ids) reported.add(id);
    // A review dropped as the reader moved on is still owed; one that ran, or was given up, is not.
    // Given up for the budget or a failed call: not asked again in this session (that would loop
    // on a provider that keeps failing); its row stays below the review revision, so a reload does.
    if (report.skipped !== 'dropped') {
      job.reviewedAny = true;
      for (const id of report.ids) job.reviewTried.add(id);
    }
    for (const id of [...report.unchanged, ...report.rejected]) {
      const state = job.segs.get(id);
      if (state?.status !== 'final' || state.text === undefined || state.basic || state.edited || (state.revision ?? 1) >= REVIEWED_REVISION) continue;
      // Under the key of the model that drafted it, as its draft was (a fallback's has its own, §7).
      this.store(job, this.keyFor(job, id, state.model), { text: state.text, revision: REVIEWED_REVISION, attempt: 1 });
    }
  }

  /** Best: a final draft (below the review revision, not refined, not a basic translation) no review has looked at yet. */
  private unreviewed(job: Job, id: string, state: SegState | undefined): state is SegState & { text: string } {
    return state?.status === 'final' && state.text !== undefined && !state.refined && !state.basic && !state.edited && (state.revision ?? 1) < REVIEWED_REVISION && !job.reviewTried.has(id);
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
    // A retranslate that ends early puts back the earlier translation of every block it did not redo (B2).
    for (const [id, s] of job.earlier) if (job.segs.get(id)?.status === 'pending' && !job.retrying.has(id)) job.segs.set(id, s);
    // Refined revisions held while their block was on screen are shown now that the run is over.
    this.release(job, new Set());
    const kept = job.earlier.size > 0 ? { kept: job.earlier.size } : {};
    job.backoff.clear();
    if (job.lazy) {
      if (status === 'done' && job.round && !job.within) job.stalled = [...job.round].some((id) => job.segs.get(id)?.status === 'pending');
    }
    // Best: a run that ended by itself, its reviews not dropped for the reader, reviewed what it
    // could; a block it sent that got no report is not asked for again in this session.
    // Only a block that is a final draft now: a failed one is drafted again by Retry, then reviewed.
    if (status === 'done' && job.reviewScope && job.reviewWanted && !job.within) for (const id of job.reviewScope) if (!job.reported?.has(id) && job.segs.get(id)?.status === 'final') job.reviewTried.add(id);
    if (status === 'done' && job.draftsRound && !job.reviewedAny) job.noDrafts = true;
    this.patch(tabId, job, { backoff: [], status, paused: false, counts: count(job.segs), endedAt: this.now(), ...kept, ...(stopError ? { stopError } : {}) });
    this.record(job, status);
    if (status === 'done') queueMicrotask(() => (job.wantRest ? void this.translateRest(tabId) : this.reach(tabId, job)));
  }

  /**
   * Lazy mode (M5-E4): the reader scrolled clear of the window the running round covers. Its chunks
   * not started yet are dropped (the engine cuts them again over `within`, the window around the
   * screen now), so the round ends once what is in flight does and `reach` starts one at the reader.
   * Requests in flight are never aborted (M3-D3).
   */
  private leave(tabId: number, job: Job): void {
    const translatable = (job.translatable ??= job.view.segments.filter((s) => s.translate));
    const pinned = this.pinnedOf(tabId, job.docId);
    const screen = this.screenOf(tabId, job.docId);
    const current = job.within ?? job.round;
    // The reader's own blocks: a fixed header is in every window.
    if (!current || screen.filter((id) => !pinned.includes(id)).some((id) => current.has(id))) return;
    job.within = lazyWindow(translatable, screen, {}, this.pinnedOf(tabId, job.docId));
    job.focus++;
  }

  /**
   * Lazy mode (M5-E4): a finished round whose reader has since moved on to blocks nobody translated
   * yet (or, in Best, reviewed yet) starts the next round, over the screen now. Failed blocks are left to Retry; a round that
   * left part of its own window pending (a budget that ran out) is not repeated.
   */
  private reach(tabId: number, job: Job): void {
    if (!job.lazy || job.stalled || this.jobs.get(tabId) !== job || job.view.status !== 'done' || job.view.limit) return;
    const translatable = (job.translatable ??= job.view.segments.filter((s) => s.translate));
    const near = lazyWindow(translatable, this.screenOf(tabId, job.docId), LAZY_LOW_WATER, this.pinnedOf(tabId, job.docId));
    // Best: a draft near the reader that no review has looked at yet is work too (its review was
    // dropped as the reader moved on, or it came from the cache outside the round), when the next
    // round's window, cut as `start` cuts it, takes it: a round never starts for nothing.
    const next = job.strategy === REFINE_ID && !job.noDrafts ? lazyWindow(translatable, this.screenOf(tabId, job.docId), {}, this.pinnedOf(tabId, job.docId)) : undefined;
    const pending = [...near].some((id) => job.segs.get(id)?.status === 'pending');
    if (!pending && ![...near].some((id) => next?.has(id) === true && this.unreviewed(job, id, job.segs.get(id)))) return;
    if (job.strategy === REFINE_ID) job.forDrafts = !pending;
    void this.resume(tabId);
  }

  /** "Translate the rest" (plan M5-E4): the whole page, no window; what is final stays. */
  translateRest(tabId: number): Promise<void> {
    const job = this.jobs.get(tabId);
    if (!job) return Promise.resolve();
    if (job.view.status === 'running') {
      // A round is going: the rest follows it, without cutting what is in flight (M3-D3).
      job.wantRest = true;
      return Promise.resolve();
    }
    return this.start(tabId, job.docId, job.doc, { resume: true, all: true, ...(job.earlier.size || job.redo ? { fresh: true, keepCost: true } : {}) });
  }

  /**
   * Reports the run to the diagnostics log: facts the extension owns, never text or addresses (the
   * log drops the origin unless the user asked for site names).
   */
  private record(job: Job, outcome: JobRecord['outcome']): void {
    const report = this.deps.onJobRecord;
    if (!report) return;
    const errors = new Map<string, { kind: LLMErrorKind; status?: number; count: number }>();
    const add = (e: LLMError) => {
      const key = `${e.kind}:${e.status ?? ''}`;
      const seen = errors.get(key);
      if (seen) seen.count++;
      else errors.set(key, { kind: e.kind, ...(e.status === undefined ? {} : { status: e.status }), count: 1 });
    };
    if (job.view.stopError) add(job.view.stopError);
    for (const s of job.segs.values()) if (s.status === 'failed' && s.error) add(s.error);
    const origin = originOf(job.doc.url);
    const v = job.view;
    // Best: blocks sent for review that no chunk report covered (dropped before they started) were not reviewed.
    let review = job.log.review === undefined ? undefined : { ...job.log.review };
    if (outcome !== 'started' && job.strategy === REFINE_ID && job.draftsDone && job.reviewScope) {
      let unreported = 0;
      for (const id of job.reviewScope) if (job.segs.get(id)?.status === 'final' && !job.reported?.has(id)) unreported++;
      if (unreported > 0) review = { ...(review ?? { accepted: 0, unchanged: 0, rejected: 0, skipped: 0 }), skipped: (review?.skipped ?? 0) + unreported };
    }
    report({
      id: job.log.id,
      startedAt: v.startedAt,
      ...(outcome === 'started' ? {} : { endedAt: v.endedAt ?? this.now() }),
      outcome,
      strategy: job.strategy,
      ...(job.unsettled ? { requested: true as const } : {}),
      promptIds: [...job.log.promptIds],
      ...(v.connection?.presetId === undefined ? {} : { presetId: v.connection.presetId }),
      ...(v.model ? { model: v.model } : {}),
      lazy: job.lazy,
      segments: job.owed.size,
      cached: v.cached ?? 0,
      chunks: job.log.chunks.size,
      calls: job.log.calls,
      tokens: { ...job.log.tokens },
      ...(v.firstVisibleAt === undefined ? {} : { firstTextAt: v.firstVisibleAt }),
      failed: v.counts.failed,
      ...(review === undefined ? {} : { review }),
      ...(job.log.memory === undefined ? {} : { memory: { hits: job.log.memory.hits, ids: [...job.log.memory.ids].slice(0, MEMORY_IDS_LOGGED) } }),
      errors: [...errors.values()],
      ...(origin === undefined ? {} : { origin }),
    });
  }

  private patch(tabId: number, job: Job, patch: Partial<JobView>): void {
    job.view = { ...job.view, ...patch };
    // Lazy mode: the Translate the rest button is there from the first round on, with the blocks still waiting.
    if (job.lazy && (patch.counts !== undefined || patch.status !== undefined)) {
      let rest = 0;
      for (const s of job.segs.values()) if (s.status === 'pending') rest++;
      const next: JobView = { ...job.view };
      delete next.lazy;
      job.view = rest > 0 ? { ...next, lazy: { rest } } : next;
    }
    if (this.jobs.get(tabId) === job) this.emit(tabId, job.view);
  }

  private emit(tabId: number, view: JobView | undefined): void {
    for (const fn of this.listeners) fn(tabId, view);
  }
}

/** The page's segments under the mixed-content settings (plan M5-E5). */
export function withMedia(segments: readonly Segment[], media: JobDoc['media']): Segment[] {
  const { captions = true, altText = false } = media ?? {};
  if (captions && segments.every((s) => !s.alt)) return segments as Segment[];
  const out: Segment[] = [];
  for (const s of segments) {
    if (s.alt) {
      if (altText) out.push(s);
    } else out.push(s.kind === 'caption' && !captions && s.translate ? { ...s, translate: false } : s);
  }
  return out;
}

/** The page's origin; undefined for a URL without one (`null`) or that does not parse. */
function originOf(url: string): string | undefined {
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
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
