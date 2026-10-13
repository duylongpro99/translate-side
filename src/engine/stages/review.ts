// The `review` stage (DESIGN.md §5.3 `refine`, §5.6): one call per chunk, by the `review` role,
// that sends each segment's source with its draft (the latest text in working memory) and asks
// `review@1` for targeted fixes. The answer lists only the segments the reviewer changed, as
// `<seg id="N">…</seg>`, or `<none/>`; it is parsed with the `<seg>` parser over the ids sent, so an
// unknown id is dropped, a duplicate id keeps its first text and anything outside the tags is
// ignored. A segment the answer does not return is unchanged.
//
// The stage does its own acceptance and never goes through the check stage (stages/check.ts),
// whose failures condemn the shown text: a candidate replaces its draft, as a `segment.final` of
// REVIEWED_REVISION, only when it passes every post-check against the source (check/checks.ts
// checkSegment) and does not copy a neighbouring translation (parsing/duplicate.ts). A rejected
// candidate is not emitted and is not asked for again (it keeps refine's cost at most 2× the
// draft's). Whatever happens, a failed call, an answer that does not parse, an exhausted budget,
// the drafts stay and the stage emits no `segment.failed`. Only an abort stops it.
//
// Budget (§5.6): a call starts only when what is left of the job's tokens, less what the calls in
// flight have reserved, covers this chunk's estimate (input + the call's output cap, with the
// review client's reasoning reserve). The reservation is held until the call is over, by which
// time the engine has recorded its usage.
//
// Each chunk ends with a `chunk` event carrying its ReviewReport.

import type { LLMError, NormalizedRequest, StopReason } from '../../llm/types.ts';
import { maxOutputTokens } from '../budget.ts';
import { checkSegment, DUPLICATE_WINDOW } from '../check/checks.ts';
import type { Chunk } from '../chunker.ts';
import { DEFAULT_GLOSS, neutralizeContextTags, renderSystemPromptV2 } from '../context/assemble.ts';
import { gatherContext } from '../context/budget.ts';
import { copiesNeighbour, type Rendered } from '../parsing/duplicate.ts';
import { parseOutput } from '../parsing/seg-parser.ts';
import { REVIEW_PROMPT_ID } from '../prompts/review.ts';
import { defineStage, type AnyStage } from '../runner.ts';
import { servedOf } from '../served.ts';
import { estimateTokens } from '../tokens.ts';
import type { EngineEvent, JobOptions, ReviewReport, Segment, TranslationJob } from '../types.ts';

/** The revision a review's accepted text is emitted as: above contextual's chunk-0 revise (2). */
export const REVIEWED_REVISION = 3;

export const REVIEW_TEMPERATURE = 0.2;

/** A data-block or `<seg>` tag as `neutralizeContextTags` leaves it in page text (`<` → `‹`). */
const NEUTRALIZED_TAG = /‹\s*\/?\s*(context|source|translation|seg|brief|glossary|review|item)\b/gi;

const neutralizedTags = (text: string): number => text.match(NEUTRALIZED_TAG)?.length ?? 0;

/** One chunk of the review pass: its segments that have a draft, in page order. */
export interface ReviewWork {
  chunk: Chunk;
  doc: TranslationJob['doc'];
  options: JobOptions;
  /** TranslationJob.reviewWanted. */
  reviewWanted?: () => boolean;
}

/** The segments of a review call, each with its local id (1…n) and its draft. */
export interface ReviewItem {
  n: number;
  segment: Segment;
  draft: string;
}

/** The user message: one `<review>` block, page text and drafts neutralised (§8). */
export function reviewInput(items: readonly ReviewItem[]): string {
  const lines = ['<review>'];
  for (const { n, segment, draft } of items) {
    lines.push(`<item id="${n}">`, `<source>${neutralizeContextTags(segment.inlineMarkup)}</source>`, `<translation>${neutralizeContextTags(draft)}</translation>`, '</item>');
  }
  lines.push('</review>');
  return lines.join('\n');
}

/**
 * The reviewer's candidates by local id, trimmed: closed `<seg>` elements with an id that was
 * sent. `<none/>`, text outside the tags, unknown ids and a segment cut by the end of the answer
 * give nothing; of duplicate ids the first wins.
 */
export function parseReview(answer: string, ids: readonly number[], stopReason: StopReason): Map<number, string> {
  const { segs } = parseOutput(answer, ids, stopReason);
  return new Map([...segs].map(([n, text]) => [n, text.trim()]));
}

