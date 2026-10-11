// `basic` (DESIGN.md §5.3, §4.2.6, plan M5-E7): Chrome's Translator, segment by segment, through
// the MTClient port (StageContext.mt). Literal, free, on the device; no brief, no prompt, no
// markers (it translates a block's plain text). It is the last fallback: the engine switches a
// job to it when its whole provider chain is down (engine.ts), and the panel labels every block it
// produced "basic translation".
//
// Gated by `availability()` (plan §8): a pair the translator can't do fails each block with a
// message that says so, never silently. The §5.6 checks run on each block; a block that fails them
// is reported failed (asking the translator again gives the same text, so there is no re-request).

import type { LLMError } from '../../llm/types.ts';
import { checkSegment } from '../check/checks.ts';
import { CHECK_MESSAGE, type CheckFailedRaw } from '../stages/check.ts';
import type { EngineEvent, Segment, StageContext, Strategy, TranslationJob } from '../types.ts';

export const BASIC_ID = 'basic';
export const BASIC_VERSION = 1;
export const BASIC_STAGE = 'translate';

/** No translator on this device (no MTClient). */
export const BASIC_MISSING_MESSAGE = 'There is no built-in translator here, so there is no basic translation either.';

export const basicUnavailableMessage = (model: string, from: string, to: string): string =>
  `${model} can't translate ${from || 'this language'} → ${to} on this device, so there is no basic translation either.`;

/**
 * `LLMError.raw` of a block the switch could not help (no translator, pair unavailable): the
 * provider's error keeps its kind (the panel handles it as before), and `basic` says why there is
 * no basic translation either, for the panel to show next to its own text for that kind.
 */
export interface NoBasicRaw {
  reason: 'no-basic';
  basic: string;
  /** The provider error's own `raw`. */
  cause?: unknown;
}

/** Why basic could not help with the block that failed on `error`; undefined when it did not try. */
export function noBasicReason(error: LLMError): string | undefined {
  const raw = error.raw as Partial<NoBasicRaw> | undefined;
  return raw?.reason === 'no-basic' && typeof raw.basic === 'string' ? raw.basic : undefined;
}

/** Two messages as sentences: the provider's (which may lack a full stop), then basic's. */
const joined = (first: string, then: string): string => `${first}${/[.!?…]$/.test(first.trim()) ? '' : '.'} ${then}`;

/** The blocks of `segments` still to translate, viewport first (ctx.priority, read before each block). */
function nextOf(todo: Segment[], ctx: StageContext): Segment | undefined {
  const first = new Set(ctx.priority?.() ?? []);
  const i = todo.findIndex((s) => first.has(s.id));
  return todo.splice(i === -1 ? 0 : i, 1)[0];
}

/**
 * Translates `segments` (those with `translate`) with `ctx.mt`, one by one. Shared by the `basic`
 * strategy and the engine's switch to it. `error` (the switch) is prefixed to an unavailable answer,
 * so the reader sees why there is neither translation.
 */
export async function* basicTranslate(segments: readonly Segment[], job: TranslationJob, ctx: StageContext, cause?: LLMError): AsyncGenerator<EngineEvent> {
  const todo = segments.filter((s) => s.translate);
  if (todo.length === 0) return;
  const to = job.doc.targetLang;
  const from = job.doc.sourceLang || ctx.memory.brief?.language || '';
  // Basic can't help at all: after a switch the provider's error stays the reason (its kind, so the
  // panel handles it as before), and the message adds why there is no basic translation either.
  const failAll = function* (message: string): Generator<EngineEvent> {
    const raw: NoBasicRaw = { reason: 'no-basic', basic: message, ...(cause?.raw === undefined ? {} : { cause: cause.raw }) };
    const error: LLMError = cause ? { ...cause, message: joined(cause.message, message), raw } : { kind: 'unknown', message };
    for (const s of todo) yield { type: 'segment.failed', id: s.id, error };
  };
  const mt = ctx.mt;
  if (mt === undefined) {
    yield* failAll(BASIC_MISSING_MESSAGE);
    return;
  }
  if ((await mt.availability(from, to)) === 'unavailable') {
    ctx.signal.throwIfAborted();
    yield* failAll(basicUnavailableMessage(mt.model, from, to));
    return;
  }
  const producedBy = { strategy: BASIC_ID, stage: BASIC_STAGE, model: mt.model };
  for (let s = nextOf(todo, ctx); s !== undefined; s = nextOf(todo, ctx)) {
    ctx.signal.throwIfAborted();
    const result = await mt.translate(s.text, from, to, ctx.signal);
    if (!result.ok) {
      // One block the translator failed on: `unknown`, so the job goes on with the others.
      yield { type: 'segment.failed', id: s.id, error: cause ? { ...result.error, message: joined(cause.message, result.error.message) } : result.error };
      continue;
    }
    const checks = checkSegment(s.text, result.text, to);
    if (checks.length > 0) {
      const raw: CheckFailedRaw = { reason: 'check', outcome: 'no-request', checks };
      yield { type: 'segment.failed', id: s.id, error: { kind: 'unknown', message: CHECK_MESSAGE, raw } };
      continue;
    }
    yield { type: 'segment.final', id: s.id, text: result.text, revision: 1, producedBy };
  }
}

export const basic: Strategy = {
  id: BASIC_ID,
  version: BASIC_VERSION,
  async *run(job, ctx) {
    yield { type: 'stage', stage: BASIC_STAGE, status: 'start' };
    yield* basicTranslate(job.doc.segments, job, ctx);
    yield { type: 'stage', stage: BASIC_STAGE, status: 'done' };
  },
};
