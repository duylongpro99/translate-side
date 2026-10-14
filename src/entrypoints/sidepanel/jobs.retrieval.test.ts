// Jobs and the translation memory's retrieval: which corrections may be sent as examples (the
// sending rules), the one read of the feature gate per run, a stable array across rounds, the
// diagnostics counts, and a slow or large store never delaying the first request.
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createDefaultPromptRegistry, createEngine, basic, contextual, explain, refine, singlePass, type MemoryExample, type Segment, type TranslationEngine } from '@/engine/index';
import { fakeSleep, renderLines, translatorClient } from '@/engine/testing';
import type { LLMClient, NormalizedRequest } from '@/llm/types';
import type { JobRecord } from '@/shared/diagnostics';
import { memoryKey, openTranslationMemory, type MemoryEdit, type TranslationMemory } from '@/shared/memory';
import { GEMINI_PROFILE } from '@/shared/settings';
import { Jobs, type ClientResult, type JobDeps, type JobDoc } from './jobs.ts';

const PAGE = 'Click the Save button to keep your changes.';
const SIMILAR = 'Click the Save button to store your changes.';
const CORRECTION = 'Nhấn nút Lưu để lưu thay đổi của bạn.';

function doc(over: Partial<JobDoc> = {}, text = PAGE): JobDoc {
  const segments: Segment[] = [{ id: 's0', kind: 'p', text, inlineMarkup: text, domPath: '/p[1]', translate: true }];
  return { url: 'https://a.example/page', title: 'T', sourceLang: 'en', targetLang: 'vi', segments, ...over };
}
const BRIEF = { language: 'en', genre: 'blog post', audience: 'developers', purpose: 'explain', tone: 'dry', glossary: [] };
const isAnalyze = (req: NormalizedRequest) => req.system.startsWith('You prepare a translator');
const client = () => translatorClient((lines, _n, req) => (isAnalyze(req) ? JSON.stringify(BRIEF) : renderLines(lines, (s) => `vi:${s}`)), { model: GEMINI_PROFILE.model });
const userText = (c: { requests: NormalizedRequest[] }) => c.requests.filter((r) => !isAnalyze(r)).map((r) => r.messages[0]?.content ?? '').join('\n');

const ok = (c: LLMClient, extra: Partial<Extract<ClientResult, { ok: true }>> = {}) => (): Promise<ClientResult> => Promise.resolve({ ok: true, client: c, profile: GEMINI_PROFILE, ...extra });
const newMemory = () => openTranslationMemory({ factory: new IDBFactory() }) as TranslationMemory;
const edit = (over: Partial<MemoryEdit> = {}): MemoryEdit => ({ source: SIMILAR, target: CORRECTION, sourceLang: 'en', targetLang: 'vi', origin: 'https://a.example', localOnly: false, ...over });
const session = (deps: JobDeps) => {
  const jobs = new Jobs(deps);
  jobs.setActive(1);
  return jobs;
};
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/** Runs the page once and returns what the model was sent. */
async function run(deps: Partial<JobDeps>, over: Partial<JobDoc> = {}, route: Partial<Extract<ClientResult, { ok: true }>> = {}) {
  const c = client();
  const jobs = session({ translateClient: ok(c, route), ...deps });
  await jobs.start(1, 'd', doc(over));
  return { c, jobs, text: userText(c) };
}

