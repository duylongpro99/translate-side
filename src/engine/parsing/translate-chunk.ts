// One chunk through the model, with S2's one repair round (DESIGN.md §5.7 Step 3, plan M1-E3).
// The caller (the translate stage, M1-E5) supplies `call`: it builds the prompt around the wire
// chunk and returns the client's stream. This file turns the stream into engine events:
//
// - first pass: `segment.partial` (the open segment's text so far, untrimmed) as text arrives, and
//   `segment.final` (trimmed) as soon as the parser accepts a segment;
// - then the repair plan; if it names segments, ONE follow-up call with only those (their original
//   ids). Repaired segments are emitted with `attempt: 2` once the follow-up's own plan accepts
//   them, so they replace the shown text in place (same revision; revision is refine's);
// - a segment still not accepted after the follow-up gets `segment.failed`, also when an earlier
//   attempt was shown (its text could not be trusted);
// - a segment whose text copies a neighbour's translation (duplicate.ts: an earlier segment of the
//   same call, or `neighbours`, the context tail's translated paragraphs) is not accepted: it is
//   re-requested like a malformed one;
// - a stream `error` (the pipeline's retries are already spent, retry.ts) fails every segment of
//   that call that has no accepted text, with that error;
// - except `context_length` (§4.3.5 "shrink chunkTokens and retry"): the segments without accepted
//   text are split in two halves, each sent as a chunk of its own (and split again if still too
//   long), and the job remembers the smaller size (`shrink`), so its later chunks start split. A
//   single segment still too long is sent once more without the chunk's `<context>` block (`lean`);
//   if that fails too, it fails with the error.
// Usage from both calls is passed on as `usage` events. An abort propagates as a throw.

import type { LLMError, ModelRole, NormalizedEvent, StopReason } from '../../llm/types.ts';
import { BUDGET_MESSAGE } from '../budget.ts';
import { estimateTokens } from '../tokens.ts';
import type { EngineEvent } from '../types.ts';
import { copiesNeighbour, type Rendered } from './duplicate.ts';
import { planRepair, type RepairPlan, type RepairRule } from './repair.ts';
import { SegParser, type ParseResult } from './seg-parser.ts';
import { toWire, type WireChunk, type WireSegment } from './wire.ts';

/** Sends `chunk` and returns the stream. `attempt` is 1 for the first pass, 2 for the repair. */
/**
 * The check stage's re-request (Phase D round 4): the earlier answer to the chunk and what to fix,
 * sent after the chunk as an assistant turn and a user turn.
 */
export interface FollowUp {
  answer: string;
  fixes: string;
}

/** `lean`: leave out the chunk's `<context>` block (a single segment too long for the model, §4.3.5). */
export type ChunkCall = (chunk: WireChunk, attempt: number, followUp?: FollowUp, lean?: boolean) => AsyncIterable<NormalizedEvent>;

/**
 * The job's memory of a `context_length` shrink: the most source tokens a call may carry. Absent
 * `maxTokens`: no limit learned yet. Shared by the job's chunks (one object per job).
 */
export interface Shrink {
  maxTokens?: number;
}

export interface TranslateChunkOptions {
  producedBy: { strategy: string; stage: string; model: string };
  /** The id of the client that answered the call (LLMClient.id), put on its usage events: who spent it. */
  clientId?: () => string | undefined;
  /** Revision of the finals (1 for a draft; refine uses 2). */
  revision: number;
  role: ModelRole;
  mergeFactor?: number;
  /**
   * Turns the copy guard on (the translate stage does under translate@2): translated passages before the
   * chunk (the context tail) that no segment may copy, besides the call's own earlier segments.
   */
  neighbours?: readonly Rendered[];
  /** The job's shrink memory (context_length): chunks larger than it are split before they are sent. */
  shrink?: Shrink;
  /**
   * The job's budget (§5.6), asked before the repair call: once exhausted, the segments left fail
   * with BUDGET_MESSAGE instead of being re-requested.
   */
  exhausted?: () => boolean;
}

/** Not exported from engine/index.ts: the test seam of the fuzz mutation checks (repair.ts). */
export interface TranslateChunkTestOptions extends TranslateChunkOptions {
  /** Rules to switch off. */
  disable?: readonly RepairRule[];
}

export interface CallReport {
  result: ParseResult;
  plan: RepairPlan;
  /** Wire ids not accepted because their text copied a neighbour's translation (duplicate.ts). */
  copied?: number[];
  error?: LLMError;
}

export interface ChunkReport {
  first: CallReport;
  repair?: CallReport;
  /** The first call was too long for the model (`context_length`): the halves it was split into. */
  split?: ChunkReport[];
  /** Segment ids that ended in `segment.failed`. */
  failed: string[];
}

/** Text the model returned for a segment the parser could not use. */
export const UNREADABLE_MESSAGE = 'The model did not return this segment in a usable form';

interface CallOutcome extends CallReport {
  /** Accepted ids → trimmed text. */
  accepted: Map<number, string>;
}

