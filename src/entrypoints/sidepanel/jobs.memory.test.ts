// Jobs and the translation memory: inline edits shown at once and on every later run (never sent),
// engine events ignored for an edited block, Retranslate page keeping edits, a block's Retranslate
// replacing one only through discardEdit, and imported entries applied only when the user chose so.
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { REVIEWED_REVISION, type Segment } from '@/engine/index';
import { renderLines, translatorClient, wireLines } from '@/engine/testing';
import type { LLMClient, NormalizedRequest } from '@/llm/types';
import { openTranslationCache, type TranslationCache } from '@/shared/cache';
import { memoryKey, NO_ORIGIN, openTranslationMemory, type TranslationMemory } from '@/shared/memory';
import { GEMINI_PROFILE } from '@/shared/settings';
import { applySegmentEvent, Jobs, type ClientResult, type JobDeps, type JobDoc, type SegState } from './jobs.ts';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const source = (i: number) => `P${i} ${words(120)}`;
function doc(n: number, over: Partial<JobDoc> = {}): JobDoc {
  const segments: Segment[] = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, kind: 'p', text: source(i), inlineMarkup: source(i), domPath: `/p[${i + 1}]`, translate: true }));
  return { url: 'https://example.com/page', title: 'T', sourceLang: 'en', targetLang: 'vi', segments, ...over };
}
const BRIEF = { language: 'en', genre: 'blog post', audience: 'developers', purpose: 'explain', tone: 'dry', glossary: [] };
const isAnalyze = (req: NormalizedRequest) => req.system.startsWith('You prepare a translator');
const isReview = (req: NormalizedRequest) => (req.messages[0]?.content ?? '').startsWith('<review>');
const reviewItems = (req: NormalizedRequest) => [...(req.messages[0]?.content ?? '').matchAll(/<item id="(\d+)">\n<source>(.*)<\/source>\n<translation>(.*)<\/translation>/g)].map((m) => ({ n: Number(m[1]), draft: m[3] ?? '' }));

/** Drafts are `vi:` + source; a review rewrites every draft; with `hold`, review calls wait for `release`. */
function client(opts: { hold?: boolean } = {}) {
  const inner = translatorClient(
    (lines, _n, req) => {
      if (isAnalyze(req)) return JSON.stringify(BRIEF);
      if (!isReview(req)) return renderLines(lines, (s) => `vi:${s}`);
      return reviewItems(req)
        .map(({ n, draft }) => `<seg id="${n}">rv:${draft}</seg>`)
        .join('\n');
    },
    { model: GEMINI_PROFILE.model },
  );
  const held: (() => void)[] = [];
  const c: LLMClient & { requests: NormalizedRequest[]; held: (() => void)[] } = {
    model: inner.model,
    reasoningReserveTokens: inner.reasoningReserveTokens,
    requests: inner.requests,
    held,
    async *stream(req) {
      if (isReview(req) && opts.hold) {
        await new Promise<void>((resolve, reject) => {
          held.push(resolve);
          req.signal.addEventListener('abort', () => reject(req.signal.reason), { once: true });
        });
      }
      yield* inner.stream(req);
    },
  };
  return c;
}
/** The sources of every translate request (lines and review items alike). */
const sent = (c: { requests: NormalizedRequest[] }) => c.requests.filter((r) => !isAnalyze(r)).flatMap((r) => (isReview(r) ? [...(r.messages[0]?.content ?? '').matchAll(/<source>(.*)<\/source>/g)].map((m) => m[1] ?? '') : wireLines(r.messages[0]?.content ?? '').map((l) => l.source)));

const ok = (c: LLMClient, extra: Partial<Extract<ClientResult, { ok: true }>> = {}) => (): Promise<ClientResult> => Promise.resolve({ ok: true, client: c, profile: GEMINI_PROFILE, ...extra });
const newMemory = () => openTranslationMemory({ factory: new IDBFactory() }) as TranslationMemory;
const newCache = () => openTranslationCache({ factory: new IDBFactory() }) as TranslationCache;
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await settle(2);
  }
}
const session = (deps: JobDeps) => {
  const jobs = new Jobs(deps);
  jobs.setActive(1);
  return jobs;
};
const seg = (jobs: Jobs, id: string) => jobs.get(1)?.segs.get(id);
const key = (i: number, lang = 'vi') => memoryKey(lang, source(i));

