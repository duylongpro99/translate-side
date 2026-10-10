// The `check` stage (DESIGN.md §5.6 "Validation", §5.7 Step 4; plan M2-E4, user decision M2-D19):
// the last stage of every strategy. It gets the translate stage's chunk outcomes and
//   1. fails any segment that was sent but came back neither final nor failed (should not happen);
//   2. checks every final against its source (check/checks.ts): markers, code spans, URLs,
//      numbers, length, script, and the neighbour-duplicate check over the document in page order.
//      The text checked is the latest final in working memory, so contextual's revision 2 of
//      chunk 0 (M2-D17) is what is checked where it replaced revision 1;
//   3. re-requests the failing segments once, in one call per chunk, through the chunk's own
//      prompt (the translate stage's call, single-pass.ts prepareChunk) with only those segments,
//      as the parser's repair does (decision S2), followed by the earlier answer and, per segment,
//      what to fix (checks.ts fixesFor: the code spans, links, URLs and numbers by name; round 4). A text that comes back and passes every check
//      replaces the shown one in place: the same revision, one attempt higher (§5.2);
//   4. fails the rest: `segment.failed` with CHECK_MESSAGE, or the call's own error when the
//      re-request failed as a call; either way `raw` is a CheckFailedRaw (`reason: 'check'`, the
//      checks failed), the marker M3's inline retry keys on (review D-N1). The event names the
//      revision it condemns, so the panel replaces that text even when it is a revision 2 (review
//      D-B1). A failed text is no "last good revision" (§5.6), so it leaves working memory.
// The re-request is one call with one attempt number, one above the highest of its segments; the
// finals it confirms carry that same number (review D-N2).
// No re-request once the job's budget is exhausted (§5.6): the failing segments fail at once.
// Re-requests of different chunks run at once, up to the job's maxConcurrency.

import type { LLMError } from '../../llm/types.ts';
import { checkDuplicates, checkSegment, DUPLICATE_WINDOW, fixesFor, fixesMessage, type CheckFailure, type CheckedSegment } from '../check/checks.ts';
import { copiesNeighbour } from '../parsing/duplicate.ts';
import { rerequestSegments, type ChunkCall } from '../parsing/translate-chunk.ts';
import { formatAnswer, toWire, type WireSegment } from '../parsing/wire.ts';
import { defineStage, multiplex, type AnyStage } from '../runner.ts';
import { producedByOf } from '../served.ts';
import type { EngineEvent, Segment, StageContext } from '../types.ts';
import type { CheckSummary, ChunkOutcome, ChunkWork } from '../strategies/single-pass.ts';

export const UNCHECKED_MESSAGE = 'The segment was neither translated nor reported failed';
/** A translation that failed the post-checks twice (raw: `{ checks, after? }`). */
export const CHECK_MESSAGE = 'The translation failed the quality checks (markers, code, links, numbers or length)';

/** `LLMError.raw` of every failure the check stage sends (review D-N1). */
export interface CheckFailedRaw {
  reason: 'check';
  /**
   * What became of the re-request: its text failed the checks again (`after`), it did not return
   * the segment, the call failed (the event's error is the call's; its raw is `cause`), or none was
   * made because the budget was spent.
   */
  outcome: 'failed-again' | 'not-returned' | 'call-failed' | 'budget';
  /** The checks the shown text failed, which caused the re-request. */
  checks: CheckFailure[];
  after?: CheckFailure[];
  cause?: unknown;
}

/** The check stage's details of `error`, when it is a check failure. */
export function checkFailure(error: LLMError): CheckFailedRaw | undefined {
  const raw = error.raw as Partial<CheckFailedRaw> | undefined;
  return raw !== null && typeof raw === 'object' && raw.reason === 'check' ? (raw as CheckFailedRaw) : undefined;
}

/** How the check stage reaches a chunk's translate call (the strategy's translate stage builds it). */
export type PrepareCall = (work: ChunkWork, ctx: StageContext) => Promise<{ readonly model: string; readonly clientId?: string | undefined; call: ChunkCall }>;

interface Row extends CheckedSegment {
  segment: Segment;
  /** Wire id of the segment in its chunk (1-based). */
  n: number;
  revision: number;
  attempt: number;
  outcome: ChunkOutcome;
}

