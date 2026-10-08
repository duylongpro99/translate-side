// Jobs and the translation cache (plan M3-E2/E3): free on revisit.
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { EngineEvent, Segment } from '@/engine/index';
import { renderLines, translatorClient, wireLines } from '@/engine/testing';
import type { LLMClient, NormalizedRequest } from '@/llm/types';
import { openTranslationCache, type TranslationCache } from '@/shared/cache';
import { GEMINI_PROFILE } from '@/shared/settings';
import { Jobs, type ClientResult, type JobDoc, type JobView } from './jobs.ts';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
function doc(n: number, w = 120): JobDoc {
  const segments: Segment[] = Array.from({ length: n }, (_, i) => {
    const text = `P${i} ${words(w)}`;
    return { id: `s${i}`, kind: 'p', text, inlineMarkup: text, domPath: `/p[${i + 1}]`, translate: true };
  });
  segments.splice(1, 0, { id: 'code', kind: 'code', text: 'fn main() {}', inlineMarkup: 'fn main() {}', domPath: '/pre[1]', translate: false });
  return { url: 'https://example.com/', title: 'T', sourceLang: 'en', targetLang: 'vi', segments };
}
const ok = (client: LLMClient, model?: string): (() => Promise<ClientResult>) => () => Promise.resolve({ ok: true, client: model ? { ...client, model } : client, profile: GEMINI_PROFILE });
const newCache = () => openTranslationCache({ factory: new IDBFactory() }) as TranslationCache;
const BRIEF = { language: 'en', genre: 'blog post', audience: 'developers', purpose: 'explain', tone: 'dry', glossary: [] };
const isAnalyze = (req: NormalizedRequest) => req.system.startsWith('You prepare a translator');
const both = () => translatorClient((lines, _n, req) => (isAnalyze(req) ? JSON.stringify(BRIEF) : renderLines(lines, (s) => `vi:${s}`)), { model: GEMINI_PROFILE.model });
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await settle(2);
  }
}
/** A stream that never answers until it is aborted. */
async function* hang(signal: AbortSignal): AsyncGenerator<never> {
  await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  yield* [] as never[];
}
/** A new panel session: a fresh Jobs over the same cache, like reopening the page. */
const session = (client: LLMClient, cache: TranslationCache | undefined, extra: { strategy?: string } = {}) => {
  const jobs = new Jobs({ translateClient: ok(client), cache, ...extra });
  jobs.setActive(1);
  return jobs;
};