describe('applySegmentEvent: an edited block', () => {
  it('ignores a later final, a review revision and a failure', () => {
    const cur: SegState = { status: 'final', text: 'mine', revision: 1, attempt: 1, edited: 'user' };
    expect(applySegmentEvent(cur, { type: 'segment.final', id: 'a', text: 'late', revision: 2, producedBy: { strategy: 'contextual', stage: 'revise', model: 'm' } })).toBe(cur);
    expect(applySegmentEvent(cur, { type: 'segment.final', id: 'a', text: 'rv', revision: REVIEWED_REVISION, producedBy: { strategy: 'refine', stage: 'review', model: 'm' } })).toBe(cur);
    expect(applySegmentEvent(cur, { type: 'segment.failed', id: 'a', error: { kind: 'unknown', message: 'x' } })).toBe(cur);
    expect(applySegmentEvent(cur, { type: 'segment.partial', id: 'a', text: 'p' })).toBe(cur);
  });
});

describe('Jobs.edit and the translation memory', () => {
  it('shows the edit at once, stores it with its provenance, and never writes it to the cache', async () => {
    const memory = newMemory();
    const cache = newCache();
    const jobs = session({ translateClient: ok(client()), memory, cache });
    await jobs.start(1, 'd', doc(4));
    await jobs.edit(1, 's1', '  Bản dịch của tôi\u0007 ');
    expect(seg(jobs, 's1')).toEqual({ status: 'final', text: 'Bản dịch của tôi', revision: 1, attempt: 1, edited: 'user' });
    const entry = (await memory.getMany([key(1)])).get(key(1));
    expect(entry).toMatchObject({ source: source(1), target: 'Bản dịch của tôi', sourceLang: 'en', targetLang: 'vi', origin: 'https://example.com', localOnly: false, by: 'user', override: true });
    await jobs.cacheIdle();
    // The cache keeps what the model translated: a session without the memory shows it.
    const again = session({ translateClient: ok(client()), cache });
    await again.start(1, 'd', doc(4));
    expect(seg(again, 's1')?.text).toBe(`vi:${source(1)}`);
  });

  it('a reload shows the edit before the cache and the engine, and never sends its source', async () => {
    const memory = newMemory();
    const cache = newCache();
    const first = session({ translateClient: ok(client()), memory, cache });
    await first.start(1, 'd', doc(4));
    await first.edit(1, 's2', 'Đoạn đã sửa');
    await first.cacheIdle();

    // The cache is cleared too: the edit does not depend on it.
    await cache.clear();
    const c = client();
    const second = session({ translateClient: ok(c), memory, cache });
    await second.start(1, 'd', doc(4));
    expect(seg(second, 's2')).toMatchObject({ status: 'final', text: 'Đoạn đã sửa', edited: 'user' });
    expect(second.get(1)?.counts).toEqual({ total: 4, final: 4, failed: 0 });
    expect(sent(c)).not.toContain(source(2));
    expect(sent(c)).toContain(source(0));
    // An edit counts as shown, not as cached.
    expect(second.get(1)?.cached).toBe(0);
  });

  it('applies across models and strategies, without a cache, and only for the same target language', async () => {
    const memory = newMemory();
    const first = session({ translateClient: ok(client()), memory });
    await first.start(1, 'd', doc(3));
    await first.edit(1, 's0', 'Sửa');
    const c = client();
    const fr = session({ translateClient: ok({ ...c, model: 'other' }), memory, strategy: 'single-pass' });
    await fr.start(1, 'd', doc(3));
    expect(seg(fr, 's0')?.edited).toBe('user');
    await fr.start(1, 'd', doc(3, { targetLang: 'fr' }));
    expect(seg(fr, 's0')?.edited).toBeUndefined();
  });

  it('marks an edit made on a page under a local-only site rule, and keeps that mark for a later run', async () => {
    const memory = newMemory();
    const jobs = session({ translateClient: ok(client(), { localOnly: 'intranet.example/*' }), memory });
    await jobs.start(1, 'd', doc(2));
    await jobs.edit(1, 's0', 'Nội bộ');
    expect((await memory.getMany([key(0)])).get(key(0))?.localOnly).toBe(true);
  });

  it('marks an edit local-only when a site rule covers the page at edit time, or the rule cannot be read', async () => {
    for (const siteLocalOnly of [() => Promise.resolve(true), () => Promise.reject(new Error('no settings'))]) {
      const memory = newMemory();
      const jobs = session({ translateClient: ok(client()), memory, siteLocalOnly });
      await jobs.start(1, 'd', doc(2));
      await jobs.edit(1, 's0', 'Nội bộ');
      expect((await memory.getMany([key(0)])).get(key(0))?.localOnly).toBe(true);
    }
    const memory = newMemory();
    const jobs = session({ translateClient: ok(client()), memory, siteLocalOnly: () => Promise.resolve(false) });
    await jobs.start(1, 'd', doc(2));
    await jobs.edit(1, 's0', 'Công khai');
    expect((await memory.getMany([key(0)])).get(key(0))?.localOnly).toBe(false);
  });

  it('an edit on a page without an origin is stored with the no-origin mark', async () => {
    const memory = newMemory();
    const jobs = session({ translateClient: ok(client()), memory });
    await jobs.start(1, 'd', doc(2, { url: 'data:text/html,<p>x</p>' }));
    await jobs.edit(1, 's0', 'Sửa');
    expect((await memory.getMany([key(0)])).get(key(0))?.origin).toBe(NO_ORIGIN);
  });

  it('an edit that cannot be saved stays on screen for the session and says so', async () => {
    const memory = { ...newMemory(), put: () => Promise.reject(new Error('quota')) };
    const jobs = session({ translateClient: ok(client()), memory });
    await jobs.start(1, 'd', doc(2));
    await jobs.edit(1, 's0', 'Sửa');
    expect(seg(jobs, 's0')).toMatchObject({ text: 'Sửa', edited: 'user', editUnsaved: true });
    // Without any memory too.
    const bare = session({ translateClient: ok(client()) });
    await bare.start(1, 'd', doc(2));
    await bare.edit(1, 's0', 'Sửa');
    expect(seg(bare, 's0')).toMatchObject({ edited: 'user', editUnsaved: true });
  });

  it('edits only a final block, and never with empty text', async () => {
    const memory = newMemory();
    const jobs = session({ translateClient: ok(client()), memory });
    await jobs.start(1, 'd', doc(2));
    await jobs.edit(1, 's0', '   ');
    await jobs.edit(1, 'nope', 'x');
    expect(seg(jobs, 's0')?.edited).toBeUndefined();
    expect(await memory.count()).toBe(0);
  });

  it('two quick saves of a block store the newer text, even when the older one reads its site rule slowly', async () => {
    const memory = newMemory();
    let calls = 0;
    // The first save's rule read is the slow one.
    const siteLocalOnly = () => (calls++ === 0 ? settle(40).then(() => false) : Promise.resolve(false));
    const jobs = session({ translateClient: ok(client()), memory, siteLocalOnly });
    await jobs.start(1, 'd', doc(2));
    await Promise.all([jobs.edit(1, 's0', 'Bản cũ'), jobs.edit(1, 's0', 'Bản mới')]);
    expect(seg(jobs, 's0')).toMatchObject({ text: 'Bản mới', edited: 'user' });
    expect((await memory.getMany([key(0)])).get(key(0))?.target).toBe('Bản mới');
    expect(await memory.count()).toBe(1);
  });

  it('a Retranslate confirmed right after a save is not undone by that save', async () => {
    const memory = newMemory();
    const siteLocalOnly = () => settle(40).then(() => false);
    const jobs = session({ translateClient: ok(client()), memory, siteLocalOnly, cache: newCache() });
    await jobs.start(1, 'd', doc(2));
    const saving = jobs.edit(1, 's0', 'Của tôi');
    await jobs.discardEdit(1, 's0');
    await saving;
    expect(seg(jobs, 's0')).toMatchObject({ status: 'final', text: `vi:${source(0)}` });
    expect(seg(jobs, 's0')?.edited).toBeUndefined();
    expect(await memory.count()).toBe(0);
  });

  it('a memory that never answers does not hold the translation', async () => {
    const memory = { ...newMemory(), getMany: () => new Promise<never>(() => {}) };
    const jobs = session({ translateClient: ok(client()), memory, cacheTimeoutMs: 30 });
    await jobs.start(1, 'd', doc(2));
    expect(jobs.get(1)?.counts.final).toBe(2);
  });
});