/**
 * Whether `candidate` may replace the draft of `source`: it passes every post-check against the
 * source, does not copy one of `neighbours`, and holds no more neutralised tags than the source
 * (the reviewer saw `‹seg`, `‹/item`… for the tags in page text; such a text must not reach the
 * page). Other `‹` (French or Swiss quotes) are text.
 */
export function acceptable(source: string, candidate: string, targetLang: string, neighbours: readonly Rendered[]): boolean {
  if (checkSegment(source, candidate, targetLang).length > 0) return false;
  if (neutralizedTags(candidate) > neutralizedTags(source)) return false;
  return !copiesNeighbour(source, candidate, neighbours);
}

/** The translated segments around `id` in page order (DUPLICATE_WINDOW on each side), with their current text. */
function neighboursOf(id: string, page: readonly Segment[], text: (id: string) => string | undefined): Rendered[] {
  const translated = page.flatMap((s) => {
    const t = s.translate ? text(s.id) : undefined;
    return t === undefined ? [] : [{ id: s.id, source: s.inlineMarkup, translation: t }];
  });
  const at = translated.findIndex((r) => r.id === id);
  if (at < 0) return [];
  return [...translated.slice(Math.max(0, at - DUPLICATE_WINDOW), at), ...translated.slice(at + 1, at + 1 + DUPLICATE_WINDOW)].map(({ source, translation }) => ({ source, translation }));
}

/**
 * Which pending review starts next: the chunks after the screen first (what the reader reaches
 * next is refined before it is read), then the chunks before it, the screen last (its text is
 * replaced while it is being read only when nothing else is left), each in page order. Nothing on
 * screen: page order. Re-read each time a slot frees, so a scroll reorders the reviews not started.
 */
export function pickReview(works: readonly ReviewWork[], pending: readonly number[], priority: readonly string[]): number {
  const first = pending[0];
  if (first === undefined) throw new Error('pickReview: nothing pending');
  const page = new Map((works[first]?.doc.segments ?? []).map((s, i) => [s.id, i]));
  const screen = new Set(priority);
  let lastOnScreen = -1;
  for (const id of screen) lastOnScreen = Math.max(lastOnScreen, page.get(id) ?? -1);
  const key = (i: number): [number, number] => {
    const segments = works[i]?.chunk.segments ?? [];
    const at = page.get(segments[0]?.id ?? '') ?? Number.MAX_SAFE_INTEGER;
    if (lastOnScreen < 0) return [0, at];
    if (segments.some((s) => screen.has(s.id))) return [2, at];
    return [at > lastOnScreen ? 0 : 1, at];
  };
  let best = first;
  let bestKey = key(first);
  for (const i of pending) {
    const k = key(i);
    if (k[0] < bestKey[0] || (k[0] === bestKey[0] && k[1] < bestKey[1])) {
      best = i;
      bestKey = k;
    }
  }
  return best;
}

/**
 * The review stage, sending `reviewPrompt`, its finals marked as `strategyId`'s. Make one per
 * job run: the token reservation of the calls in flight lives in it.
 */
