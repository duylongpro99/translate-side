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
//   that call that has no accepted text, with that error.
// Usage from both calls is passed on as `usage` events. An abort propagates as a throw.

import type { LLMError, ModelRole, NormalizedEvent, StopReason } from '../../llm/types.ts';
import type { EngineEvent } from '../types.ts';
import { copiesNeighbour, type Rendered } from './duplicate.ts';
import { planRepair, type RepairPlan, type RepairRule } from './repair.ts';
import { SegParser, type ParseResult } from './seg-parser.ts';
import { toWire, type WireChunk, type WireSegment } from './wire.ts';

/** Sends `chunk` and returns the stream. `attempt` is 1 for the first pass, 2 for the repair. */
export type ChunkCall = (chunk: WireChunk, attempt: number) => AsyncIterable<NormalizedEvent>;

export interface TranslateChunkOptions {
  producedBy: { strategy: string; stage: string; model: string };
  /** Revision of the finals (1 for a draft; refine uses 2). */
  revision: number;
  role: ModelRole;
  mergeFactor?: number;
  /**
   * Turns the copy guard on (the translate stage always does): translated passages before the
   * chunk (the context tail) that no segment may copy, besides the call's own earlier segments.
   */
  neighbours?: readonly Rendered[];
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
  for await (const event of call(chunk, attempt)) {
    if (event.type === 'text') parser.push(event.delta);
    else if (event.type === 'usage') {
      pending.push({
        type: 'usage',
        role: options.role,
        model: options.producedBy.model,
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

function final(id: string, text: string, attempt: number, options: TranslateChunkOptions): EngineEvent {
  return {
    type: 'segment.final',
    id,
    text,
    revision: options.revision,
    producedBy: options.producedBy,
    ...(attempt > 1 ? { attempt } : {}),
  };
}

export function translateChunk(chunk: WireChunk, call: ChunkCall, options: TranslateChunkOptions): AsyncGenerator<EngineEvent, ChunkReport> {
  return translateChunkWith(chunk, call, options);
}

export async function* translateChunkWith(chunk: WireChunk, call: ChunkCall, options: TranslateChunkTestOptions): AsyncGenerator<EngineEvent, ChunkReport> {
  const first = yield* runCall(chunk, 1, call, options, true);
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
  if (first.error !== undefined) {
    yield* fail(todo, first.error);
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

function strip(outcome: CallOutcome): CallReport {
  return { result: outcome.result, plan: outcome.plan, ...(outcome.copied === undefined ? {} : { copied: outcome.copied }), ...(outcome.error === undefined ? {} : { error: outcome.error }) };
}