describe('A Best run in progress and an edit', () => {
  it('a review revision arriving after the edit leaves the edit, on screen and out of the cache', async () => {
    const memory = newMemory();
    const cache = newCache();
    const c = client({ hold: true });
    const jobs = session({ translateClient: ok(c), memory, cache, featureAvailable: () => Promise.resolve(true) });
    const run = jobs.start(1, 'd', doc(4, { strategy: 'refine' }));
    await until(() => c.held.length > 0);
    expect(seg(jobs, 's1')?.text).toBe(`vi:${source(1)}`);
    await jobs.edit(1, 's1', 'Bản của tôi');
    for (const go of c.held.splice(0)) go();
    await until(() => c.held.length > 0 || jobs.get(1)?.status === 'done');
    while (jobs.get(1)?.status === 'running') {
      for (const go of c.held.splice(0)) go();
      await settle(5);
    }
    await run;
    await jobs.cacheIdle();
    expect(seg(jobs, 's1')).toEqual({ status: 'final', text: 'Bản của tôi', revision: 1, attempt: 1, edited: 'user' });
    // The other blocks were refined as usual.
    expect(seg(jobs, 's0')).toMatchObject({ refined: true, text: `rv:vi:${source(0)}` });
    // A reload shows the edit, not the review's revision of the block.
    const again = session({ translateClient: ok(client()), memory, cache, featureAvailable: () => Promise.resolve(true) });
    await again.start(1, 'd', doc(4, { strategy: 'refine' }));
    expect(seg(again, 's1')).toMatchObject({ text: 'Bản của tôi', edited: 'user' });
  });
});

