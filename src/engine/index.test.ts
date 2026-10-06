import { describe, expect, it } from 'vitest';
import { createBudget, createEngine, createPromptRegistry, defineStrategy, definePrompt, maxOutputTokens } from './index.ts';
import type { EngineEvent, StageContext, TranslationJob } from './index.ts';
import { fakeClient, fakeSleep, success } from './testing.ts';

describe('engine', () => {
  // N5: engine tests run without the WXT test plugin, which stubs chrome/browser globals.
  it('runs in plain Node, with no extension globals present', () => {
    // eslint-disable-next-line no-restricted-globals -- checking that the globals are absent
    expect('chrome' in globalThis).toBe(false);
    // eslint-disable-next-line no-restricted-globals -- checking that the globals are absent
    expect('browser' in globalThis).toBe(false);
    expect(typeof process.versions.node).toBe('string');
  });

  it('runs a job end to end with injected ports only', async () => {
    const client = fakeClient([success('xin chào')]);
    const strategy = defineStrategy({
      id: 'single-pass',
      version: 1,
      stages: [
        {
          id: 'translate',
          scope: 'document',
          async *run(job: TranslationJob, ctx: StageContext) {
            const c = ctx.llm('translate');
            let text = '';
            for await (const e of c.stream({ model: c.model, system: '', messages: [], maxOutputTokens: 10, signal: ctx.signal })) {
              if (e.type === 'text') text += e.delta;
            }
            for (const s of job.doc.segments) {
              yield { type: 'segment.final', id: s.id, text, revision: 1, producedBy: { strategy: 'single-pass', stage: 'translate', model: c.model } };
            }
          },
        } as never,
      ],
    });
    const engine = createEngine({ llm: () => client, now: () => 0, sleep: fakeSleep(), strategies: [strategy], prompts: createPromptRegistry([]) });
    const job: TranslationJob = {
      doc: { url: 'u', title: 't', sourceLang: 'en', targetLang: 'vi', outline: [], segments: [{ id: '1', kind: 'p', text: 'hello', inlineMarkup: 'hello', domPath: 'p[1]', translate: true }] },
      priority: [],
      strategy: 'single-pass',
      options: { style: 'natural', glossary: [], maxConcurrency: 2, chunkTokens: 1200 },
    };
    const events: EngineEvent[] = [];
    for await (const e of engine.translate(job, new AbortController().signal)) events.push(e);
    expect(events).toContainEqual(expect.objectContaining({ type: 'segment.final', id: '1', text: 'xin chào', producedBy: expect.objectContaining({ model: 'fake-model' }) }));
    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(client.requests[0]?.model).toBe('fake-model');
  });
});

describe('budget', () => {
  it('counts tokens and time against the limits', () => {
    let t = 0;
    const b = createBudget({ maxTokens: 100, maxMs: 1000 }, () => t);
    b.record({ input: 50, output: 20, cachedInput: 30 });
    expect(b.spent).toEqual({ input: 50, output: 20, cachedInput: 30 });
    expect([b.remainingTokens(), b.exhausted()]).toEqual([30, false]);
    b.record({ input: 10, output: 20 });
    expect([b.remainingTokens(), b.exhausted()]).toEqual([0, true]);
    const timed = createBudget({ maxMs: 1000 }, () => t);
    t = 999;
    expect(timed.exhausted()).toBe(false);
    t = 1000;
    expect(timed.exhausted()).toBe(true);
    expect(createBudget({}, () => 0).remainingTokens()).toBe(Infinity);
  });

  it('maxOutputTokens = 2.0 × source + 12 × segments + reasoning reserve (§5.7)', () => {
    expect(maxOutputTokens({ sourceTokens: 1000, segments: 10, reasoningReserveTokens: 0 })).toBe(2120);
    expect(maxOutputTokens({ sourceTokens: 1000, segments: 10, reasoningReserveTokens: 256 })).toBe(2376);
    expect(maxOutputTokens({ sourceTokens: 100.4, segments: 1, reasoningReserveTokens: 0 })).toBe(213);
  });
});

describe('prompt registry', () => {
  it('stores versioned templates and fills their slots', () => {
    const v1 = definePrompt('translate', 1, 'Translate into {TARGET_LANG}. {"json": true}');
    const v2 = definePrompt('translate', 2, 'v2 {TARGET_LANG}');
    const reg = createPromptRegistry([v1, v2]);
    expect(reg.get('translate@1').render({ TARGET_LANG: 'Vietnamese' })).toBe('Translate into Vietnamese. {"json": true}');
    expect(reg.latest('translate')?.id).toBe('translate@2');
    expect(reg.has('translate@3')).toBe(false);
    expect(() => reg.get('translate@3')).toThrow(/unknown prompt/);
    expect(() => v1.render({})).toThrow(/no value for \{TARGET_LANG\}/);
    expect(() => createPromptRegistry([v1, v1])).toThrow(/duplicate/);
  });
});