async function* runCall(
  chunk: WireChunk,
  attempt: number,
  call: ChunkCall,
  options: TranslateChunkTestOptions,
  emitFinals: boolean,
  /** Ids already shown as final: their text is not replaced by a partial preview. */
  shown: ReadonlySet<number> = new Set(),
  lean = false,
): AsyncGenerator<EngineEvent, CallOutcome> {
  const idOf = new Map(chunk.segments.map((e) => [e.n, e.segment.id]));
  const source = new Map(chunk.segments.map((e) => [e.n, e.segment.inlineMarkup]));
  const pending: EngineEvent[] = [];
  // The copy guard: each closed segment against the tail and the segments closed before it.
  const closed: Rendered[] = [...(options.neighbours ?? [])];
  const copied = new Set<number>();
  const copies = (n: number, text: string): boolean => {
    if (options.neighbours === undefined) return false;
    const src = source.get(n) ?? '';
    if (copiesNeighbour(src, text, closed)) return true;
    closed.push({ source: src, translation: text });
    return false;
  };
  const parser = new SegParser([...idOf.keys()], {
    grammar: chunk.grammar,
    ...(chunk.nonce === undefined ? {} : { nonce: chunk.nonce }),
    onPartial: (n, text) => {
      if (!shown.has(n)) pending.push({ type: 'segment.partial', id: idOf.get(n) ?? '', text });
    },
    onFinal: (n, text) => {
      if (copies(n, text.trim())) copied.add(n);
      else if (emitFinals) pending.push(final(idOf.get(n) ?? '', text.trim(), attempt, options));
    },
  });
  // A stream that ends in an error, or with no terminal event, was cut: its open segment is not accepted.
  let stopReason: StopReason = 'max_tokens';
  let error: LLMError | undefined;
  for await (const event of lean ? call(chunk, attempt, undefined, true) : call(chunk, attempt)) {
    if (event.type === 'text') parser.push(event.delta);
    else if (event.type === 'usage') {
      pending.push({
        type: 'usage',
        role: options.role,
        model: options.producedBy.model,
        ...clientOf(options),
        input: event.input,
        output: event.output,
        ...(event.cachedInput === undefined ? {} : { cachedInput: event.cachedInput }),
      });
    } else if (event.type === 'done') stopReason = event.stopReason;
    else error = event.error;
    yield* pending.splice(0);
  }
  const result = parser.end(stopReason);
  yield* pending.splice(0);
  const plan = planRepair(result, source, {
    ...(options.mergeFactor === undefined ? {} : { mergeFactor: options.mergeFactor }),
    ...(options.disable === undefined ? {} : { disable: options.disable }),
  });
  const bad = new Set([...plan.rerequest, ...copied]);
  const accepted = new Map<number, string>();
  for (const [n, text] of result.segs) if (!bad.has(n)) accepted.set(n, text.trim());
  return { result, plan, accepted, ...(copied.size ? { copied: [...copied] } : {}), ...(error === undefined ? {} : { error }) };
}

function clientOf(options: TranslateChunkOptions): { client?: string } {
  const id = options.clientId?.();
  return id === undefined ? {} : { client: id };
}

function final(id: string, text: string, attempt: number, options: TranslateChunkOptions): EngineEvent {
  return {
    type: 'segment.final',
    id,
    text,
    revision: options.revision,
    // A copy: the model is read now (a fallback chain may have moved it, single-pass.ts producedByOf).
    producedBy: { ...options.producedBy },
    ...(attempt > 1 ? { attempt } : {}),
  };
}

export function translateChunk(chunk: WireChunk, call: ChunkCall, options: TranslateChunkOptions): AsyncGenerator<EngineEvent, ChunkReport> {
  return translateChunkWith(chunk, call, options);
}

/** The `first` of a chunk split before anything was sent (its parts' calls are under `split`). */
const NOT_SENT: CallReport = {
  result: { strict: true, segs: new Map(), missing: [], cut: null, fixes: [], stray: '', stopReason: 'end' },
  plan: { rerequest: [], ambiguous: false, merged: [], empty: [], truncated: [], tagMismatch: [], cut: null },
};

const sourceTokens = (entries: readonly WireSegment[]) => entries.reduce((n, e) => n + estimateTokens(e.segment.inlineMarkup), 0);

/** Consecutive groups of at most `maxTokens` source tokens each (a segment larger than that alone). */
function splitByTokens(entries: readonly WireSegment[], maxTokens: number): WireSegment[][] {
  const groups: WireSegment[][] = [];
  let group: WireSegment[] = [];
  let size = 0;
  for (const e of entries) {
    const t = estimateTokens(e.segment.inlineMarkup);
    if (group.length > 0 && size + t > maxTokens) {
      groups.push(group);
      group = [];
      size = 0;
    }
    group.push(e);
    size += t;
  }
  if (group.length > 0) groups.push(group);
  return groups;
}

