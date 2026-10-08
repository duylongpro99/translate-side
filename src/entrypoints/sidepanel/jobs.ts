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
import { briefCacheKey, contextual, createDefaultPromptRegistry, createEngine, normalizeBrief, singlePass, type DocumentBrief, type EngineEvent, type GlossaryEntry, type GlossMode, type StyleMode, type Segment, type StrategyId, type TranslationEngine, type TranslationJob } from '@/engine/index';
import type { LLMClient, LLMError, LLMErrorKind, NormalizedRequest } from '@/llm/types';
import { keyScope, scopeHash, segmentKey, type CachedSegment, type TranslationCache } from '@/shared/cache';
import { costUsd, type UsageTotals } from '@/shared/cost';
import type { Detection } from '@/shared/language';
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

/** These hit every request of the job alike, so the job stops at the first one (§4.3.5: "stop", no silent fallback). */
const STOP_KINDS: ReadonlySet<LLMErrorKind> = new Set(['auth', 'quota', 'cors', 'model_not_found']);

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
      return { status: 'final', text: e.text, revision: e.revision, attempt };
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

// ---- Jobs ---------------------------------------------------------------------------------

/** What a job needs from the panel: the translate client for the routed profile, or why there is none. */
export type ClientResult = { ok: true; client: LLMClient; profile: ModelProfile } | { ok: false; error: LLMError };

export interface JobDeps {
  /** Resolves the `translate` role (§4.3.5): key, host permission, profile. Called once per run. */
  translateClient: () => Promise<ClientResult>;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Test seam: the engine to run (default: single-pass and contextual over the given client). */
  engine?: (client: LLMClient) => TranslationEngine;
  /** Test seam: the strategy jobs run (default PANEL_STRATEGY). */
  strategy?: StrategyId;
  /** The translation cache (M3-E2). Absent: every run goes to the model. */
  cache?: TranslationCache | undefined;
}

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
  flush?: boolean;
  /** A retranslate run: its stored finals replace whatever the cache has. */
  fresh?: boolean;
  /** The brief cache key of this document; undefined without a cache. */
  briefKey?: string;
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
    const resolved = await this.deps.translateClient();
    if (signal.aborted || this.jobs.get(tabId) !== job) return;
    if (!resolved.ok) {
      this.finish(tabId, job, 'stopped', resolved.error);
      return;
    }
    const { client, profile } = resolved;
    this.patch(tabId, job, { model: client.model });
    await this.fromCache(tabId, job, { todo, translatable, model: client.model, fresh });
    if (signal.aborted || this.jobs.get(tabId) !== job) return;
    if (todo.size === 0) {
      this.finish(tabId, job, 'done');
      return;
    }
    const meter = {
      start: () => void job.inflight++,
      end: (unmetered: boolean) => {
        job.inflight--;
        if (unmetered) this.patch(tabId, job, { unmetered: job.view.unmetered + 1, cost: costUsd(profile.pricing, job.view.usage) });
      },
    };
    const gated = gatedClient(meteredClient(client, meter), gate);
    const engine = this.deps.engine?.(gated) ?? this.defaultEngine(gated);
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

  /** Translates what the tab's job left (cancelled, failed or stopped segments) for the same document. */
  resume(tabId: number): Promise<void> {
    const job = this.jobs.get(tabId);
    if (!job || job.view.status === 'running') return Promise.resolve();
    return this.start(tabId, job.docId, job.doc, { resume: true });
  }

  /** The tab's job document, for a restart with other languages. */
  docFor(tabId: number): { docId: string; doc: JobDoc } | undefined {
    const job = this.jobs.get(tabId);
    return job && { docId: job.docId, doc: job.doc };
  }

  /** The Cancel button, a navigation, the tab closing. Finals stay; previews are dropped. */
  cancel(tabId: number): void {
    const job = this.jobs.get(tabId);
    if (!job || job.view.status !== 'running') return;
    job.controller.abort(new DOMException('cancelled', 'AbortError'));
    this.finish(tabId, job, 'cancelled');
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

  private defaultEngine(client: LLMClient): TranslationEngine {
    return createEngine({
      // §4.3.1: an unset analyze route defaults to translate (settings.ts resolveProfile).
      llm: (role) => {
        if (role === 'review') throw new Error(`no model profile is routed for the ${role} role yet`);
        return client;
      },
      now: this.now,
      sleep: this.deps.sleep ?? abortableSleep,
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
        const usage = { input: job.view.usage.input + event.input, cachedInput: job.view.usage.cachedInput + (event.cachedInput ?? 0), output: job.view.usage.output + event.output };
        this.patch(tabId, job, { usage, cost: costUsd(profile.pricing, usage) });
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
      const hits = await cache.getMany([...new Set(wanted.map((s) => job.keys.get(s.id) as string))]);
      const brief = job.view.brief ?? (await cache.getBrief(job.briefKey));
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
    const key = job.keys.get(id);
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

  private flushCache(job: Job): void {
    job.flush = false;
    const cache = this.deps.cache;
    if (!cache) return;
    const writes = new Map(job.writes);
    const drops = [...job.drops];
    job.writes.clear();
    job.drops.clear();
    void cache
      .delete(drops)
      .then(() => cache.putMany(writes, { replace: job.fresh === true }))
      .catch(() => {});
  }

  private finish(tabId: number, job: Job, status: Exclude<JobStatus, 'running'>, stopError?: LLMError): void {
    // Previews of a request that did not finish can't be trusted: back to the original.
    for (const [id, s] of job.segs) if (s.status === 'streaming') job.segs.set(id, { status: 'pending' });
    this.patch(tabId, job, { status, paused: false, counts: count(job.segs), endedAt: this.now(), ...(stopError ? { stopError } : {}) });
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
