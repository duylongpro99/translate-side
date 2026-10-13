// What the harness keeps of one document's engine events (run.ts runDoc): the finals by the panel's rule, the
// failures, the tokens by role, the brief, the briefed chunks of the first pass, the chunk-0 revisions and refine's
// review reports. Pure, so the counting rules are unit-tested apart from the live harness.
import { checkSegment, neutralizeContextTags, parseReview, type DocumentBrief, type EngineEvent, type ReviewReport, type Segment } from '@/engine/index';
import type { StopReason } from '@/llm/types';
import type { ReviewCounts } from './runs.ts';

export interface TallyFinal {
  text: string;
  attempt: number;
  revision: number;
  /** The revision-1 text a later revision replaced. */
  draft?: string;
}

export interface DocTally {
  finals: Map<string, TallyFinal>;
  /** Segment id → error, for segments with no final. */
  failed: Map<string, string>;
  usage: { input: number; cachedInput: number; output: number };
  analyzeUsage: { input: number; output: number };
  brief: DocumentBrief | null;
  /** First-pass chunks (by index) that carried the brief. */
  briefedChunks: Set<number>;
  /** Segments the chunk-0 revise pass translated but kept at revision 1. */
  reviseKept: number;
  /** Segments that got a revision 2 (refine may replace it with its review's revision after). */
  revisedIds: Set<string>;
  review: ReviewCounts;
  /** refine's review reports, in arrival order. */
  reviewReports: ReviewReport[];
}

export function newTally(): DocTally {
  return {
    finals: new Map(),
    failed: new Map(),
    usage: { input: 0, cachedInput: 0, output: 0 },
    analyzeUsage: { input: 0, output: 0 },
    brief: null,
    briefedChunks: new Set(),
    reviseKept: 0,
    revisedIds: new Set(),
    review: { chunks: 0, accepted: 0, unchanged: 0, rejected: 0, skipped: 0, input: 0, output: 0 },
    reviewReports: [],
  };
}

/** Folds one engine event into `t`. */
export function tallyEvent(t: DocTally, e: EngineEvent): void {
  if (e.type === 'segment.final') {
    if (e.revision === 2) t.revisedIds.add(e.id);
    // The panel's rule (§5.2): a higher revision wins, then a higher attempt; `draft` keeps the revision-1 text
    // a later revision replaced.
    const cur = t.finals.get(e.id);
    const attempt = e.attempt ?? 1;
    if (cur === undefined || e.revision > cur.revision || (e.revision === cur.revision && attempt > cur.attempt)) {
      const draft = cur === undefined ? undefined : e.revision > cur.revision && cur.revision === 1 ? cur.text : cur.draft;
      t.finals.set(e.id, { text: e.text, attempt, revision: e.revision, ...(draft === undefined ? {} : { draft }) });
    } else if (e.revision < cur.revision && e.revision === 1) {
      // A repaired draft landing after a later revision: kept as the draft, never shown.
      cur.draft = e.text;
    }
    t.failed.delete(e.id);
  } else if (e.type === 'segment.failed') {
    // As in the panel: a failure of the first pass does not undo a later revision; one naming that revision does.
    if ((t.finals.get(e.id)?.revision ?? 1) > (e.revision ?? 1)) return;
    t.failed.set(e.id, `${e.error.kind}: ${e.error.message}`);
    t.finals.delete(e.id);
  } else if (e.type === 'chunk') {
    // Neither the revise pass's report nor a review report is a chunk of the first pass, though both say `briefed`.
    if (e.revise !== undefined) t.reviseKept += e.revise.kept.length;
    else if (e.review !== undefined) {
      // Counted by the report's ids: review chunks are cut from the whole job and their indices may differ from the drafts'.
      t.reviewReports.push(e.review);
      t.review.chunks++;
      t.review.accepted += e.review.accepted.length;
      t.review.unchanged += e.review.unchanged.length;
      t.review.rejected += e.review.rejected.length;
      if (e.review.skipped !== undefined) t.review.skipped += e.review.ids.length;
    } else if (e.briefed) t.briefedChunks.add(e.index);
  } else if (e.type === 'artifact' && e.kind === 'brief') {
    t.brief = e.data as DocumentBrief;
  } else if (e.type === 'usage') {
    if (e.role === 'analyze') {
      t.analyzeUsage.input += e.input;
      t.analyzeUsage.output += e.output;
    } else if (e.role === 'review') {
      t.review.input += e.input;
      t.review.output += e.output;
    }
    t.usage.input += e.input;
    t.usage.cachedInput += e.cachedInput ?? 0;
    t.usage.output += e.output;
  }
}

/** Segments whose final came from the chunk-0 revise pass, including those a review replaced after (the gate checks that pass ran). */
export function revisedCount(t: DocTally): number {
  return [...t.finals].filter(([id, f]) => f.revision === 2 || (f.revision > 2 && t.revisedIds.has(id))).length;
}

/** A recorded review call: its user message, its answer and how it stopped. */
export interface ReviewCall {
  user: string;
  text: string;
  stop?: string | undefined;
}

/**
 * Why the review rejected candidates, by kind: each rejected segment's candidate is read back from the review
 * call whose items are exactly the report's segments, and checked as the review stage checks it. A candidate that
 * passes every post-check was rejected for a page tag it brought back (`tag`) or for copying a neighbour
 * (`duplicate`); `unknown` when the call or the candidate cannot be found. A segment may count under several kinds.
 */
export function rejectedKinds(reports: readonly ReviewReport[], calls: readonly ReviewCall[], segments: readonly Segment[], targetLang: string): Record<string, number> {
  const byId = new Map(segments.map((s) => [s.id, s]));
  const sourcesOf = (user: string): string[] => [...user.matchAll(/<item id="\d+">\n<source>([\s\S]*?)<\/source>/g)].map((m) => m[1] ?? '');
  const out: Record<string, number> = {};
  const add = (k: string) => (out[k] = (out[k] ?? 0) + 1);
  for (const report of reports) {
    if (report.rejected.length === 0) continue;
    const sources = report.ids.map((id) => neutralizeContextTags(byId.get(id)?.inlineMarkup ?? ''));
    const call = calls.find((c) => {
      const got = sourcesOf(c.user);
      return got.length === sources.length && got.every((s, i) => s === sources[i]);
    });
    const candidates = call === undefined ? undefined : parseReview(call.text, report.ids.map((_, i) => i + 1), (call.stop as StopReason | undefined) ?? 'end');
    for (const id of report.rejected) {
      const candidate = candidates?.get(report.ids.indexOf(id) + 1);
      const source = byId.get(id)?.inlineMarkup;
      if (candidate === undefined || source === undefined) {
        add('unknown');
        continue;
      }
      const kinds = checkSegment(source, candidate, targetLang).map((f) => f.kind);
      if (kinds.length) kinds.forEach(add);
      else add(candidate.includes('‹') && !source.includes('‹') ? 'tag' : 'duplicate');
    }
  }
  return out;
}
