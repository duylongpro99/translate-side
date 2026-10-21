// Jobs on the on-device route (src/llm/on-device.ts): Chrome's Translator runs `basic` block by
// block, Gemini Nano runs single-pass and hands what it can't do to the Translator; both are cached.
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/index';
import { renderLines, translatorClient } from '@/engine/testing';
import { chromeTranslator } from '@/llm/chrome-translator';
import { translatorRouteClient } from '@/llm/on-device';
import { fakeBuiltinAI } from '@/llm/testing';
import type { LLMClient } from '@/llm/types';
import { openTranslationCache, type TranslationCache } from '@/shared/cache';
import { GEMINI_PROFILE, NANO_PROFILE, TRANSLATOR_PROFILE } from '@/shared/settings';
import { Jobs, type ClientResult, type ClientTarget, type JobDoc, type JobView } from './jobs.ts';

function doc(n: number, sourceLang = 'en'): JobDoc {
  const segments: Segment[] = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, kind: 'p', text: `Para ${i}.`, inlineMarkup: `Para ${i}.`, domPath: `/p[${i + 1}]`, translate: true }));
  return { url: 'https://example.com/', title: 'T', sourceLang, targetLang: 'vi', segments, strategy: 'contextual' };
}
const newCache = () => openTranslationCache({ factory: new IDBFactory() }) as TranslationCache;
const ON_DEVICE = { id: 'chrome-on-device', label: 'Chrome on-device' };
const translatorRoute = (): ClientResult => ({ ok: true, client: translatorRouteClient(), profile: TRANSLATOR_PROFILE, connection: ON_DEVICE, onDevice: 'translator' });
const nanoRoute = (client: LLMClient): ClientResult => ({ ok: true, client, profile: NANO_PROFILE, connection: ON_DEVICE, onDevice: 'nano', basic: true });

function jobsOver(route: () => ClientResult, opts: { cache?: TranslationCache; scope?: object } = {}) {
  const ai = fakeBuiltinAI({ pairs: { 'en>vi': 'available', 'fr>vi': 'downloadable' } });
  const targets: ClientTarget[] = [];
  const jobs = new Jobs({
    translateClient: (t) => (targets.push(t), Promise.resolve(route())),
    mt: chromeTranslator(opts.scope ?? ai.scope),
    ...(opts.cache ? { cache: opts.cache } : {}),
  });
  jobs.setActive(1);
  return { jobs, ai, targets };
}

describe('Jobs on Chrome Translator (keyless, on the device)', () => {
  it('runs `basic` block by block, labels the blocks basic, sends no prompt, asks no brief', async () => {
    const { jobs, ai, targets } = jobsOver(translatorRoute);
    await jobs.start(1, 'd1', doc(3));
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('done');
    expect(v.counts).toEqual({ total: 3, final: 3, failed: 0 });
    expect([...v.segs.values()].map((s) => [s.text, s.basic, s.model])).toEqual([0, 1, 2].map((i) => [`[vi] Para ${i}.`, true, 'Chrome Translator']));
    expect(v.brief).toBeUndefined();
    expect(targets[0]).toMatchObject({ sourceLang: 'en', targetLang: 'vi' });
    // The pair was `available`: the block created it, no click needed.
    expect(ai.creates).toEqual([{ api: 'translator', from: 'en', to: 'vi' }]);
  });

  it('its finals are cached under its own model: a reopen reads them, a provider later translates again', async () => {
    const cache = newCache();
    const first = jobsOver(translatorRoute, { cache });
    await first.jobs.start(1, 'd1', doc(3));
    await first.jobs.cacheIdle();
    const again = jobsOver(translatorRoute, { cache });
    await again.jobs.start(1, 'd2', doc(3));
    const v = again.jobs.get(1) as JobView;
    expect(v.cached).toBe(3);
    expect([...v.segs.values()].every((s) => s.basic && s.text?.startsWith('[vi]'))).toBe(true);
    expect(again.ai.creates).toEqual([]);

    const model = translatorClient((lines) => renderLines(lines, (s) => `model:${s}`), { model: GEMINI_PROFILE.model });
    const provider = jobsOver(() => ({ ok: true, client: model, profile: GEMINI_PROFILE }), { cache });
    await provider.jobs.start(1, 'd3', doc(3));
    expect((provider.jobs.get(1) as JobView).cached ?? 0).toBe(0);
    expect(model.requests.length).toBeGreaterThan(0);
  });

  it('a pair that needs the click fails its blocks with the pair to turn on, never creating it', async () => {
    const { jobs, ai } = jobsOver(translatorRoute);
    await jobs.start(1, 'd1', doc(2, 'fr'));
    const v = jobs.get(1) as JobView;
    expect(v.counts.failed).toBe(2);
    expect(v.onDeviceSetup).toEqual({ engine: 'translator', from: 'fr', to: 'vi' });
    expect(ai.creates).toEqual([]);
  });

  it('Retry runs basic; Explain says it needs a language model', async () => {
    const { jobs, ai } = jobsOver(translatorRoute);
    await jobs.start(1, 'd1', doc(2, 'fr'));
    ai.pairs.set('fr>vi', 'available');
    await jobs.retrySegment(1, 's0');
    expect((jobs.get(1) as JobView).segs.get('s0')).toMatchObject({ status: 'final', text: '[vi] Para 0.', basic: true });
    await jobs.explainSegment(1, 's0');
    expect((jobs.get(1) as JobView).segs.get('s0')?.explain).toMatchObject({ status: 'failed', error: { raw: { ui: 'explainNeedsModel' } } });
  });
});

describe('Jobs on Gemini Nano', () => {
  it('runs single-pass with no brief', async () => {
    const nano = translatorClient((lines) => renderLines(lines, (s) => `nano:${s}`), { model: 'gemini-nano' });
    const { jobs } = jobsOver(() => nanoRoute(nano));
    await jobs.start(1, 'd1', doc(3));
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('done');
    expect([...v.segs.values()].map((s) => s.text)).toEqual(['nano:Para 0.', 'nano:Para 1.', 'nano:Para 2.']);
    expect(nano.requests.every((r) => !r.system.startsWith('You prepare a translator'))).toBe(true);
    expect(v.brief).toBeUndefined();
  });

  it('a chunk too long for Nano ends as a Chrome Translator block', async () => {
    const tooLong: LLMClient = {
      model: 'gemini-nano',
      reasoningReserveTokens: () => 0,
      async *stream() {
        yield { type: 'error', error: { kind: 'context_length', message: 'The text is too long for Gemini Nano' } };
      },
    };
    const { jobs } = jobsOver(() => nanoRoute(tooLong));
    await jobs.start(1, 'd1', doc(2));
    const v = jobs.get(1) as JobView;
    expect(v.counts).toEqual({ total: 2, final: 2, failed: 0 });
    expect([...v.segs.values()].every((s) => s.basic && s.text?.startsWith('[vi]'))).toBe(true);
  });
});