describe('Jobs: corrections as examples', () => {
  it('sends a same-origin correction in the chunk context and counts it, by hashed id, in the record', async () => {
    const memory = newMemory();
    await memory.put(edit());
    const records: JobRecord[] = [];
    const { text } = await run({ memory, onJobRecord: (r) => records.push(r) });
    expect(text).toContain(`<translation>${CORRECTION}</translation>`);
    expect(text).toContain('<context>');
    const last = records.at(-1);
    expect(last?.memory).toEqual({ hits: 1, ids: [memoryKey('vi', SIMILAR)] });
    expect(JSON.stringify(last)).not.toContain('Nhấn');
  });

  it('does not send a local-only correction on a route that is not local-only, even with the setting on', async () => {
    const memory = newMemory();
    await memory.put(edit({ localOnly: true }));
    const { text } = await run({ memory, acrossSites: () => Promise.resolve(true) });
    expect(text).not.toContain(CORRECTION);
  });

  it('sends it on a local-only route; an entry of another origin still needs the setting there', async () => {
    const memory = newMemory();
    await memory.put(edit({ localOnly: true }));
    expect((await run({ memory }, {}, { localOnly: 'a.example/*' })).text).toContain(CORRECTION);

    const other = newMemory();
    await other.put(edit({ localOnly: true, origin: 'https://other.example' }));
    expect((await run({ memory: other }, {}, { localOnly: 'a.example/*' })).text).not.toContain(CORRECTION);
    expect((await run({ memory: other, acrossSites: () => Promise.resolve(true) }, {}, { localOnly: 'a.example/*' })).text).toContain(CORRECTION);
  });

  it('sends a correction of another origin only with "use corrections from other sites"', async () => {
    const memory = newMemory();
    await memory.put(edit({ origin: 'https://other.example' }));
    expect((await run({ memory })).text).not.toContain(CORRECTION);
    expect((await run({ memory, acrossSites: () => Promise.resolve(false) })).text).not.toContain(CORRECTION);
    expect((await run({ memory, acrossSites: () => Promise.resolve(true) })).text).toContain(CORRECTION);
    // A setting that cannot be read counts as off.
    expect((await run({ memory, acrossSites: () => Promise.reject(new Error('no storage')) })).text).not.toContain(CORRECTION);
  });

  it('sends an imported correction only with the setting on', async () => {
    const memory = newMemory();
    await memory.importMany([{ key: memoryKey('vi', SIMILAR), source: SIMILAR, target: CORRECTION, sourceLang: 'en', targetLang: 'vi', localOnly: false, created: 1 }], { override: false });
    expect((await run({ memory })).text).not.toContain(CORRECTION);
    expect((await run({ memory, acrossSites: () => Promise.resolve(true) })).text).toContain(CORRECTION);
  });

  it('a page without an origin never counts as the same site', async () => {
    const memory = newMemory();
    await memory.put(edit({ origin: 'none' }));
    expect((await run({ memory }, { url: 'data:text/html,<p>x</p>' })).text).not.toContain(CORRECTION);
  });

  it('a correction of another target language is not sent', async () => {
    const memory = newMemory();
    await memory.put(edit({ targetLang: 'fr' }));
    expect((await run({ memory })).text).not.toContain(CORRECTION);
  });

  it('reads the gate once per run; a closed gate sends no examples, while edits still apply to the same source', async () => {
    const memory = newMemory();
    await memory.put(edit());
    await memory.put(edit({ source: PAGE, target: 'Bản sửa chính xác' }));
    let reads = 0;
    const featureAvailable = (id: string) => {
      if (id === 'translation-memory') reads++;
      return Promise.resolve(false);
    };
    const c = client();
    const jobs = session({ translateClient: ok(c), memory, featureAvailable });
    await jobs.start(1, 'd', doc({}, SIMILAR.replace('store', 'keep')));
    expect(reads).toBe(1);
    expect(userText(c)).not.toContain(CORRECTION);
    // The exact source is the user's edit, shown without the feature.
    const exact = client();
    const again = session({ translateClient: ok(exact), memory, featureAvailable });
    await again.start(1, 'd', doc());
    expect(again.get(1)?.segs.get('s0')).toMatchObject({ text: 'Bản sửa chính xác', edited: 'user' });
    expect(exact.requests).toHaveLength(0);
  });

  it('a gate that fails or never answers means no examples, and does not stop the run', async () => {
    const memory = newMemory();
    await memory.put(edit());
    const failing = await run({ memory, featureAvailable: (id) => (id === 'translation-memory' ? Promise.reject(new Error('x')) : Promise.resolve(true)) });
    expect(failing.text).not.toContain(CORRECTION);
    expect(failing.jobs.get(1)?.counts.final).toBe(1);
  });

  it('gives a restarted run the same array until the store changes', async () => {
    const memory = newMemory();
    await memory.put(edit());
    const seen: (readonly MemoryExample[] | undefined)[] = [];
    const c = client();
    const engine = (llm: LLMClient): TranslationEngine => {
      const real = createEngine({ llm: () => llm, now: Date.now, sleep: fakeSleep(), strategies: [singlePass, contextual, refine, explain, basic], prompts: createDefaultPromptRegistry() });
      return {
        ...real,
        translate(job, signal) {
          seen.push(job.options.memory);
          return real.translate(job, signal);
        },
      };
    };
    const jobs = session({ translateClient: ok(c), memory, engine });
    await jobs.start(1, 'd', doc());
    await jobs.start(1, 'd', doc(), { fresh: true });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toHaveLength(1);
    expect(seen[1]).toBe(seen[0]);
    // A write changes the store's counter: the next run reads again.
    await memory.put(edit({ source: 'Open the Settings page to review your options.', target: 'Mở trang Cài đặt.' }));
    await jobs.start(1, 'd', doc(), { fresh: true });
    expect(seen[2]).toHaveLength(2);
  });
});

