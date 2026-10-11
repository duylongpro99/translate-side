import { describe, expect, it } from 'vitest';
import type { LLMClient, LLMError, MTAvailability, MTClient, MTResult } from '../../llm/types.ts';
import { BASIC_SWITCH_STAGE, createEngine, type BasicSwitchInfo, type EngineDeps } from '../engine.ts';
import { createDefaultPromptRegistry } from '../prompts/index.ts';
import { CHECK_MESSAGE, checkFailure } from '../stages/check.ts';
import { failed, fakeClient, fakeSleep, translatorClient } from '../testing.ts';
import type { EngineEvent, Segment, TranslationJob } from '../types.ts';
import { BASIC_ID, BASIC_MISSING_MESSAGE, basic } from './basic.ts';
import { contextual } from './contextual.ts';
import { singlePass } from './single-pass.ts';

const seg = (id: string, text = `Sentence ${id}.`, extra: Partial<Segment> = {}): Segment => ({ id, kind: 'p', text, inlineMarkup: text, domPath: `p[${id}]`, translate: true, ...extra });

function job(segments: Segment[], strategy: string, extra: Partial<TranslationJob['options']> = {}, chunkTokens = 1200): TranslationJob {
  return {
    doc: { url: 'https://example.com', title: 'T', sourceLang: 'en', targetLang: 'vi', outline: [], segments },
    priority: [],
    strategy,
    options: { style: 'natural', glossary: [], maxConcurrency: 1, chunkTokens, ...extra },
  };
}

interface FakeMT extends MTClient {
  calls: { text: string; from: string; to: string }[];
}

function fakeMT(state: MTAvailability = 'available', answer: (text: string) => MTResult = (text) => ({ ok: true, text: `cơ bản:${text}` })): FakeMT {
  const calls: FakeMT['calls'] = [];
  return {
    model: 'Chrome Translator',
    calls,
    async availability() {
      return state;
    },
    async translate(text, from, to, signal) {
      await Promise.resolve();
      signal.throwIfAborted();
      calls.push({ text, from, to });
      return answer(text);
    },
  };
}

const err = (kind: LLMError['kind'], extra: Partial<LLMError> = {}): LLMError => ({ kind, message: `${kind} message.`, ...extra });

function deps(primary: LLMClient, mt?: MTClient, fallback: LLMClient[] = []): EngineDeps {
  return {
    llm: () => primary,
    fallback: () => fallback,
    now: () => 0,
    sleep: fakeSleep(),
    strategies: [singlePass, contextual, basic],
    prompts: createDefaultPromptRegistry(),
    random: () => 0,
    ...(mt ? { mt } : {}),
  };
}