describe('Retranslate and edited blocks', () => {
  it('Retranslate page keeps the edited blocks, sends none of them, and says how many it kept', async () => {
    const memory = newMemory();
    const c = client();
    const jobs = session({ translateClient: ok(c), memory, cache: newCache() });
    await jobs.start(1, 'd', doc(4));
    await jobs.edit(1, 's0', 'Một');
    await jobs.edit(1, 's3', 'Bốn');
    const before = c.requests.length;
    await jobs.start(1, 'd', doc(4), { fresh: true, keepCost: true });
    const v = jobs.get(1);
    expect(v?.status).toBe('done');
    expect(v?.editsKept).toBe(2);
    expect(seg(jobs, 's0')).toMatchObject({ text: 'Một', edited: 'user' });
    expect(seg(jobs, 's3')).toMatchObject({ text: 'Bốn', edited: 'user' });
    const resent = sent({ requests: c.requests.slice(before) });
    expect(resent).toContain(source(1));
    expect(resent).not.toContain(source(0));
    expect(resent).not.toContain(source(3));
  });

  it('Retranslate page after a change of target language does not keep edits made in the other language', async () => {
    const memory = newMemory();
    const c = client();
    const jobs = session({ translateClient: ok(c), memory });
    await jobs.start(1, 'd', doc(2));
    await jobs.edit(1, 's0', 'Một');
    const before = c.requests.length;
    await jobs.start(1, 'd', doc(2, { targetLang: 'fr' }), { fresh: true, keepCost: true });
    expect(seg(jobs, 's0')).toMatchObject({ status: 'final', text: `vi:${source(0)}` });
    expect(seg(jobs, 's0')?.edited).toBeUndefined();
    expect(jobs.get(1)?.editsKept).toBeUndefined();
    expect(sent({ requests: c.requests.slice(before) })).toContain(source(0));
    // The Vietnamese edit is still there for Vietnamese.
    expect(await memory.count()).toBe(1);
  });

  it('"Continue anyway" after the spend limit, when replacing an edit, still replaces it', async () => {
    const memory = newMemory();
    let limited = false;
    const jobs = session({ translateClient: ok(client()), memory, spendLimit: () => Promise.resolve(limited ? { monthUsd: 6, limitUsd: 5 } : undefined) });
    await jobs.start(1, 'd', doc(2));
    await jobs.edit(1, 's0', 'Của tôi');
    limited = true;
    await jobs.discardEdit(1, 's0');
    expect(seg(jobs, 's0')).toMatchObject({ text: 'Của tôi', edited: 'user' });
    expect(jobs.get(1)?.limit).toBeDefined();
    limited = false;
    const next = jobs.takeAfterLimit(1);
    expect(next).toBeDefined();
    await next?.();
    expect(seg(jobs, 's0')).toMatchObject({ status: 'final', text: `vi:${source(0)}` });
    expect(seg(jobs, 's0')?.edited).toBeUndefined();
    expect(await memory.count()).toBe(0);
  });

  it("a block's Retranslate leaves an edit alone; discardEdit translates it again and deletes the entry", async () => {
    const memory = newMemory();
    const c = client();
    const jobs = session({ translateClient: ok(c), memory, cache: newCache() });
    await jobs.start(1, 'd', doc(3));
    await jobs.edit(1, 's1', 'Của tôi');
    const before = c.requests.length;
    await jobs.retranslateSegment(1, 's1');
    expect(c.requests.length).toBe(before);
    expect(seg(jobs, 's1')?.edited).toBe('user');

    await jobs.discardEdit(1, 's1');
    expect(seg(jobs, 's1')).toMatchObject({ status: 'final', text: `vi:${source(1)}` });
    expect(seg(jobs, 's1')?.edited).toBeUndefined();
    expect(await memory.count()).toBe(0);
    // Not an edit: discardEdit does nothing.
    const after = c.requests.length;
    await jobs.discardEdit(1, 's0');
    expect(c.requests.length).toBe(after);
  });

  it('a discardEdit that fails keeps the edit on screen and in the memory', async () => {
    const memory = newMemory();
    let broken = false;
    const route = ok(client());
    const jobs = session({ translateClient: () => (broken ? Promise.resolve<ClientResult>({ ok: false, error: { kind: 'auth', message: 'bad key' } }) : route()), memory });
    await jobs.start(1, 'd', doc(2));
    await jobs.edit(1, 's0', 'Của tôi');
    broken = true;
    await jobs.discardEdit(1, 's0');
    expect(seg(jobs, 's0')).toMatchObject({ text: 'Của tôi', edited: 'user', redoError: { kind: 'auth' } });
    expect(await memory.count()).toBe(1);
  });

  it('a memory that cannot delete keeps the edit and says the retranslate failed', async () => {
    const real = newMemory();
    const memory = { ...real, delete: () => Promise.reject(new Error('blocked')) };
    const jobs = session({ translateClient: ok(client()), memory });
    await jobs.start(1, 'd', doc(2));
    await jobs.edit(1, 's0', 'Của tôi');
    await jobs.discardEdit(1, 's0');
    expect(seg(jobs, 's0')).toMatchObject({ text: 'Của tôi', edited: 'user', redoError: { kind: 'unknown' } });
    expect(await real.count()).toBe(1);
  });
});

describe('Imported entries', () => {
  const imported = async (override: boolean) => {
    const memory = newMemory();
    await memory.importMany([{ key: key(0), source: source(0), target: 'Từ tệp', sourceLang: 'en', targetLang: 'vi', localOnly: false, created: 1 }], { override });
    const c = client();
    const jobs = session({ translateClient: ok(c), memory });
    await jobs.start(1, 'd', doc(2));
    return { jobs, c };
  };

  it('are examples only by default: the block is translated as usual', async () => {
    const { jobs, c } = await imported(false);
    expect(seg(jobs, 's0')).toMatchObject({ text: `vi:${source(0)}` });
    expect(seg(jobs, 's0')?.edited).toBeUndefined();
    expect(sent(c)).toContain(source(0));
  });

  it('replace matching blocks when the user ticked it, marked as imported, never sent', async () => {
    const { jobs, c } = await imported(true);
    expect(seg(jobs, 's0')).toMatchObject({ text: 'Từ tệp', edited: 'import' });
    expect(sent(c)).not.toContain(source(0));
  });
});