describe('Jobs: which requests carry the corrections', () => {
  const failing = (): LLMClient => {
    const base = client();
    return {
      model: 'primary',
      reasoningReserveTokens: base.reasoningReserveTokens,
      async *stream() {
        await Promise.resolve();
        yield { type: 'error' as const, error: { kind: 'network' as const, message: 'down' } };
      },
    };
  };
  const withFallback = (primary: LLMClient, backup: LLMClient) => (): Promise<ClientResult> =>
    Promise.resolve({ ok: true, client: primary, profile: GEMINI_PROFILE, fallback: [{ client: backup, profile: { ...GEMINI_PROFILE, id: 'backup', model: 'backup' } }] });
  const instant = () => Promise.resolve();

  it('a refine run sends the correction with its drafts and none with its review', async () => {
    const memory = newMemory();
    await memory.put(edit());
    const c = translatorClient((lines, _n, req) => (isAnalyze(req) ? JSON.stringify(BRIEF) : (req.messages[0]?.content ?? '').startsWith('<review>') ? '<none/>' : renderLines(lines, (t) => `vi:${t}`)), { model: GEMINI_PROFILE.model });
    const jobs = session({ translateClient: ok(c), memory });
    await jobs.start(1, 'd', doc({ strategy: 'refine' }));
    const reviews = c.requests.filter((r) => (r.messages[0]?.content ?? '').startsWith('<review>'));
    const drafts = c.requests.filter((r) => !isAnalyze(r) && !reviews.includes(r));
    expect(reviews.length).toBeGreaterThan(0);
    expect(drafts.some((r) => (r.messages[0]?.content ?? '').includes(CORRECTION))).toBe(true);
    expect(reviews.some((r) => `${r.system}\n${r.messages.map((m) => m.content).join('\n')}`.includes(CORRECTION))).toBe(false);
  });

  it('a fallback link never sees a local-only correction, and sees an ordinary one the same as the primary would', async () => {
    const local = newMemory();
    await local.put(edit({ localOnly: true }));
    const backup = client();
    const guarded = session({ translateClient: withFallback(failing(), backup), memory: local, acrossSites: () => Promise.resolve(true), sleep: instant });
    await guarded.start(1, 'd', doc());
    expect(backup.requests.length).toBeGreaterThan(0);
    expect(userText(backup)).not.toContain(CORRECTION);

    const plain = newMemory();
    await plain.put(edit());
    const backup2 = client();
    const open = session({ translateClient: withFallback(failing(), backup2), memory: plain, sleep: instant });
    await open.start(1, 'd', doc());
    expect(userText(backup2)).toContain(CORRECTION);
  });

  it('gives the rounds of a lazy page the same array', async () => {
    const memory = newMemory();
    await memory.put(edit());
    const seen: (readonly MemoryExample[] | undefined)[] = [];
    const c = client();
    const engine = (llm: LLMClient): TranslationEngine => {
      const real = createEngine({ llm: () => llm, now: Date.now, sleep: fakeSleep(), strategies: [singlePass, contextual, refine, explain, basic], prompts: createDefaultPromptRegistry() });
      return {
        ...real,
        translate(job, signal) {
          seen.push(job.options.memory);
          return real.translate(job, signal);
        },
      };
    };
    const segments: Segment[] = Array.from({ length: 500 }, (_, i) => ({ id: `s${i}`, kind: 'p', text: `${PAGE} Part ${i}`, inlineMarkup: `${PAGE} Part ${i}`, domPath: `/p[${i + 1}]`, translate: true }));
    const jobs = session({ translateClient: ok(c), memory, engine, lazyAbove: 50 });
    await jobs.start(1, 'd', doc({ segments }));
    expect(jobs.get(1)?.lazy).toBeDefined();
    jobs.setViewport(1, 'd', ['s499']);
    for (let i = 0; i < 400 && seen.length < 2; i++) await settle(5);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[0]).toHaveLength(1);
    expect(seen[1]).toBe(seen[0]);
  });
});

