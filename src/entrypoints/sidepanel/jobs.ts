// Job orchestration in the panel (plan M1-E8, decision S1: the panel is the engine host). One job
// per tab; the engine owns chunking and runs `maxConcurrency` (2) chunks in flight. The shell
// owns the job lifecycle only: it never builds prompts or reads model output (DESIGN.md §5.1),
// it just folds EngineEvents into what the panel shows.
//
// - Cancel: the Cancel button, a navigation (the content connection drops), the tab closing or
//   moving to another window, and the panel closing (the page unloads; `cancelAll` on pagehide).
// - Pause on tab switch (decision S5 R1, M0 D14): only the active tab's job starts new model
//   requests. A background job's requests already streaming finish; the next one waits at the
//   gate until its tab is active again. Repairs and retries wait too, since they are requests.
import { createDefaultPromptRegistry, createEngine, singlePass, type EngineEvent, type Segment, type TranslationEngine, type TranslationJob } from '@/engine/index';
import type { LLMClient, LLMError, LLMErrorKind, NormalizedRequest } from '@/llm/types';
import { costUsd, type UsageTotals } from '@/shared/cost';
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
  | 'stopped';

export interface JobView {
  status: JobStatus;
  /** Running, but its tab is in the background: no new requests start (D14). */
  paused: boolean;
  model: string;
  targetLang: string;
  /** Every segment of the page, in page order (code blocks included: they are shown as is). */
  segments: readonly Segment[];
  /**
   * Per translatable segment id. The job's live map (read it when rendering, don't keep it): a
   * SegState in it is replaced, never mutated, so a renderer can compare by identity.
   */
  segs: ReadonlyMap<string, SegState>;
  counts: { total: number; final: number; failed: number };
  usage: UsageTotals;
  /** USD for this page so far, across runs (cancel + resume); undefined without pricing. */
  cost: number | undefined;
  /** The error that stopped the job (status `stopped`). */
  stopError?: LLMError;
  /** Epoch ms: when this run started, when its first text became visible, when it ended. */
  startedAt: number;
  firstVisibleAt?: number;
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
 * `segment.failed` carries no revision. Single-pass has only revision 1, so a failure replaces a
 * revision-1 final (review B-N1: a first-pass final the repair could not confirm). A higher
 * revision (refine, M7) is a better text than the failed pass, so it stays (§5.6).
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
      if (cur?.status === 'final' && (cur.revision ?? 1) > 1) return { ...cur, error: e.error };
      return { status: 'failed', error: e.error, revision: cur?.revision ?? 1 };
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

/** Every request waits at the gate before it is sent; a stream already running is not touched. */
export function gatedClient(inner: LLMClient, gate: Gate): LLMClient {
  return {
    model: inner.model,
    reasoningReserveTokens: inner.reasoningReserveTokens,
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
  /** Test seam: the engine to run (default: single-pass over the given client). */
  engine?: (client: LLMClient) => TranslationEngine;
}

export interface JobDoc {
  url: string;
  title: string;
  /** The page's own `lang`, kept so a changed source-language setting can be re-applied. */
  pageLang?: string;
  sourceLang: string;
  targetLang: string;
  segments: Segment[];
}

interface Job {
  /** The document the job belongs to (content script `docId`). */
  docId: string;
  doc: JobDoc;
  view: JobView;
  segs: Map<string, SegState>;
  controller: AbortController;
  gate: Gate;
  /** Bumped per run, so a finished run can't overwrite a newer one. */
  run: number;
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
   * only what is left (pending or failed).
   */
  async start(tabId: number, docId: string, doc: JobDoc, { resume = false } = {}): Promise<void> {
    const prev = this.jobs.get(tabId);
    const keep = resume && prev?.docId === docId && prev.view.status !== 'running' ? prev : undefined;
    if (prev?.view.status === 'running') prev.controller.abort(new DOMException('replaced', 'AbortError'));

    const translatable = doc.segments.filter((s) => s.translate);
    const segs = new Map<string, SegState>();
    for (const s of translatable) {
      const old = keep?.segs.get(s.id);
      segs.set(s.id, old?.status === 'final' ? old : { status: 'pending' });
    }
    const todo = new Set(translatable.filter((s) => segs.get(s.id)?.status !== 'final').map((s) => s.id));
    const gate = new Gate();
    gate.set(tabId === this.activeTabId);
    const job: Job = {
      docId,
      doc,
      segs,
      controller: new AbortController(),
      gate,
      run: (prev?.run ?? 0) + 1,
      view: {
        status: 'running',
        paused: !gate.open,
        model: keep?.view.model ?? '',
        targetLang: doc.targetLang,
        segments: doc.segments,
        segs,
        counts: count(segs),
        usage: keep ? { ...keep.view.usage } : { input: 0, cachedInput: 0, output: 0 },
        cost: keep?.view.cost,
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
    if (todo.size === 0) {
      this.finish(tabId, job, 'done');
      return;
    }
    const engine = this.deps.engine?.(gatedClient(client, gate)) ?? this.defaultEngine(gatedClient(client, gate));
    const engineJob: TranslationJob = {
      doc: {
        url: doc.url,
        title: doc.title,
        sourceLang: doc.sourceLang,
        targetLang: doc.targetLang,
        outline: doc.segments.filter((s) => s.kind === 'heading').map((s) => s.text),
        // Already-final segments are not sent again (resume). Code blocks ride along; the engine skips them.
        segments: doc.segments.filter((s) => !s.translate || todo.has(s.id)),
      },
      priority: [],
      strategy: singlePass.id,
      options: { style: 'natural', glossary: [], maxConcurrency: profile.maxConcurrency, chunkTokens: profile.chunkTokens },
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
    if (this.jobs.delete(tabId)) this.emit(tabId, undefined);
  }

  /** The panel is closing. */
  cancelAll(): void {
    for (const tabId of this.jobs.keys()) this.cancel(tabId);
  }

  private defaultEngine(client: LLMClient): TranslationEngine {
    return createEngine({
      llm: (role) => {
        if (role !== 'translate') throw new Error(`no model profile is routed for the ${role} role yet`);
        return client;
      },
      now: this.now,
      sleep: this.deps.sleep ?? abortableSleep,
      strategies: [singlePass],
      prompts: createDefaultPromptRegistry(),
    });
  }

  private onEvent(tabId: number, job: Job, event: EngineEvent, profile: ModelProfile): void {
    switch (event.type) {
      case 'segment.partial':
      case 'segment.final':
      case 'segment.failed': {
        if (!job.segs.has(event.id)) return;
        const cur = job.segs.get(event.id);
        const next = applySegmentEvent(cur, event);
        if (next === cur || next === undefined) return;
        job.segs.set(event.id, next);
        const patch: Partial<JobView> = { counts: count(job.segs) };
        if (job.view.firstVisibleAt === undefined && next.text) patch.firstVisibleAt = this.now();
        this.patch(tabId, job, patch);
        if (event.type === 'segment.failed' && STOP_KINDS.has(event.error.kind)) {
          job.controller.abort(new DOMException('stopped', 'AbortError'));
          this.finish(tabId, job, 'stopped', event.error);
        }
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
