// The `check` stage (DESIGN.md §5.6 "Validation", §5.7 Step 4; plan M2-E4, user decision M2-D19):
// the last stage of every strategy. It gets the translate stage's chunk outcomes and
//   1. fails any segment that was sent but came back neither final nor failed (should not happen);
//   2. checks every final against its source (check/checks.ts): markers, code spans, URLs,
//      numbers, length, script, and the neighbour-duplicate check over the document in page order.
//      The text checked is the latest final in working memory, so contextual's revision 2 of
//      chunk 0 (M2-D17) is what is checked where it replaced revision 1;
//   3. re-requests the failing segments once, in one call per chunk, through the chunk's own
//      prompt (the translate stage's call, single-pass.ts prepareChunk) with only those segments,
//      as the parser's repair does (decision S2). A text that comes back and passes every check
//      replaces the shown one in place: the same revision, one attempt higher (§5.2);
//   4. fails the rest: `segment.failed` with CHECK_MESSAGE (the checks in `raw`), or the call's
//      own error when the re-request failed as a call. A failed text is no "last good revision"
//      (§5.6), so it leaves working memory.
// No re-request once the job's budget is exhausted (§5.6): the failing segments fail at once.
// Re-requests of different chunks run at once, up to the job's maxConcurrency.

import type { LLMError } from '../../llm/types.ts';
import { checkDuplicates, checkSegment, DUPLICATE_WINDOW, type CheckFailure, type CheckedSegment } from '../check/checks.ts';
import { copiesNeighbour } from '../parsing/duplicate.ts';
import { rerequestSegments, type ChunkCall } from '../parsing/translate-chunk.ts';
import { toWire, type WireSegment } from '../parsing/wire.ts';
import { defineStage, multiplex, type AnyStage } from '../runner.ts';
import type { EngineEvent, Segment, StageContext } from '../types.ts';
import type { CheckSummary, ChunkOutcome, ChunkWork } from '../strategies/single-pass.ts';

export const UNCHECKED_MESSAGE = 'The segment was neither translated nor reported failed';
/** A translation that failed the post-checks twice (raw: `{ checks, after? }`). */
export const CHECK_MESSAGE = 'The translation failed the quality checks (markers, code, links, numbers or length)';

/** How the check stage reaches a chunk's translate call (the strategy's translate stage builds it). */
export type PrepareCall = (work: ChunkWork, ctx: StageContext) => Promise<{ model: string; call: ChunkCall }>;

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
    async *run(outcomes, ctx) {
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
        return { type: 'segment.failed', id: r.id, error };
      };
      async function* recheck(group: Row[]): AsyncGenerator<EngineEvent> {
        const work = group[0]?.outcome.work;
        if (work === undefined) return;
        const reasons = (r: Row) => failing.get(r.id) ?? [];
        if (ctx.budget.exhausted()) {
          for (const r of group) yield fail(r, { kind: 'unknown', message: CHECK_MESSAGE, raw: { checks: reasons(r), budget: true } });
          return;
        }
        const { model, call } = await prepare(work, ctx);
        const wire = toWire(group.map((r): WireSegment => ({ n: r.n, segment: r.segment })));
        const attempt = Math.max(...group.map((r) => r.attempt)) + 1;
        const result = yield* rerequestSegments(wire, call, { producedBy: { strategy: strategyId, stage: 'check', model }, revision: 1, role: 'translate' }, attempt);
        for (const r of group) {
          const text = result.accepted.get(r.n);
          if (text === undefined) {
            yield fail(r, result.error ?? { kind: 'unknown', message: CHECK_MESSAGE, raw: { checks: reasons(r), after: 'not returned' } });
            continue;
          }
          const after = checkSegment(r.source, text, targetLang);
          // The duplicate check again, against the texts before it as they are now.
          const at = position.get(r.id) ?? 0;
          const before = rows.slice(Math.max(0, at - DUPLICATE_WINDOW), at);
          if (copiesNeighbour(r.source, text, before)) after.push({ kind: 'duplicate', detail: 'copies a neighbouring translation' });
          if (after.length) {
            yield fail(r, { kind: 'unknown', message: CHECK_MESSAGE, raw: { checks: reasons(r), after } });
            continue;
          }
          r.translation = text;
          summary.repaired++;
          yield { type: 'segment.final', id: r.id, text, revision: r.revision, producedBy: { strategy: strategyId, stage: 'check', model }, attempt: r.attempt + 1 };
        }
      }
      for await (const { value } of multiplex(groups, concurrency, recheck, ctx.signal)) yield value as EngineEvent;
      yield summary;
    },
  });
}