/** Each group as a chunk of its own, the reports gathered under `report.split`. */
async function* runSplit(groups: readonly WireSegment[][], call: ChunkCall, options: TranslateChunkTestOptions, report: ChunkReport): AsyncGenerator<EngineEvent, ChunkReport> {
  report.split = [];
  for (const part of groups) {
    const sub = yield* translateChunkWith(toWire(part), call, options);
    report.split.push(sub);
    report.failed.push(...sub.failed);
  }
  return report;
}

export async function* translateChunkWith(chunk: WireChunk, call: ChunkCall, options: TranslateChunkTestOptions): AsyncGenerator<EngineEvent, ChunkReport> {
  // The job already learned that calls this large are too long for the model: split up front.
  const limit = options.shrink?.maxTokens;
  if (limit !== undefined && chunk.segments.length > 1 && sourceTokens(chunk.segments) > limit) {
    const groups = splitByTokens(chunk.segments, limit);
    if (groups.length > 1) return yield* runSplit(groups, call, options, { first: NOT_SENT, failed: [] });
  }
  let first = yield* runCall(chunk, 1, call, options, true);
  if (first.error?.kind === 'context_length' && chunk.segments.length === 1 && first.accepted.size === 0) {
    // One segment too long with its context: once more without the `<context>` block.
    first = yield* runCall(chunk, 1, call, options, true, new Set(), true);
  }
  const report: ChunkReport = { first: strip(first), failed: [] };
  const fail = function* (entries: readonly WireSegment[], error: LLMError): Generator<EngineEvent> {
    for (const e of entries) {
      report.failed.push(e.segment.id);
      yield { type: 'segment.failed', id: e.segment.id, error };
    }
  };
  // Without accepted text: re-requested by the plan, or never closed before a stream error.
  const todo = chunk.segments.filter((e) => !first.accepted.has(e.n));
  if (todo.length === 0) return report;
  if (first.error?.kind === 'context_length' && todo.length > 1) {
    // Remembered for the job's later chunks (they start at this size), never grown back.
    if (options.shrink) options.shrink.maxTokens = Math.min(options.shrink.maxTokens ?? Infinity, Math.max(1, Math.floor(sourceTokens(todo) / 2)));
    const half = Math.ceil(todo.length / 2);
    return yield* runSplit([todo.slice(0, half), todo.slice(half)], call, options, report);
  }
  if (first.error !== undefined) {
    yield* fail(todo, first.error);
    return report;
  }
  if (options.exhausted?.() === true) {
    yield* fail(todo, { kind: 'unknown', message: BUDGET_MESSAGE });
    return report;
  }
  // The repair may not copy the first pass's accepted segments either.
  const accepted = chunk.segments.flatMap((e) => (first.accepted.has(e.n) ? [{ source: e.segment.inlineMarkup, translation: first.accepted.get(e.n) ?? '' }] : []));
  const repairOptions = options.neighbours === undefined ? options : { ...options, neighbours: [...options.neighbours, ...accepted] };
  const repair = yield* runCall(toWire(todo), 2, call, repairOptions, false, new Set(first.result.segs.keys()));
  report.repair = strip(repair);
  const lost: WireSegment[] = [];
  for (const e of todo) {
    const text = repair.accepted.get(e.n);
    if (text === undefined) lost.push(e);
    else yield final(e.segment.id, text, 2, options);
  }
  const error: LLMError = repair.error ?? { kind: 'unknown', message: UNREADABLE_MESSAGE, raw: { first: first.plan, repair: repair.plan } };
  yield* fail(lost, error);
  return report;
}

/** What one re-request (the check stage's, stages/check.ts) brought back. */
export interface RerequestResult {
  /** Wire ids the parser accepted (repair plan clean) → trimmed text. */
  accepted: Map<number, string>;
  report: CallReport;
  error?: LLMError;
}

/**
 * One call with only `chunk`'s segments (their original wire ids), parsed and planned like a
 * repair: no finals, no partials (the segments are already shown), usage passed on. The caller
 * decides what to accept. `attempt` goes to `call` (above 1: the base thinking setting).
 */
export async function* rerequestSegments(chunk: WireChunk, call: ChunkCall, options: TranslateChunkOptions, attempt: number): AsyncGenerator<EngineEvent, RerequestResult> {
  // No copy guard here: the caller checks the texts against their neighbours itself.
  const plain: TranslateChunkOptions = { producedBy: options.producedBy, revision: options.revision, role: options.role, ...(options.clientId === undefined ? {} : { clientId: options.clientId }) };
  const out = yield* runCall(chunk, attempt, call, plain, false, new Set(chunk.segments.map((e) => e.n)));
  return { accepted: out.accepted, report: strip(out), ...(out.error === undefined ? {} : { error: out.error }) };
}

function strip(outcome: CallOutcome): CallReport {
  return { result: outcome.result, plan: outcome.plan, ...(outcome.copied === undefined ? {} : { copied: outcome.copied }), ...(outcome.error === undefined ? {} : { error: outcome.error }) };
}