export function createReviewStage(reviewPrompt: string = REVIEW_PROMPT_ID, strategyId = 'refine'): AnyStage {
  let reserved = 0;
  return defineStage<ReviewWork, never>({
    id: 'review',
    scope: 'chunk',
    role: 'review',
    promptId: reviewPrompt,
    pick: (works, pending, ctx) => pickReview(works, pending, ctx.priority?.() ?? []),
    // The reader moved on (lazy mode): the reviews not started yet of chunks nobody will look at
    // are dropped. Reviews in flight finish.
    recut(works, pending, ctx) {
      const within = ctx.within?.();
      if (within === undefined) return undefined;
      const left = pending.map((i) => works[i]).filter((w): w is ReviewWork => w !== undefined && w.chunk.segments.some((s) => within.has(s.id)));
      return left.length === pending.length ? undefined : left;
    },
    async *run(work, ctx) {
      const items: ReviewItem[] = [];
      for (const segment of work.chunk.segments) {
        const draft = ctx.memory.translated.get(segment.id)?.text;
        if (draft !== undefined) items.push({ n: items.length + 1, segment, draft });
      }
      const report: ReviewReport = { ids: items.map((i) => i.segment.id), accepted: [], unchanged: [], rejected: [] };
      const done = (): EngineEvent => ({ type: 'chunk', index: work.chunk.index, briefed: ctx.memory.brief !== undefined, review: report });
      if (items.length === 0) {
        yield done();
        return;
      }
      if (work.reviewWanted?.() === false) {
        report.skipped = 'dropped';
        yield done();
        return;
      }
      const client = ctx.llm('review');
      const prompt = ctx.prompts.get(reviewPrompt);
      const { segments, ...doc } = work.doc;
      const snippets = await gatherContext(ctx.context, { doc, chunk: work.chunk.segments, targetLang: doc.targetLang, segments, memory: ctx.memory, options: work.options });
      const sourceLang = doc.sourceLang.trim() || (ctx.memory.brief?.language ?? '');
      // Only the document-scoped snippets go in (brief, glossary): byte-identical for every chunk.
      const system = renderSystemPromptV2((vars) => prompt.render(vars), { sourceLang, targetLang: doc.targetLang, style: work.options.style, gloss: work.options.gloss ?? DEFAULT_GLOSS, snippets });
      const user = reviewInput(items);
      const sourceTokens = items.reduce((n, i) => n + estimateTokens(i.segment.inlineMarkup), 0);
      const maxOut = maxOutputTokens({ sourceTokens, segments: items.length, reasoningReserveTokens: client.reasoningReserveTokens({}) });
      const estimate = estimateTokens(system) + estimateTokens(user) + maxOut;
      // Asked again after the awaits above: the job may have stopped wanting reviews meanwhile.
      // Nothing awaits between these checks and the reservation below.
      if (work.reviewWanted?.() === false) {
        report.skipped = 'dropped';
        yield done();
        return;
      }
      if (ctx.budget.exhausted() || ctx.budget.remainingTokens() - reserved < estimate) {
        report.skipped = 'budget';
        yield done();
        return;
      }
      const req: NormalizedRequest = {
        model: client.model,
        system,
        messages: [{ role: 'user', content: user }],
        maxOutputTokens: maxOut,
        temperature: REVIEW_TEMPERATURE,
        cacheHint: 'system',
        signal: ctx.signal,
      };
      let answer = '';
      let stopReason: StopReason | undefined;
      let error: LLMError | undefined;
      let model = client.model;
      reserved += estimate;
      try {
        for await (const event of client.stream(req)) {
          // The model that answered: a fallback chain may have handed the call on (fallback.ts).
          const by = servedOf(client, req);
          model = by.model;
          if (event.type === 'text') answer += event.delta;
          else if (event.type === 'usage') {
            yield { type: 'usage', role: 'review', model: by.model, ...(by.id === undefined ? {} : { client: by.id }), input: event.input, output: event.output, ...(event.cachedInput === undefined ? {} : { cachedInput: event.cachedInput }) };
          } else if (event.type === 'done') stopReason = event.stopReason;
          else error = event.error;
        }
      } catch (thrown) {
        if (ctx.signal.aborted) throw thrown;
        error = { kind: 'unknown', message: thrown instanceof Error ? thrown.message : String(thrown), raw: thrown };
      } finally {
        // Every usage event of the call was yielded, and so recorded by the engine, before this.
        reserved -= estimate;
      }
      if (error !== undefined || stopReason === undefined) {
        report.skipped = 'error';
        if (error !== undefined) report.error = error.kind;
        yield done();
        return;
      }
      const candidates = parseReview(answer, items.map((i) => i.n), stopReason);
      // Current texts, with this chunk's accepted candidates, for the neighbour check.
      const accepted = new Map<string, string>();
      const current = (id: string) => accepted.get(id) ?? ctx.memory.translated.get(id)?.text;
      const finals: EngineEvent[] = [];
      for (const { n, segment, draft } of items) {
        const candidate = candidates.get(n);
        // The draft given back, also with the page's tags as the reviewer saw them (neutralised).
        if (candidate === undefined || candidate === draft.trim() || candidate === neutralizeContextTags(draft).trim()) {
          report.unchanged.push(segment.id);
          continue;
        }
        if (!acceptable(segment.inlineMarkup, candidate, doc.targetLang, neighboursOf(segment.id, segments, current))) {
          report.rejected.push(segment.id);
          continue;
        }
        accepted.set(segment.id, candidate);
        report.accepted.push(segment.id);
        finals.push({ type: 'segment.final', id: segment.id, text: candidate, revision: REVIEWED_REVISION, producedBy: { strategy: strategyId, stage: 'review', model } });
      }
      yield* finals;
      yield done();
    },
  });
}