export function createCheckStage(strategyId: string, prepare: PrepareCall): AnyStage {
  return defineStage<ChunkOutcome[], CheckSummary>({
    id: 'check',
    scope: 'document',
    async *run(unordered, ctx) {
      // Page order: a re-cut (M3 dogfood B5) appends its chunks after the ones first cut, so the
      // outcomes come in run order; the rows and checkDuplicates below read them in page order.
      const page = new Map(unordered.find((o) => o.work !== undefined)?.work?.doc.segments.map((s, i) => [s.id, i]) ?? []);
      const at = (o: ChunkOutcome) => page.get(o.ids[0] ?? '') ?? Number.MAX_SAFE_INTEGER;
      const outcomes = [...unordered].sort((a, b) => at(a) - at(b));
      const summary: CheckSummary = { segments: 0, final: 0, failed: 0, unaccounted: [], rerequested: {}, repaired: 0, checkFailed: [] };
      // 1. Count: every segment sent is final or failed.
      for (const o of outcomes) {
        const done = new Set([...o.final, ...o.failed]);
        summary.segments += o.ids.length;
        summary.final += o.final.length;
        summary.failed += o.failed.length;
        for (const id of o.ids) {
          if (done.has(id)) continue;
          summary.unaccounted.push(id);
          summary.failed++;
          yield { type: 'segment.failed', id, error: { kind: 'unknown', message: UNCHECKED_MESSAGE } };
        }
      }
      // 2. The finals in page order, each with its latest text.
      const rows: Row[] = [];
      for (const o of outcomes) {
        if (o.work === undefined) continue;
        const final = new Set(o.final);
        o.work.chunk.segments.forEach((segment, i) => {
          const t = ctx.memory.translated.get(segment.id);
          if (!final.has(segment.id) || t === undefined) return;
          rows.push({ id: segment.id, source: segment.inlineMarkup, translation: t.text, segment, n: i + 1, revision: t.revision, attempt: t.attempt ?? 1, outcome: o });
        });
      }
      const targetLang = outcomes.find((o) => o.work !== undefined)?.work?.doc.targetLang ?? '';
      const failing = new Map<string, CheckFailure[]>();
      for (const r of rows) {
        const f = checkSegment(r.source, r.translation, targetLang);
        if (f.length) failing.set(r.id, f);
      }
      for (const [id, f] of checkDuplicates(rows)) failing.set(id, [...(failing.get(id) ?? []), f]);
      for (const f of failing.values()) for (const c of f) summary.rerequested[c.kind] = (summary.rerequested[c.kind] ?? 0) + 1;
      if (failing.size === 0) {
        yield summary;
        return;
      }
      // 3. One re-request per chunk with failing segments.
      const byChunk = new Map<ChunkOutcome, Row[]>();
      for (const r of rows) if (failing.has(r.id)) byChunk.set(r.outcome, [...(byChunk.get(r.outcome) ?? []), r]);
      const position = new Map(rows.map((r, i) => [r.id, i]));
      const groups = [...byChunk.values()];
      const concurrency = Math.max(1, Math.floor(groups[0]?.[0]?.outcome.work?.options.maxConcurrency ?? 1));
      const fail = (r: Row, error: LLMError): EngineEvent => {
        summary.checkFailed.push(r.id);
        summary.final--;
        summary.failed++;
        // Not a last good revision (§5.6); the engine recorded it as final.
        const t = ctx.memory.translated.get(r.id);
        if (t !== undefined && t.revision === r.revision) ctx.memory.translated.delete(r.id);
        return { type: 'segment.failed', id: r.id, error, revision: r.revision };
      };
      async function* recheck(group: Row[]): AsyncGenerator<EngineEvent> {
        const work = group[0]?.outcome.work;
        if (work === undefined) return;
        const raw = (r: Row, outcome: CheckFailedRaw['outcome'], more: Partial<CheckFailedRaw> = {}): CheckFailedRaw => ({ reason: 'check', outcome, checks: failing.get(r.id) ?? [], ...more });
        if (ctx.budget.exhausted()) {
          for (const r of group) yield fail(r, { kind: 'unknown', message: CHECK_MESSAGE, raw: raw(r, 'budget') });
          return;
        }
        const prepared = await prepare(work, ctx);
        const { call } = prepared;
        const producedBy = producedByOf(strategyId, 'check', prepared);
        const wire = toWire(group.map((r): WireSegment => ({ n: r.n, segment: r.segment })));
        const attempt = Math.max(...group.map((r) => r.attempt)) + 1;
        // No finals come from the call itself (they are checked below), so its `revision` is unused.
        const byN = new Map(group.map((r) => [r.n, r]));
        const followUp = {
          answer: formatAnswer(wire, (e) => byN.get(e.n)?.translation ?? ''),
          fixes: fixesMessage(group.map((r) => ({ n: r.n, fixes: fixesFor(r.source, r.translation, failing.get(r.id) ?? []) }))),
        };
        const result = yield* rerequestSegments(wire, (c, a) => call(c, a, followUp), { producedBy, revision: 1, role: 'translate', clientId: () => prepared.clientId }, attempt);
        for (const r of group) {
          const text = result.accepted.get(r.n);
          if (text === undefined) {
            const e = result.error;
            yield fail(r, e === undefined ? { kind: 'unknown', message: CHECK_MESSAGE, raw: raw(r, 'not-returned') } : { ...e, raw: raw(r, 'call-failed', e.raw === undefined ? {} : { cause: e.raw }) });
            continue;
          }
          const after = checkSegment(r.source, text, targetLang);
          // The duplicate check again, against the texts before it as they are now.
          const at = position.get(r.id) ?? 0;
          const before = rows.slice(Math.max(0, at - DUPLICATE_WINDOW), at);
          if (copiesNeighbour(r.source, text, before)) after.push({ kind: 'duplicate', detail: 'copies a neighbouring translation' });
          if (after.length) {
            yield fail(r, { kind: 'unknown', message: CHECK_MESSAGE, raw: raw(r, 'failed-again', { after }) });
            continue;
          }
          r.translation = text;
          summary.repaired++;
          yield { type: 'segment.final', id: r.id, text, revision: r.revision, producedBy: { ...producedBy }, attempt };
        }
      }
      for await (const { value } of multiplex(groups, concurrency, recheck, ctx.signal)) yield value as EngineEvent;
      yield summary;
    },
  });
}