describe('Jobs with the translation cache: a revisit makes no API call (§3 #3)', () => {
  it('first open translates and stores; the second open shows everything from the cache with 0 requests', async () => {
    const cache = newCache();
    const first = both();
    const j1 = session(first, cache);
    await j1.start(1, 'd1', doc(30));
    await settle();
    expect(j1.get(1)?.status).toBe('done');
    expect(first.requests.length).toBeGreaterThan(0);
    expect(j1.get(1)?.cached).toBe(0);
    const texts = new Map([...(j1.get(1) as JobView).segs].map(([id, s]) => [id, s.text]));

    const second = both();
    const j2 = session(second, cache);
    j2.setViewport(1, 'd2', ['s3', 's4']);
    await j2.start(1, 'd2', doc(30));
    const v = j2.get(1) as JobView;
    expect(second.requests).toHaveLength(0);
    expect(v.status).toBe('done');
    expect(v.counts).toEqual({ total: 30, final: 30, failed: 0 });
    expect(v.cached).toBe(30);
    expect(v.usage).toEqual({ input: 0, cachedInput: 0, output: 0 });
    expect(v.screenDoneAt).toBeDefined();
    expect(v.firstVisibleAt).toBeDefined();
    expect(new Map([...v.segs].map(([id, s]) => [id, s.text]))).toEqual(texts);
    // The brief came back too: no analyze call, and "About this document" has its card.
    expect(v.brief).toEqual(BRIEF);
  });

  it('a re-extracted page (whitespace drift, new segment ids) still hits', async () => {
    const cache = newCache();
    await session(both(), cache).start(1, 'd1', doc(10));
    await settle();
    const drifted = doc(10);
    drifted.segments = drifted.segments.map((s, i) => ({ ...s, id: `n${i}`, text: ` ${s.text.replace(/ /g, '  ')}\n`, inlineMarkup: s.inlineMarkup.replace(/ /g, ' ') }));
    const c = both();
    const j = session(c, cache);
    await j.start(1, 'd2', drifted);
    expect(c.requests).toHaveLength(0);
    expect(j.get(1)?.counts.final).toBe(10);
  });

  it('a different style, glossary, language or model is a miss', async () => {
    const cache = newCache();
    await session(both(), cache).start(1, 'a', doc(4, 300));
    await settle();
    const misses = async (d: JobDoc, model?: string) => {
      const c = both();
      const j = new Jobs({ translateClient: ok(c, model), cache });
      j.setActive(1);
      await j.start(1, 'b', d);
      return c.requests.length > 0;
    };
    expect(await misses({ ...doc(4, 300), style: 'faithful' })).toBe(true);
    expect(await misses({ ...doc(4, 300), glossary: [{ term: 'word1', rendering: 'x' }] })).toBe(true);
    expect(await misses({ ...doc(4, 300), targetLang: 'fr' })).toBe(true);
    expect(await misses(doc(4, 300), 'other-model')).toBe(true);
    expect(await misses(doc(4, 300))).toBe(false);
  });

  it('retranslate (fresh) bypasses the lookup, and refreshes the entries', async () => {
    const cache = newCache();
    await session(both(), cache).start(1, 'a', doc(5));
    await settle();
    const c = translatorClient((lines) => renderLines(lines, (s) => `NEW:${s}`), { model: GEMINI_PROFILE.model });
    const j = session(c, cache);
    await j.start(1, 'b', doc(5), { fresh: true });
    expect(c.requests.length).toBeGreaterThan(0);
    expect(j.get(1)?.cached).toBe(0);
    expect(j.get(1)?.segs.get('s0')?.text).toMatch(/^NEW:/);
    await settle();
    const after = both();
    const j3 = session(after, cache);
    await j3.start(1, 'c', doc(5));
    expect(after.requests).toHaveLength(0);
    expect(j3.get(1)?.segs.get('s0')?.text).toMatch(/^NEW:/);
  });

  it('a retry after an interruption re-runs only the missing segments (M3-D4)', async () => {
    const cache = newCache();
    // The first session dies after the first chunk answered: only some segments are stored.
    let calls = 0;
    const flaky = translatorClient((lines, _n, req) => {
      if (isAnalyze(req)) return JSON.stringify(BRIEF);
      calls++;
      if (calls > 1) throw new Error('connection lost');
      return renderLines(lines, (s) => `vi:${s}`);
    }, { model: GEMINI_PROFILE.model });
    const j1 = session(flaky, cache);
    await j1.start(1, 'd1', doc(30));
    await settle();
    const stored = j1.get(1)?.counts.final ?? 0;
    expect(stored).toBeGreaterThan(0);
    expect(stored).toBeLessThan(30);

    const sent: string[] = [];
    const retry = translatorClient((lines, _n, req) => {
      if (!isAnalyze(req)) sent.push(...lines.map((l) => l.source.split(' ')[0] ?? ''));
      return isAnalyze(req) ? JSON.stringify(BRIEF) : renderLines(lines, (s) => `vi:${s}`);
    }, { model: GEMINI_PROFILE.model });
    const j2 = session(retry, cache);
    await j2.start(1, 'd2', doc(30));
    const v = j2.get(1) as JobView;
    expect(v.status).toBe('done');
    expect(v.cached).toBe(stored);
    expect(sent).toHaveLength(30 - stored);
    expect(new Set(sent).size).toBe(sent.length);
    expect(v.counts.final).toBe(30);
  });

  it('stores the highest revision, and a segment that failed its check is dropped', async () => {
    const by = { strategy: 'contextual', stage: 'translate', model: 'm' };
    const fin = (id: string, text: string, revision = 1): EngineEvent => ({ type: 'segment.final', id, text, revision, producedBy: by });
    const engine = () => ({
      async *translate() {
        yield fin('s0', 'draft');
        yield fin('s0', 'refined', 2);
        yield fin('s1', 'good');
        yield fin('s1', 'revised, broke a code span', 2);
        yield { type: 'segment.failed', id: 's1', revision: 2, error: { kind: 'unknown', message: 'check' } } as EngineEvent;
        yield { type: 'done' } as EngineEvent;
      },
    });
    const cache = newCache();
    const j = new Jobs({ strategy: 'contextual', translateClient: ok(translatorClient(undefined, { model: 'm' })), cache, engine: engine as never });
    j.setActive(1);
    await j.start(1, 'a', doc(2));
    await settle();
    const c2 = translatorClient(undefined, { model: 'm' });
    const seen: string[] = [];
    const j2 = new Jobs({ strategy: 'contextual', translateClient: ok(c2), cache, engine: ((client: LLMClient) => ({ async *translate(job: { doc: { segments: Segment[] } }) {
      seen.push(...job.doc.segments.filter((s) => s.translate).map((s) => s.id));
      void client;
      yield { type: 'done' } as EngineEvent;
    } })) as never });
    j2.setActive(1);
    await j2.start(1, 'b', doc(2));
    // s0 came back refined from the cache; s1 failed its check, so it is sent again.
    expect(j2.get(1)?.segs.get('s0')).toMatchObject({ status: 'final', text: 'refined', revision: 2 });
    expect(seen).toEqual(['s1']);
  });

  it('a cache that throws is a miss, not a failed job', async () => {
    const broken: TranslationCache = {
      getMany: () => Promise.reject(new Error('idb')),
      putMany: () => Promise.reject(new Error('idb')),
      delete: () => Promise.reject(new Error('idb')),
      getBrief: () => Promise.reject(new Error('idb')),
      putBrief: () => Promise.reject(new Error('idb')),
      stats: () => Promise.reject(new Error('idb')),
      clear: () => Promise.reject(new Error('idb')),
    };
    const j = session(both(), broken);
    await j.start(1, 'a', doc(5));
    expect(j.get(1)?.status).toBe('done');
    expect(j.get(1)?.counts.final).toBe(5);
  });

  it('a cancelled run keeps its finals in the cache, so the next open continues from them', async () => {
    const cache = newCache();
    const inner = both();
    const gate = { n: 0 };
    const client: LLMClient = { model: inner.model, reasoningReserveTokens: () => 0, stream: (req) => (gate.n++ < 2 ? inner.stream(req) : hang(req.signal)) };
    const j = session(client, cache);
    const run = j.start(1, 'a', doc(30));
    await until(() => (j.get(1)?.counts.final ?? 0) > 0 && gate.n > 3);
    j.cancel(1);
    await run;
    await settle();
    const got = j.get(1)?.counts.final ?? 0;
    const next = both();
    const j2 = session(next, cache);
    await j2.start(1, 'b', doc(30));
    expect(j2.get(1)?.cached).toBeGreaterThanOrEqual(got);
    expect(wireLines(next.requests.find((r) => !isAnalyze(r))?.messages[0]?.content ?? '').length).toBeGreaterThan(0);
  });
});
