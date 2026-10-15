// @vitest-environment jsdom
// The quality setting through the translator: a mode, override or keep-drafts switch restarts the
// open page (refresh and resume) with the brief and cost kept and the cache read, and `refine`
// runs only when the job-start check allows it, whatever its source.
import { PRIVACY_NOTICE_VERSION } from './privacy.ts';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '@/engine/index';
import { translatorClient } from '@/engine/testing';
import type { LLMClient, NormalizedRequest } from '@/llm/types';
import { openTranslationCache, type TranslationCache } from '@/shared/cache';
import type { JobRecord } from '@/shared/diagnostics';
import { GEMINI_PROFILE } from '@/shared/settings';
import type { SessionHooks } from './controller.ts';
import { createTranslator } from './translator.ts';

// Best is held back from release; these tests exercise it, so they run with the switch on.
vi.mock('@/shared/quality', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/shared/quality')>()), BEST_MODE_RELEASED: true }));

type Api = Parameters<typeof createTranslator>[0];
type Ready = Parameters<Required<SessionHooks>['ready']>[2];

/** Storage that answers at once; a write to `quality` (or `prefs`) reaches the change listeners. */
function fakeApi(initial: Record<string, unknown> = {}) {
  const sync = new Map<string, unknown>([['prefs', { targetLang: 'vi', sourceLang: 'auto' }], ...Object.entries(initial)]);
  const onSync = new Set<(c: Record<string, unknown>) => void>();
  const none = { addListener: () => {}, removeListener: () => {} };
  const api = {
    storage: {
      sync: {
        get: (k: string | string[]) => Promise.resolve(typeof k === 'string' && sync.has(k) ? { [k]: structuredClone(sync.get(k)) } : {}),
        onChanged: { addListener: (fn: never) => onSync.add(fn), removeListener: (fn: never) => onSync.delete(fn) },
      },
      local: { get: () => Promise.resolve({ privacyNotice: { version: PRIVACY_NOTICE_VERSION, at: 0 } }), set: () => Promise.resolve(), onChanged: none },
      session: { onChanged: none, get: () => Promise.resolve({}), remove: () => Promise.resolve() },
    },
    permissions: { onAdded: none },
    i18n: { getUILanguage: () => 'en' },
  } as unknown as Api;
  return {
    api,
    setQuality(quality: unknown) {
      sync.set('quality', quality);
      for (const fn of onSync) fn({ quality: { newValue: quality } });
    },
  };
}

const text = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ');
// Three chunks: the brief is asked only for pages of two chunks or more.
const segments: Segment[] = Array.from({ length: 36 }, (_, i) => ({ id: `s${i}`, kind: 'p', text, inlineMarkup: text, domPath: `/p[${i + 1}]`, translate: true }));
const page = { ok: true, via: 'walk', url: 'https://x/', title: 'Page', lang: 'en', segments } as Ready;
const BRIEF = JSON.stringify({ language: 'en', genre: 'blog post', audience: 'developers', purpose: 'explain', tone: 'dry', glossary: [] });
const isAnalyze = (r: NormalizedRequest) => r.system.startsWith('You prepare a translator');
const isReview = (r: NormalizedRequest) => (r.messages[0]?.content ?? '').startsWith('<review>');
const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await settle(5);
  }
}

/** One client for every role: drafts echo, the brief is fixed, a review finds nothing to change. */
function setup(initial: Record<string, unknown> = {}, featureAvailable?: () => Promise<boolean>) {
  const f = fakeApi(initial);
  const inner = translatorClient((lines, _n, req) => (isAnalyze(req) ? BRIEF : isReview(req) ? '<none/>' : lines.map((l) => `<seg id="${l.n}">vi:${l.source}</seg>`).join('\n')));
  // Translate calls wait while `hold` is on, so a test can cancel a job that is running.
  const gate = { held: false, release: () => {} };
  const c: typeof inner = Object.assign(Object.create(inner) as typeof inner, {
    async *stream(req: NormalizedRequest) {
      if (gate.held && !isAnalyze(req) && !isReview(req)) {
        await new Promise<void>((done, fail) => {
          gate.release = done;
          req.signal.addEventListener('abort', () => fail(req.signal.reason), { once: true });
        });
      }
      yield* inner.stream(req);
    },
  });
  const resolve = () => Promise.resolve({ ok: true as const, client: c as LLMClient, profile: GEMINI_PROFILE, review: () => Promise.resolve({ ok: true as const, client: c as LLMClient, profile: GEMINI_PROFILE }) });
  const records: JobRecord[] = [];
  const t = createTranslator(f.api, { translateClient: resolve, onJobRecord: (r) => records.push(r), cache: openTranslationCache({ factory: new IDBFactory() }) as TranslationCache, ...(featureAvailable ? { featureAvailable } : {}) });
  const hooks = t.hooks as Required<SessionHooks>;
  const stop = t.watch(() => 1);
  const counts = () => ({ analyze: inner.requests.filter(isAnalyze).length, review: inner.requests.filter(isReview).length, translate: inner.requests.filter((r) => !isAnalyze(r) && !isReview(r)).length, all: inner.requests.length });
  const strategies = () => records.filter((r) => r.outcome === 'started').map((r) => r.strategy);
  const open = async () => {
    hooks.active(1);
    hooks.ready(1, 'd', page);
    await until(() => t.jobs.get(1)?.status === 'done');
  };
  /** Waits for the next finished run after `starts` runs had started. */
  const after = async (starts: number) => {
    await until(() => strategies().length > starts && t.jobs.get(1)?.status === 'done');
    await settle(20);
  };
  return { f, t, c, gate, hooks, stop, records, counts, strategies, open, after };
}