describe('Jobs: the memory never delays the first request', () => {
  const firstRequest = async (deps: Partial<JobDeps>) => {
    const c = client();
    const route = ok(c);
    const jobs = session({ translateClient: route, cacheTimeoutMs: 80, ...deps });
    const t0 = performance.now();
    const started = jobs.start(1, 'd', doc());
    while (c.requests.length === 0) await settle(1);
    const ms = performance.now() - t0;
    await started;
    return { ms, c };
  };

  it('a snapshot that never answers costs at most the timeout, and the run goes without examples', async () => {
    const real = newMemory();
    await real.put(edit());
    const stuck = { ...real, version: () => new Promise<number>(() => {}) };
    const { ms, c } = await firstRequest({ memory: stuck });
    expect(ms).toBeLessThan(80 + 150);
    expect(userText(c)).not.toContain(CORRECTION);
  });

  /** 5,000 entries of mixed length: mostly a sentence, some paragraphs, a few near the 4,000-character cap. */
  const bigStore = async () => {
    let seed = 5;
    const next = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    const words = (count: number) => Array.from({ length: count }, () => (next(3) === 0 ? `common${next(6)}` : `word${next(4000)}`)).join(' ');
    const entries = Array.from({ length: 5000 }, (_, i) => {
      const r = i % 20;
      const source = r === 0 ? words(550).slice(0, 3900) : r < 4 ? words(55) : words(12);
      return { key: memoryKey('vi', source), source, target: `Mục ${i}`, sourceLang: 'en', targetLang: 'vi', localOnly: false, created: i + 1 };
    });
    const memory = newMemory();
    await memory.importMany(entries, { override: false });
    await memory.put(edit());
    return memory;
  };
  const best = (xs: number[]) => Math.min(...xs);

  it('a warmed 5,000-entry store adds under 50 ms to the first request, against an empty store in the same run', async () => {
    const full = await bigStore();
    const empty = newMemory();
    const sample = async (memory: TranslationMemory) => {
      const out: number[] = [];
      for (let i = 0; i < 5; i++) {
        const c = client();
        const jobs = session({ translateClient: ok(c), memory, acrossSites: () => Promise.resolve(true), cacheTimeoutMs: 1500 });
        await jobs.warmMemory('vi');
        const t0 = performance.now();
        const started = jobs.start(1, 'd', doc());
        while (c.requests.length === 0) await settle(0);
        out.push(performance.now() - t0);
        await started;
        // The corrections were used when the store has them.
        expect(userText(c).includes(CORRECTION)).toBe(memory === full);
      }
      return best(out);
    };
    const base = await sample(empty);
    const loaded = await sample(full);
    expect(loaded - base).toBeLessThan(50);
  });
});
