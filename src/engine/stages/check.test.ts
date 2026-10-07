import { describe, expect, it } from 'vitest';
import type { LLMClient } from '../../llm/types.ts';
import { BUDGET_MESSAGE } from '../budget.ts';
import { createEngine, type EngineDeps } from '../engine.ts';
import { createDefaultPromptRegistry } from '../prompts/index.ts';
import { defineStage, defineStrategy } from '../runner.ts';
import { CHECK_MESSAGE, SINGLE_PASS_STAGES, singlePass, type CheckSummary } from '../strategies/single-pass.ts';
import { createContextual } from '../strategies/contextual.ts';
import { fakeSleep, renderLines, success, fakeClient, translatorClient, wireLines, type FakeClient } from '../testing.ts';
import type { EngineEvent, Segment, TranslationJob, WorkingMemory } from '../types.ts';

const seg = (id: string, markup: string, over: Partial<Segment> = {}): Segment => ({ id, kind: 'p', text: markup, inlineMarkup: markup, domPath: `p[${id}]`, translate: true, ...over });

const SOURCES = [
  seg('a', 'Add the `futures` crate to your `Cargo.toml` before you start.'),
  seg('b', 'Read [link]the guide[/link] at https://rust-lang.github.io/async-book/ first.'),
  seg('c', 'It took 3.5 seconds to run 1,000 tasks on the executor.'),
];

/** A good Vietnamese-ish rendering of each source above (markers, URL and numbers kept). */
const GOOD: Record<string, string> = {
  a: 'Thêm crate `futures` vào `Cargo.toml` của bạn trước khi bắt đầu.',
  b: 'Hãy đọc [link]hướng dẫn[/link] tại https://rust-lang.github.io/async-book/ trước.',
  c: 'Mất 3,5 giây để chạy 1.000 tác vụ trên executor.',
};
const BAD: Record<string, string> = {
  a: 'Thêm crate futures vào Cargo.toml của bạn trước khi bắt đầu.',
  b: 'Hãy đọc hướng dẫn trước.',
  c: 'Mất vài giây để chạy một nghìn tác vụ trên executor.',
};

function job(segments: Segment[], over: Partial<TranslationJob['options']> = {}, strategy = 'single-pass'): TranslationJob {
  return {
    doc: { url: 'https://example.com', title: 'T', sourceLang: 'en', targetLang: 'vi', outline: [], segments },
    priority: [],
    strategy,
    options: { style: 'natural', glossary: [], maxConcurrency: 2, chunkTokens: 1200, ...over },
  };
}

function deps(client: LLMClient, over: Partial<EngineDeps> = {}): EngineDeps {
  return { llm: () => client, now: () => 0, sleep: fakeSleep(), strategies: [singlePass], prompts: createDefaultPromptRegistry(), random: () => 0, ...over };
}