describe('a quality switch re-translates the open page', () => {
  it('Balanced to Best restarts with refine, keeping the brief and the cost; Best back to Balanced reads the cache with no call', async () => {
    const s = setup();
    await s.open();
    expect(s.strategies()).toEqual(['contextual']);
    expect(s.counts().analyze).toBe(1);
    const cost = s.t.jobs.get(1)?.cost ?? 0;

    s.f.setQuality({ mode: 'best', keepDraftsOnScreen: false });
    await s.after(1);
    expect(s.strategies()).toEqual(['contextual', 'refine']);
    expect(s.counts().analyze).toBe(1);
    expect(s.counts().review).toBeGreaterThan(0);
    expect(s.t.jobs.get(1)?.brief?.genre).toBe('blog post');
    expect(s.t.jobs.get(1)?.cost ?? 0).toBeGreaterThan(cost);

    const before = s.counts().all;
    s.f.setQuality({ mode: 'balanced', keepDraftsOnScreen: false });
    await s.after(2);
    expect(s.strategies()).toEqual(['contextual', 'refine', 'contextual']);
    expect(s.counts().all).toBe(before);
    expect(s.t.jobs.get(1)?.counts.final).toBe(segments.length);
    s.stop();
  });

  it('an advanced override restarts the page and wins over the mode', async () => {
    const s = setup();
    await s.open();
    s.f.setQuality({ mode: 'balanced', strategy: 'single-pass', keepDraftsOnScreen: false });
    await s.after(1);
    expect(s.strategies()).toEqual(['contextual', 'single-pass']);
    s.stop();
  });

  it('a keep-drafts change restarts the page, and the same quality again does not', async () => {
    const s = setup({ quality: { mode: 'best', keepDraftsOnScreen: false } });
    await s.open();
    expect(s.strategies()).toEqual(['refine']);
    s.f.setQuality({ mode: 'best', keepDraftsOnScreen: false });
    await settle(60);
    expect(s.strategies()).toEqual(['refine']);
    s.f.setQuality({ mode: 'best', keepDraftsOnScreen: true });
    await s.after(1);
    expect(s.strategies()).toEqual(['refine', 'refine']);
    s.stop();
  });

  it('a keep-drafts toggle on Balanced, where it does nothing, does not restart the page', async () => {
    const s = setup();
    await s.open();
    s.f.setQuality({ mode: 'balanced', keepDraftsOnScreen: true });
    await settle(80);
    expect(s.strategies()).toEqual(['contextual']);
    s.stop();
  });

  it('a switch made while the job is cancelled applies when it resumes, not before', async () => {
    const s = setup();
    s.gate.held = true;
    s.hooks.active(1);
    s.hooks.ready(1, 'd', page);
    await until(() => s.t.jobs.get(1)?.status === 'running');
    s.t.actions(1).cancel();
    s.f.setQuality({ mode: 'fast', keepDraftsOnScreen: false });
    await settle(60);
    expect(s.t.jobs.get(1)?.status).toBe('cancelled');
    expect(s.strategies()).toEqual(['contextual']);
    s.gate.held = false;
    s.t.actions(1).resume();
    await s.after(1);
    expect(s.strategies()).toEqual(['contextual', 'single-pass']);
    expect(s.t.jobs.get(1)?.counts.final).toBe(segments.length);
    s.stop();
  });

  it('a stored mode nobody knows is Balanced, and the page keeps its job', async () => {
    const s = setup({ quality: { mode: 'turbo', strategy: 'magic' } });
    await s.open();
    expect(s.strategies()).toEqual(['contextual']);
    s.stop();
  });
});

describe('best-mode gates refine from every source', () => {
  const locked = () => Promise.resolve(false);
  const sources: [string, Record<string, unknown>][] = [
    ['the header mode', { mode: 'best', keepDraftsOnScreen: false }],
    ['the advanced override', { mode: 'balanced', strategy: 'refine', keepDraftsOnScreen: false }],
    ['an imported setting', { mode: 'fast', strategy: 'refine', keepDraftsOnScreen: true, extra: 'ignored' }],
  ];
  for (const [name, quality] of sources) {
    it(`${name}: a locked job runs contextual and makes no review call`, async () => {
      const s = setup({ quality }, locked);
      await s.open();
      const done = s.records.filter((r) => r.outcome === 'done');
      expect(done.map((r) => r.strategy)).toEqual(['contextual']);
      expect(s.counts().review).toBe(0);
      s.stop();
    });
    it(`${name}: an available feature runs refine`, async () => {
      const s = setup({ quality });
      await s.open();
      expect(s.records.filter((r) => r.outcome === 'done').map((r) => r.strategy)).toEqual(['refine']);
      s.stop();
    });
  }

  it('the answer is read once per job start', async () => {
    let asked = 0;
    const s = setup({ quality: { mode: 'best', keepDraftsOnScreen: false } }, () => (asked++, Promise.resolve(true)));
    await s.open();
    expect(asked).toBe(1);
    s.stop();
  });
});