async function collect(stream: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

type Final = Extract<EngineEvent, { type: 'segment.final' }>;
type Failed = Extract<EngineEvent, { type: 'segment.failed' }>;
const finals = (events: EngineEvent[]) => events.filter((e): e is Final => e.type === 'segment.final');
const failures = (events: EngineEvent[]) => events.filter((e): e is Failed => e.type === 'segment.failed');
const switches = (events: EngineEvent[]) => events.filter((e) => e.type === 'stage' && e.stage === BASIC_SWITCH_STAGE);

describe('the basic strategy (DESIGN §5.3, plan M5-E7)', () => {
  it('translates each block on its own with the MTClient, plain text in, labeled by producedBy', async () => {
    const mt = fakeMT();
    const segments = [seg('a', 'See the [link]docs[/link].', { inlineMarkup: 'See the [link]docs[/link].', text: 'See the docs.' }), seg('b'), seg('code', 'x = 1', { kind: 'code', translate: false })];
    const events = await collect(createEngine(deps(fakeClient([[]]), mt)).translate(job(segments, BASIC_ID), new AbortController().signal));
    expect(mt.calls).toEqual([
      { text: 'See the docs.', from: 'en', to: 'vi' },
      { text: 'Sentence b.', from: 'en', to: 'vi' },
    ]);
    expect(finals(events).map((f) => [f.id, f.text, f.revision, f.producedBy])).toEqual([
      ['a', 'cơ bản:See the docs.', 1, { strategy: 'basic', stage: 'translate', model: 'Chrome Translator' }],
      ['b', 'cơ bản:Sentence b.', 1, { strategy: 'basic', stage: 'translate', model: 'Chrome Translator' }],
    ]);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('does the viewport first, read before each block', async () => {
    const mt = fakeMT();
    const j = { ...job([seg('a'), seg('b'), seg('c')], BASIC_ID), priority: ['c'] };
    await collect(createEngine(deps(fakeClient([[]]), mt)).translate(j, new AbortController().signal));
    expect(mt.calls.map((c) => c.text)).toEqual(['Sentence c.', 'Sentence a.', 'Sentence b.']);
  });

  it('without a translator, or one that cannot do the pair, every block fails and says why', async () => {
    const none = await collect(createEngine(deps(fakeClient([[]]))).translate(job([seg('a')], BASIC_ID), new AbortController().signal));
    expect(failures(none).map((f) => f.error.message)).toEqual([BASIC_MISSING_MESSAGE]);
    const mt = fakeMT('unavailable');
    const events = await collect(createEngine(deps(fakeClient([[]]), mt)).translate(job([seg('a'), seg('b')], BASIC_ID), new AbortController().signal));
    expect(mt.calls).toEqual([]);
    expect(failures(events).map((f) => f.error.message)).toEqual([
      "Chrome Translator can't translate en → vi on this device, so there is no basic translation either.",
      "Chrome Translator can't translate en → vi on this device, so there is no basic translation either.",
    ]);
  });

  it("a block the translator failed on fails alone; the others are translated", async () => {
    const mt = fakeMT('available', (text) => (text === 'Sentence a.' ? { ok: false, error: { kind: 'unknown', message: 'translator broke' } } : { ok: true, text: `vi:${text}` }));
    const events = await collect(createEngine(deps(fakeClient([[]]), mt)).translate(job([seg('a'), seg('b')], BASIC_ID), new AbortController().signal));
    expect(failures(events).map((f) => [f.id, f.error.message])).toEqual([['a', 'translator broke']]);
    expect(finals(events).map((f) => f.id)).toEqual(['b']);
  });

  it('runs the §5.6 checks: a block that loses its URL fails them, without a re-request', async () => {
    const mt = fakeMT('available', () => ({ ok: true, text: 'Xem tài liệu.' }));
    const events = await collect(createEngine(deps(fakeClient([[]]), mt)).translate(job([seg('a', 'See https://example.com/docs for the docs.')], BASIC_ID), new AbortController().signal));
    const [f] = failures(events);
    expect(f?.error.message).toBe(CHECK_MESSAGE);
    expect(f && checkFailure(f.error)).toMatchObject({ reason: 'check', outcome: 'no-request', checks: [expect.objectContaining({ kind: 'url' })] });
    expect(mt.calls).toHaveLength(1);
  });

  it('an unknown page language is passed on as empty (the translator detects it), else the brief language is used', async () => {
    const mt = fakeMT();
    const j = job([seg('a')], BASIC_ID);
    await collect(createEngine(deps(fakeClient([[]]), mt)).translate({ ...j, doc: { ...j.doc, sourceLang: '' } }, new AbortController().signal));
    await collect(createEngine(deps(fakeClient([[]]), mt)).translate({ ...j, doc: { ...j.doc, sourceLang: '' }, options: { ...j.options, brief: { language: 'de', genre: '', audience: '', purpose: '', tone: '', glossary: [] } } }, new AbortController().signal));
    expect(mt.calls.map((c) => c.from)).toEqual(['', 'de']);
  });
});

describe('the terminal basic entry: every provider down switches the job to basic (§4.3.5, plan M5-E7)', () => {
  const down = (kind: LLMError['kind'] = 'network') => fakeClient([[failed(err(kind, { message: "Can't reach api.example.com." }))]], { model: 'qwen3.8-flash' });

  it.each(['network', 'overloaded', 'rate_limit'] as const)('%s on the last provider: the blocks are translated by basic, none is reported failed', async (kind) => {
    const mt = fakeMT();
    const segments = [seg('a', 'One. '.repeat(30)), seg('b', 'Two. '.repeat(30)), seg('c', 'Three. '.repeat(30))];
    const events = await collect(createEngine(deps(down(kind), mt)).translate(job(segments, 'single-pass', { basicFallback: true }, 40), new AbortController().signal));
    expect(failures(events)).toEqual([]);
    expect(finals(events).map((f) => [f.id, f.producedBy.strategy])).toEqual([
      ['a', 'basic'],
      ['b', 'basic'],
      ['c', 'basic'],
    ]);
    const sw = switches(events);
    expect(sw).toHaveLength(1);
    expect((sw[0] as { info: BasicSwitchInfo }).info).toEqual({ from: 'qwen3.8-flash', to: 'Chrome Translator', error: err(kind, { message: "Can't reach api.example.com." }) });
    // The switch comes before the first block it took over.
    expect(events.findIndex((e) => e.type === 'stage' && e.stage === BASIC_SWITCH_STAGE)).toBeLessThan(events.findIndex((e) => e.type === 'segment.final'));
  });

  it('contextual (the panel strategy): the analyze call fails too, and every block still ends in basic', async () => {
    const mt = fakeMT();
    const segments = [seg('a', 'One. '.repeat(30)), seg('b', 'Two. '.repeat(30))];
    const events = await collect(createEngine(deps(down(), mt)).translate(job(segments, 'contextual', { basicFallback: true }, 40), new AbortController().signal));
    expect(failures(events)).toEqual([]);
    expect(finals(events).map((f) => [f.id, f.producedBy.strategy])).toEqual([
      ['a', 'basic'],
      ['b', 'basic'],
    ]);
  });

  it('after the switch, chunks not started yet are not sent to the provider again', async () => {
    const primary = down();
    const segments = [seg('a', 'One. '.repeat(30)), seg('b', 'Two. '.repeat(30)), seg('c', 'Three. '.repeat(30))];
    await collect(createEngine(deps(primary, fakeMT())).translate(job(segments, 'single-pass', { basicFallback: true }, 40), new AbortController().signal));
    // The first chunk's attempts only (retry policy), none for b and c.
    const firstChunk = primary.requests.length;
    expect(new Set(primary.requests.map((r) => r.messages.at(-1)?.content.includes('One.')))).toEqual(new Set([true]));
    expect(firstChunk).toBeGreaterThan(0);
  });

  it('the fallback profiles are tried first; basic only after the last one gave up', async () => {
    const backup = translatorClient(undefined, { model: 'claude-haiku-4-5' });
    const mt = fakeMT();
    const events = await collect(createEngine(deps(down(), mt, [backup])).translate(job([seg('a')], 'single-pass', { basicFallback: true }), new AbortController().signal));
    expect(mt.calls).toEqual([]);
    expect(switches(events)).toEqual([]);
    expect(finals(events).map((f) => f.producedBy.model)).toEqual(['claude-haiku-4-5']);
  });

  it.each(['auth', 'quota', 'cors', 'model_not_found'] as const)('%s never switches: it stops at the provider that hit it', async (kind) => {
    const mt = fakeMT();
    const events = await collect(createEngine(deps(down(kind), mt)).translate(job([seg('a')], 'single-pass', { basicFallback: true }), new AbortController().signal));
    expect(mt.calls).toEqual([]);
    expect(failures(events).map((f) => f.error.kind)).toEqual([kind]);
  });

  it('without the basic entry the blocks fail as before', async () => {
    const mt = fakeMT();
    const events = await collect(createEngine(deps(down(), mt)).translate(job([seg('a')], 'single-pass'), new AbortController().signal));
    expect(mt.calls).toEqual([]);
    expect(failures(events).map((f) => f.error.kind)).toEqual(['network']);
  });

  it('no translator on the device: the blocks fail with the provider error and why basic did not help', async () => {
    for (const mt of [undefined, fakeMT('unavailable')]) {
      const events = await collect(createEngine(deps(down(), mt)).translate(job([seg('a'), seg('b')], 'single-pass', { basicFallback: true }), new AbortController().signal));
      const fs = failures(events);
      expect(fs.map((f) => f.id)).toEqual(['a', 'b']);
      expect(fs[0]?.error.message).toMatch(/^Can't reach api\.example\.com\. .*no basic translation either\.$/);
      expect(switches(events)).toHaveLength(1);
      expect((switches(events)[0] as { info: BasicSwitchInfo }).info.to).toBe(mt?.model);
    }
  });

  it('a provider that comes back for some chunks keeps its blocks; only the failed ones go to basic', async () => {
    let calls = 0;
    const flaky = translatorClient(undefined, { model: 'qwen3.8-flash' });
    const primary: LLMClient = {
      model: 'qwen3.8-flash',
      reasoningReserveTokens: () => 0,
      async *stream(req) {
        if (calls++ === 0) {
          yield* flaky.stream(req);
          return;
        }
        yield { type: 'error', error: err('network') };
      },
    };
    const segments = [seg('a', 'One. '.repeat(30)), seg('b', 'Two. '.repeat(30))];
    const events = await collect(createEngine(deps(primary, fakeMT())).translate(job(segments, 'single-pass', { basicFallback: true }, 40), new AbortController().signal));
    expect(finals(events).map((f) => [f.id, f.producedBy.strategy])).toEqual([
      ['a', 'single-pass'],
      ['b', 'basic'],
    ]);
  });

  it('a cancel stops the basic translations too', async () => {
    const controller = new AbortController();
    const mt = fakeMT('available', (text) => {
      controller.abort(new DOMException('cancelled', 'AbortError'));
      return { ok: true, text };
    });
    await expect(collect(createEngine(deps(down(), mt)).translate(job([seg('a', 'One. '.repeat(30)), seg('b', 'Two. '.repeat(30))], 'single-pass', { basicFallback: true }, 40), controller.signal))).rejects.toThrow('cancelled');
    expect(mt.calls).toHaveLength(1);
  });
});