async function collect(stream: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const finals = (events: EngineEvent[]) => events.flatMap((e) => (e.type === 'segment.final' ? [[e.id, e.text, e.attempt ?? 1, e.producedBy.stage] as const] : []));
const failures = (events: EngineEvent[]) => events.flatMap((e) => (e.type === 'segment.failed' ? [e] : []));
const sentIds = (client: FakeClient, call: number) => wireLines(client.requests[call]?.messages.at(-1)?.content ?? '').map((l) => l.n);
const byIndex = (segments: readonly Segment[]) => (n: number) => segments[n - 1]?.id ?? '';

/** Answers call `k` with `answers[k-1]` per segment id (the last one repeats), GOOD by default. */
function scripted(segments: readonly Segment[], answers: Record<string, string>[]): FakeClient {
  const idOf = byIndex(segments);
  return translatorClient((lines, call) => renderLines(lines, (_s, n) => (answers[Math.min(call, answers.length) - 1] ?? {})[idOf(n)] ?? GOOD[idOf(n)] ?? `vi:${_s}`));
}

/** The engine with single-pass whose check summary is captured. */
async function runWithSummary(j: TranslationJob, client: LLMClient): Promise<{ events: EngineEvent[]; summary?: CheckSummary; memory?: WorkingMemory['translated'] }> {
  let summary: CheckSummary | undefined;
  let memory: WorkingMemory['translated'] | undefined;
  const probe = defineStage<CheckSummary, never>({
    id: 'probe',
    scope: 'document',
    async *run(s, ctx) {
      summary = s;
      memory = new Map(ctx.memory.translated);
      yield* [];
    },
  });
  const strategy = defineStrategy({ id: 'single-pass', version: 1, stages: [...SINGLE_PASS_STAGES, probe] });
  const events = await collect(createEngine(deps(client, { strategies: [strategy] })).translate(j, new AbortController().signal));
  return { events, ...(summary ? { summary } : {}), ...(memory ? { memory } : {}) };
}

describe('check stage: re-request once, then segment.failed (M2-E4)', () => {
  it('passes clean finals without a call', async () => {
    const client = scripted(SOURCES, [{}]);
    const { events, summary } = await runWithSummary(job(SOURCES), client);
    expect(client.requests).toHaveLength(1);
    expect(summary).toEqual({ segments: 3, final: 3, failed: 0, unaccounted: [], rerequested: {}, repaired: 0, checkFailed: [] });
    expect(failures(events)).toEqual([]);
  });

  it('re-requests only the failing segments, in one call with their wire ids, and replaces them in place (same revision, attempt 2)', async () => {
    const client = scripted(SOURCES, [{ a: BAD.a ?? '', c: BAD.c ?? '' }, {}]);
    const { events, summary, memory } = await runWithSummary(job(SOURCES), client);
    expect(client.requests).toHaveLength(2);
    expect(sentIds(client, 1)).toEqual([1, 3]);
    // The re-request is a repair: the base thinking setting, the same system prompt.
    expect(client.requests[1]?.baseReasoning).toBe(true);
    expect(client.requests[1]?.system).toBe(client.requests[0]?.system);
    expect(finals(events)).toEqual([
      ['a', BAD.a, 1, 'translate'],
      ['b', GOOD.b, 1, 'translate'],
      ['c', BAD.c, 1, 'translate'],
      ['a', GOOD.a, 2, 'check'],
      ['c', GOOD.c, 2, 'check'],
    ]);
    expect(events.filter((e) => e.type === 'segment.final' && e.attempt === 2).every((e) => e.type === 'segment.final' && e.revision === 1)).toBe(true);
    expect(failures(events)).toEqual([]);
    expect(summary).toMatchObject({ final: 3, failed: 0, rerequested: { markers: 1, code: 1, number: 1 }, repaired: 2, checkFailed: [] });
    expect(memory?.get('a')).toEqual({ text: GOOD.a, revision: 1, attempt: 2 });
    // The re-request's usage is passed on.
    expect(events.filter((e) => e.type === 'usage')).toHaveLength(2);
  });

  it('fails a segment that fails again, with CHECK_MESSAGE and the checks in raw; it leaves working memory', async () => {
    const client = scripted(SOURCES, [{ b: BAD.b ?? '' }]);
    const { events, summary, memory } = await runWithSummary(job(SOURCES), client);
    expect(client.requests).toHaveLength(2);
    const [f] = failures(events);
    expect(f?.id).toBe('b');
    expect(f?.error.kind).toBe('unknown');
    expect(f?.error.message).toBe(CHECK_MESSAGE);
    expect(f?.error.raw).toMatchObject({ checks: [{ kind: 'markers' }, { kind: 'url' }], after: [{ kind: 'markers' }, { kind: 'url' }] });
    expect(summary).toMatchObject({ final: 2, failed: 1, repaired: 0, checkFailed: ['b'] });
    expect(memory?.has('b')).toBe(false);
  });

  it('fails a segment the re-request did not return', async () => {
    const idOf = byIndex(SOURCES);
    const client = translatorClient((lines, call) => (call === 1 ? renderLines(lines, (_s, n) => (idOf(n) === 'c' ? (BAD.c ?? '') : (GOOD[idOf(n)] ?? ''))) : ''));
    const { events } = await runWithSummary(job(SOURCES), client);
    expect(failures(events).map((e) => [e.id, e.error.message, (e.error.raw as { after?: unknown }).after])).toEqual([['c', CHECK_MESSAGE, 'not returned']]);
  });

  it('fails with the call\'s own error when the re-request fails as a call', async () => {
    const idOf = byIndex(SOURCES);
    const first = translatorClient((lines) => renderLines(lines, (_s, n) => (idOf(n) === 'a' ? (BAD.a ?? '') : (GOOD[idOf(n)] ?? ''))));
    const client: FakeClient = {
      ...first,
      async *stream(req) {
        if (first.requests.length === 0) {
          yield* first.stream(req);
          return;
        }
        first.requests.push(req);
        yield { type: 'error', error: { kind: 'auth', status: 401, message: 'bad key' } };
      },
    };
    const { events } = await runWithSummary(job(SOURCES), client);
    expect(failures(events).map((e) => [e.id, e.error.kind])).toEqual([['a', 'auth']]);
  });

  it('a segment the parser already repaired (attempt 2) comes back from the check as attempt 3', async () => {
    let call = 0;
    const idOf = byIndex(SOURCES);
    const client = translatorClient((lines) => {
      call++;
      // Call 1 drops segment 2 (the parser re-requests it), call 2 brings it back without its link, call 3 fixes it.
      if (call === 1) return renderLines(lines.filter((l) => l.n !== 2), (_s, n) => GOOD[idOf(n)] ?? '');
      return renderLines(lines, (_s, n) => (call === 2 ? (BAD[idOf(n)] ?? '') : (GOOD[idOf(n)] ?? '')));
    });
    const { events } = await runWithSummary(job(SOURCES), client);
    expect(finals(events).filter((e) => e[0] === 'b').map((e) => [e[2], e[3]])).toEqual([
      [2, 'translate'],
      [3, 'check'],
    ]);
    expect(failures(events)).toEqual([]);
  });

  it('makes one re-request per chunk with failing segments', async () => {
    const long = (id: string, url: string) => seg(id, `See ${url} for more. ${'word '.repeat(220).trim()}`);
    const segments = [long('p0', 'https://a.example/0'), long('p1', 'https://a.example/1'), long('p2', 'https://a.example/2')];
    const bad = (s: string) => s.replace(/https:\/\/\S+/, 'there');
    const client = translatorClient((lines, call) => renderLines(lines, (s) => (call <= 4 && !s.includes('/1 ') ? `vi:${bad(s)}` : `vi:${s}`)), { deltaSize: 400 });
    const events = await collect(createEngine(deps(client)).translate(job(segments, { chunkTokens: 300, maxConcurrency: 1 }), new AbortController().signal));
    const translate = 3;
    expect(client.requests.map((r) => wireLines(r.messages.at(-1)?.content ?? '').length)).toEqual([1, 1, 1, 1, 1]);
    // After the translate calls, two re-requests, each with its chunk's own segment.
    expect(client.requests.slice(translate).map((r) => wireLines(r.messages.at(-1)?.content ?? '').map((l) => l.source.slice(0, 25)))).toEqual([['See https://a.example/0 f'], ['See https://a.example/2 f']]);
    expect(failures(events).map((e) => e.id)).toEqual(['p0']);
    expect(finals(events).filter((e) => e[3] === 'check').map((e) => e[0])).toEqual(['p2']);
  });

  it('does not re-request once the budget is exhausted: the failing segments fail at once', async () => {
    const client = scripted(SOURCES, [{ a: BAD.a ?? '' }]);
    const { events } = await runWithSummary(job(SOURCES, { budget: { maxTokens: 10 } }), client);
    expect(client.requests).toHaveLength(1);
    const [f] = failures(events);
    expect([f?.id, f?.error.message, (f?.error.raw as { budget?: boolean }).budget]).toEqual(['a', CHECK_MESSAGE, true]);
  });

  it('the neighbour-duplicate check runs over the document (M2-D19): a copy of the segment before it is re-requested', async () => {
    const segments = [seg('x', 'Ownership is a set of rules that govern how a Rust program manages memory.'), seg('y', 'Some languages have garbage collection that regularly looks for no-longer-used memory.')];
    const same = 'Quyền sở hữu là một tập hợp quy tắc chi phối cách chương trình Rust quản lý bộ nhớ.';
    const client = translatorClient((lines, call) => renderLines(lines, (s, n) => (call === 1 || n === 1 ? same : `vi:${s}`)));
    const { events, summary } = await runWithSummary(job(segments), client);
    expect(sentIds(client, 1)).toEqual([2]);
    expect(summary?.rerequested).toEqual({ duplicate: 1 });
    expect(failures(events)).toEqual([]);
  });

  it('checks contextual\'s revision 2 of chunk 0 where it stands, and repairs it as revision 2', async () => {
    const long = (i: number) => seg(`p${i}`, `P${i} see https://a.example/${i} ${'word '.repeat(300).trim()}`);
    const segments = Array.from({ length: 3 }, (_, i) => long(i));
    let p0Calls = 0;
    const translate = translatorClient((lines) => {
      const isP0 = lines[0]?.source.startsWith('P0') === true;
      if (isP0) p0Calls++;
      // Revision 1 and revision 2 of chunk 0 both drop the URL (so revision 2 is no regression and stands); the check's call keeps it.
      return renderLines(lines, (s) => (isP0 && p0Calls <= 2 ? `vi:${s.replace(/https:\/\/\S+/, 'đây')}` : `vi:${s}`));
    });
    const brief = { genre: 'g', audience: 'a', purpose: 'p', tone: 't', glossary: [] };
    const engine = createEngine({ llm: (role) => (role === 'analyze' ? fakeClient([success(JSON.stringify(brief))]) : translate), now: () => 0, sleep: fakeSleep(), strategies: [createContextual()], prompts: createDefaultPromptRegistry(), random: () => 0 });
    const events = await collect(engine.translate(job(segments, { chunkTokens: 500 }, 'contextual'), new AbortController().signal));
    expect(p0Calls).toBe(3);
    const p0 = events.flatMap((e) => (e.type === 'segment.final' && e.id === 'p0' ? [[e.revision, e.attempt ?? 1, e.producedBy.stage]] : []));
    expect(p0).toEqual([
      [1, 1, 'translate'],
      [2, 1, 'translate'],
      [2, 2, 'check'],
    ]);
    expect(failures(events)).toEqual([]);
  });
});

describe('budget v0 (M2-E7): stages check ctx.budget before each model call', () => {
  it('the translate stage fails every segment with BUDGET_MESSAGE once the budget is spent, making no call', async () => {
    const long = (i: number) => seg(`p${i}`, `P${i} ${'word '.repeat(300).trim()}`);
    const segments = Array.from({ length: 3 }, (_, i) => long(i));
    const client = translatorClient(undefined, { deltaSize: 400 });
    // Each call reports 10 + 5 tokens per segment: the first chunk spends the 15-token budget.
    const events = await collect(createEngine(deps(client)).translate(job(segments, { chunkTokens: 500, maxConcurrency: 1, budget: { maxTokens: 15 } }), new AbortController().signal));
    expect(client.requests).toHaveLength(1);
    expect(failures(events).map((e) => [e.id, e.error.message])).toEqual([
      ['p1', BUDGET_MESSAGE],
      ['p2', BUDGET_MESSAGE],
    ]);
  });

  it('the parser\'s repair call is skipped once the budget is spent: the segments left fail with BUDGET_MESSAGE', async () => {
    const client = translatorClient((lines) => renderLines(lines.filter((l) => l.n !== 2), (s) => `vi:${s}`));
    const events = await collect(createEngine(deps(client)).translate(job(SOURCES, { budget: { maxTokens: 10 } }), new AbortController().signal));
    expect(client.requests).toHaveLength(1);
    expect(failures(events).map((e) => [e.id, e.error.message])).toEqual([['b', BUDGET_MESSAGE]]);
  });

  it('contextual\'s revise pass makes no call once the budget is spent: revision 1 stays, no failure', async () => {
    const long = (i: number) => seg(`p${i}`, `P${i} ${'word '.repeat(300).trim()}`);
    const segments = Array.from({ length: 2 }, (_, i) => long(i));
    const translate = translatorClient();
    const brief = { genre: 'g', audience: 'a', purpose: 'p', tone: 't', glossary: [] };
    const engine = createEngine({ llm: (role) => (role === 'analyze' ? fakeClient([success(JSON.stringify(brief))]) : translate), now: () => 0, sleep: fakeSleep(), strategies: [createContextual()], prompts: createDefaultPromptRegistry(), random: () => 0 });
    // One slot: chunk 0, then its revise pass, then chunk 1. The brief call (15 tokens) and chunk 0
    // (15) spend the budget: the revise pass makes no call and keeps revision 1 without a failure;
    // chunk 1 is skipped with BUDGET_MESSAGE.
    const events = await collect(engine.translate(job(segments, { chunkTokens: 500, maxConcurrency: 1, budget: { maxTokens: 30 } }, 'contextual'), new AbortController().signal));
    expect(translate.requests).toHaveLength(1);
    expect(events.filter((e) => e.type === 'segment.final' && e.revision === 2)).toEqual([]);
    expect(failures(events).map((e) => [e.id, e.error.message])).toEqual([['p1', BUDGET_MESSAGE]]);
  });
});
