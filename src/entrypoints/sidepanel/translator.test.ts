// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/index';
import type { LLMClient } from '@/llm/types';
import { translatorClient } from '@/engine/testing';
import { GEMINI_PROFILE } from '@/shared/settings';
import type { SessionHooks } from './controller.ts';
import { createTranslator } from './translator.ts';

type Api = Parameters<typeof createTranslator>[0];
type Ready = Parameters<Required<SessionHooks>['ready']>[2];

/** Storage whose `sync.get` answers only when the test says so, plus change listeners. */
function fakeApi() {
  const sync = new Map<string, unknown>([['prefs', { targetLang: 'vi', sourceLang: 'auto' }]]);
  const gets: (() => void)[] = [];
  const onSync = new Set<(c: Record<string, unknown>) => void>();
  const listeners = () => ({ addListener: () => {}, removeListener: () => {} });
  const api = {
    storage: {
      sync: {
        get: (k: string) => new Promise((resolve) => gets.push(() => resolve(sync.has(k) ? { [k]: sync.get(k) } : {}))),
        onChanged: { addListener: (fn: never) => onSync.add(fn), removeListener: (fn: never) => onSync.delete(fn) },
      },
      local: { onChanged: listeners() },
    },
    permissions: { onAdded: listeners() },
    i18n: { getUILanguage: () => 'en' },
  } as unknown as Api;
  return {
    api,
    answer: () => gets.splice(0).forEach((g) => g()),
    setPrefs(prefs: unknown) {
      sync.set('prefs', prefs);
      for (const fn of onSync) fn({ prefs: { newValue: prefs } });
    },
    setGlossary(glossary: unknown) {
      sync.set('glossary', glossary);
      for (const fn of onSync) fn({ glossary: { newValue: glossary } });
    },
  };
}

const text = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ');
const segments: Segment[] = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, kind: 'p', text, inlineMarkup: text, domPath: `/p[${i + 1}]`, translate: true }));
const result = { ok: true, via: 'walk', url: 'https://x/', title: 'Page', lang: 'en', segments } as Ready;
// Three chunks: the brief is asked only for pages of two chunks or more (M2-D9), and later chunks carry it (M2-D6).
const long = Array.from({ length: 36 }, (_, i) => ({ ...segments[0], id: `l${i}`, domPath: `/p[${i + 1}]` })) as Segment[];
const longResult = { ...result, segments: long } as Ready;
const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const client = () => () => Promise.resolve({ ok: true as const, client: translatorClient(), profile: GEMINI_PROFILE });

describe('translator wiring (plan M1-E8)', () => {
  it('starts no job for a page that went away, or a tab that closed, while the settings were read (review E-R1)', async () => {
    const f = fakeApi();
    const t = createTranslator(f.api, { translateClient: client() });
    const hooks = t.hooks as Required<SessionHooks>;
    hooks.active(1);
    hooks.ready(1, 'd', result);
    hooks.gone(1);
    hooks.ready(2, 'e', result);
    hooks.closed(2);
    f.answer();
    await settle();
    expect(t.jobs.get(1)).toBeUndefined();
    expect(t.jobs.get(2)).toBeUndefined();

    // The page read again: it does start.
    hooks.ready(1, 'd2', result);
    f.answer();
    await settle();
    expect(t.jobs.docOf(1)).toBe('d2');
  });

  it('a language change restarts the active page and keeps what the earlier run cost (review E-R3)', async () => {
    const f = fakeApi();
    const t = createTranslator(f.api, { translateClient: client() });
    const hooks = t.hooks as Required<SessionHooks>;
    const stop = t.watch(() => 1);
    hooks.active(1);
    hooks.ready(1, 'd', result);
    f.answer();
    await settle(50);
    const before = t.jobs.get(1);
    expect(before?.status).toBe('done');
    expect(before?.cost ?? 0).toBeGreaterThan(0);

    f.setPrefs({ targetLang: 'ja', sourceLang: 'auto' });
    f.answer();
    await settle(50);
    const after = t.jobs.get(1);
    expect(after?.targetLang).toBe('ja');
    expect(after?.status).toBe('done');
    expect(after?.cost ?? 0).toBeGreaterThan(before?.cost ?? 0);

    // A page that has gone is not restarted by a later change.
    hooks.gone(1);
    f.setPrefs({ targetLang: 'de', sourceLang: 'auto' });
    f.answer();
    await settle(20);
    expect(t.jobs.get(1)?.targetLang).toBe('ja');
    stop();
  });

  describe('source language and same-language skip (plan M2-E5)', () => {
    const detector = (lang: string, confidence = 0.95) => ({ detect: async () => [{ detectedLanguage: lang, confidence }] });
    const counting = () => {
      const c = { resolved: 0 };
      const resolve = () => {
        c.resolved++;
        return client()();
      };
      return Object.assign(c, { resolve });
    };
    async function ready(t: ReturnType<typeof createTranslator>, f: ReturnType<typeof fakeApi>, page: Ready = result) {
      const hooks = t.hooks as Required<SessionHooks>;
      hooks.active(1);
      hooks.ready(1, 'd', page);
      f.answer();
      await settle(50);
      return t.jobs.get(1);
    }

    it('skips a page the detector reads as the target language: nothing resolved, nothing sent', async () => {
      const f = fakeApi();
      const c = counting();
      const t = createTranslator(f.api, { translateClient: c.resolve }, { detector: detector('vi') });
      const v = await ready(t, f);
      expect(v?.status).toBe('skipped');
      expect(v?.detection).toEqual({ lang: 'vi', via: 'detector', confidence: 0.95 });
      expect(c.resolved).toBe(0);
    });

    it('the detector beats a wrong <html lang>, both ways', async () => {
      const f1 = fakeApi();
      const t1 = createTranslator(f1.api, { translateClient: client() }, { detector: detector('en') });
      const v1 = await ready(t1, f1, { ...result, lang: 'vi' } as Ready);
      expect(v1?.status).toBe('done');
      expect(v1?.sourceLang).toBe('en');
      const f2 = fakeApi();
      const t2 = createTranslator(f2.api, { translateClient: client() }, { detector: detector('vi') });
      expect((await ready(t2, f2, { ...result, lang: 'en' } as Ready))?.status).toBe('skipped');
    });

    it('without a detector, <html lang> decides; an unknown language is translated', async () => {
      const f1 = fakeApi();
      const t1 = createTranslator(f1.api, { translateClient: client() }, { detector: undefined });
      const v1 = await ready(t1, f1, { ...result, lang: 'vi-VN' } as Ready);
      expect(v1?.status).toBe('skipped');
      expect(v1?.detection?.via).toBe('html-lang');
      const f2 = fakeApi();
      const t2 = createTranslator(f2.api, { translateClient: client() }, { detector: undefined });
      const noLang = { ...result } as Ready & { lang?: string };
      delete noLang.lang;
      const v2 = await ready(t2, f2, noLang);
      expect(v2?.status).toBe('done');
      expect(v2?.detection).toEqual({ lang: '', via: 'unknown' });
    });

    it('a target-language change un-skips the page; Translate anyway (resume) translates it', async () => {
      const f = fakeApi();
      const t = createTranslator(f.api, { translateClient: client() }, { detector: detector('vi') });
      const stop = t.watch(() => 1);
      expect((await ready(t, f))?.status).toBe('skipped');
      f.setPrefs({ targetLang: 'ja', sourceLang: 'auto' });
      f.answer();
      await settle(50);
      expect(t.jobs.get(1)?.status).toBe('done');
      expect(t.jobs.get(1)?.sourceLang).toBe('vi');
      stop();

      const g = fakeApi();
      const u = createTranslator(g.api, { translateClient: client() }, { detector: detector('vi') });
      await ready(u, g);
      u.actions(1).resume();
      g.answer();
      await settle(50);
      expect(u.jobs.get(1)?.status).toBe('done');
      expect(u.jobs.get(1)?.counts.final).toBe(segments.length);

      // Settings changed while skipped (still the same target language): Translate anyway still translates it (review N3).
      const h = fakeApi();
      const w = createTranslator(h.api, { translateClient: client() }, { detector: detector('vi') });
      await ready(w, h);
      h.setGlossary([{ term: 'crate', rendering: 'crate' }]);
      w.actions(1).resume();
      h.answer();
      await settle(50);
      expect(w.jobs.get(1)?.status).toBe('done');
      expect(w.jobs.get(1)?.counts.final).toBe(segments.length);
    });

    it('per-segment detection is off by default, and keeps target-language segments when on', async () => {
      const viText = 'Đây là một đoạn văn tiếng Việt đủ dài để nhận diện.';
      const page = { ...result, segments: [...segments, { ...segments[0], id: 'vi1', text: viText, inlineMarkup: viText }] } as Ready;
      const perSeg = { detect: async (text: string) => [{ detectedLanguage: text === viText ? 'vi' : 'en', confidence: 0.9 }] };
      const f1 = fakeApi();
      const off = createTranslator(f1.api, { translateClient: client() }, { detector: perSeg });
      const vOff = await ready(off, f1, page);
      expect(vOff?.counts.total).toBe(segments.length + 1);
      expect(vOff?.segments.find((s) => s.id === 'vi1')?.translate).toBe(true);

      const f2 = fakeApi();
      const on = createTranslator(f2.api, { translateClient: client() }, { detector: perSeg, mixedLanguage: true });
      const v = await ready(on, f2, page);
      expect(v?.status).toBe('done');
      expect(v?.counts.total).toBe(segments.length);
      expect(v?.segments.find((s) => s.id === 'vi1')?.translate).toBe(false);

      // Everything already in the target language: skipped.
      const f3 = fakeApi();
      const all = createTranslator(f3.api, { translateClient: client() }, { detector: detector('vi'), mixedLanguage: true });
      expect((await ready(all, f3))?.status).toBe('skipped');
    });
  });

  describe('style, gloss and personal glossary from the settings (plan M2-E6)', () => {
    const BRIEF = JSON.stringify({ language: 'en', genre: 'blog post', audience: 'developers', purpose: 'explain', tone: 'dry', glossary: [{ term: 'deploy', rendering: 'triển khai' }] });
    /** One client for both roles, as the panel routes them: the brief call gets BRIEF, translate calls are echoed. */
    const recording = () => {
      const c = translatorClient((lines, _n, req) => (req.messages[0]?.content.startsWith('<document>') ? BRIEF : lines.map((l) => `<seg id="${l.n}">vi:${l.source}</seg>`).join('\n')));
      const analyzeCalls = () => c.requests.filter((r) => r.messages[0]?.content.startsWith('<document>')).length;
      const translateCalls = () => c.requests.filter((r) => !r.messages[0]?.content.startsWith('<document>'));
      return { c, analyzeCalls, translateCalls, resolve: () => Promise.resolve({ ok: true as const, client: c, profile: GEMINI_PROFILE }) };
    };

    it('sends the stored style, gloss setting and personal glossary; the user\'s entry beats the brief\'s', async () => {
      const f = fakeApi();
      f.setPrefs({ targetLang: 'vi', sourceLang: 'auto', style: 'faithful', gloss: 'off' });
      f.setGlossary([{ term: 'deploy', rendering: 'deploy' }]);
      const r = recording();
      const t = createTranslator(f.api, { translateClient: r.resolve });
      const hooks = t.hooks as Required<SessionHooks>;
      hooks.active(1);
      hooks.ready(1, 'd', longResult);
      f.answer();
      await settle(120);
      expect(t.jobs.get(1)?.status).toBe('done');
      const calls = r.translateCalls();
      expect(calls.length).toBeGreaterThanOrEqual(3);
      expect(calls.filter((req) => req.system.includes('Genre: blog post')).length).toBeGreaterThanOrEqual(2);
      for (const req of calls) {
        expect(req.system).toContain('Style mode: Faithful');
        expect(req.system).toContain('Glosses: never add glosses');
        expect(req.system).toContain('- deploy → deploy (keep as is: write it exactly like this, never translate it, never gloss it)');
        expect(req.system).not.toContain('triển khai');
      }
    });

    it('a glossary or style change retranslates the active page from scratch, keeping the brief (no second analyze call)', async () => {
      const f = fakeApi();
      const r = recording();
      const t = createTranslator(f.api, { translateClient: r.resolve });
      const hooks = t.hooks as Required<SessionHooks>;
      const stop = t.watch(() => 1);
      hooks.active(1);
      hooks.ready(1, 'd', longResult);
      f.answer();
      await settle(80);
      expect(t.jobs.get(1)?.status).toBe('done');
      expect(r.analyzeCalls()).toBe(1);
      const before = r.translateCalls().length;
      const cost = t.jobs.get(1)?.cost ?? 0;

      f.setGlossary([{ term: 'deploy', rendering: 'deploy' }]);
      f.answer();
      await settle(80);
      const after = r.translateCalls().slice(before);
      expect(t.jobs.get(1)?.status).toBe('done');
      expect(t.jobs.get(1)?.counts.final).toBe(long.length);
      expect(r.analyzeCalls()).toBe(1);
      expect(t.jobs.get(1)?.brief?.genre).toBe('blog post');
      expect(after.length).toBeGreaterThan(0);
      // The kept brief is there from the start: every chunk, the first one too, is briefed.
      for (const req of after) {
        expect(req.system).toContain('Genre: blog post');
        expect(req.system).toContain('- deploy → deploy (keep as is: write it exactly like this, never translate it, never gloss it)');
      }
      expect(t.jobs.get(1)?.cost ?? 0).toBeGreaterThan(cost);

      const n = r.translateCalls().length;
      f.setPrefs({ targetLang: 'vi', sourceLang: 'auto', style: 'simplified', gloss: 'first' });
      f.answer();
      await settle(80);
      expect(r.translateCalls().slice(n).every((req) => req.system.includes('Style mode: Simplified'))).toBe(true);
      expect(r.analyzeCalls()).toBe(1);

      // An unrelated sync change, or the same settings again: nothing is retranslated.
      const m = r.translateCalls().length;
      f.setPrefs({ targetLang: 'vi', sourceLang: 'auto', style: 'simplified', gloss: 'first' });
      f.answer();
      await settle(40);
      expect(r.translateCalls().length).toBe(m);

      // A change made while another tab (the options page) is in front applies when the page's tab is back.
      let front = 2;
      stop();
      const stop2 = t.watch(() => front);
      hooks.active(2);
      const k = r.translateCalls().length;
      f.setGlossary([{ term: 'deploy', rendering: 'deploy' }, { term: 'crate', rendering: 'crate' }]);
      f.answer();
      await settle(40);
      expect(r.translateCalls().length).toBe(k);
      front = 1;
      hooks.active(1);
      f.answer();
      await settle(80);
      expect(r.translateCalls().length).toBeGreaterThan(k);
      expect(r.translateCalls().slice(k).every((req) => req.system.includes('- crate → crate'))).toBe(true);
      expect(r.analyzeCalls()).toBe(1);

      // A new target language drops the brief: it is asked again in that language.
      f.setPrefs({ targetLang: 'ja', sourceLang: 'auto', style: 'simplified', gloss: 'first' });
      f.answer();
      await settle(80);
      expect(r.analyzeCalls()).toBe(2);
      stop2();
    });

    it('a tab coming back with the same settings detects nothing again and sends nothing (review)', async () => {
      const f = fakeApi();
      let detections = 0;
      const detector = { detect: async () => (detections++, [{ detectedLanguage: 'en', confidence: 0.95 }]) };
      const r = recording();
      const t = createTranslator(f.api, { translateClient: r.resolve }, { detector });
      const hooks = t.hooks as Required<SessionHooks>;
      hooks.active(1);
      hooks.ready(1, 'd', result);
      f.answer();
      await settle(80);
      expect(t.jobs.get(1)?.status).toBe('done');
      const seen = detections;
      const sent = r.translateCalls().length;
      expect(seen).toBeGreaterThan(0);
      for (const tab of [2, 1, 2, 1]) {
        hooks.active(tab);
        f.answer();
        await settle(20);
      }
      expect(detections).toBe(seen);
      expect(r.translateCalls().length).toBe(sent);
    });

    it('never restarts a job the user cancelled, on a settings change or when its tab is back (review)', async () => {
      const f = fakeApi();
      const hanging: LLMClient = {
        model: 'm',
        reasoningReserveTokens: 0,
        // eslint-disable-next-line require-yield
        async *stream(req) {
          await new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(req.signal.reason), { once: true }));
        },
      };
      let resolved = 0;
      const t = createTranslator(f.api, { translateClient: () => (resolved++, Promise.resolve({ ok: true as const, client: hanging, profile: GEMINI_PROFILE })) });
      const hooks = t.hooks as Required<SessionHooks>;
      const stop = t.watch(() => 1);
      hooks.active(1);
      hooks.ready(1, 'd', result);
      f.answer();
      await settle(40);
      expect(t.jobs.get(1)?.status).toBe('running');
      t.jobs.cancel(1);
      expect(t.jobs.get(1)?.status).toBe('cancelled');
      const before = resolved;
      f.setGlossary([{ term: 'deploy', rendering: 'deploy' }]);
      f.answer();
      await settle(40);
      hooks.active(2);
      hooks.active(1);
      f.answer();
      await settle(40);
      expect(t.jobs.get(1)?.status).toBe('cancelled');
      expect(resolved).toBe(before);
      stop();
    });

    it('two refreshes in flight (a sync change and the tab coming back) restart the job once (review N2)', async () => {
      const f = fakeApi();
      let detections = 0;
      const detector = { detect: async () => (detections++, await settle(15), [{ detectedLanguage: 'en', confidence: 0.95 }]) };
      const r = recording();
      const t = createTranslator(f.api, { translateClient: r.resolve }, { detector });
      const hooks = t.hooks as Required<SessionHooks>;
      const stop = t.watch(() => 1);
      hooks.active(1);
      hooks.ready(1, 'd', longResult);
      f.answer();
      await settle(150);
      expect(t.jobs.get(1)?.status).toBe('done');
      expect(r.analyzeCalls()).toBe(1);
      const seen = detections;
      // A new target language drops the brief, so each restart would ask for one.
      f.setPrefs({ targetLang: 'ja', sourceLang: 'auto' });
      hooks.active(1);
      f.answer();
      await settle(200);
      expect(t.jobs.get(1)?.status).toBe('done');
      expect(t.jobs.get(1)?.targetLang).toBe('ja');
      expect(detections - seen).toBe(1);
      expect(r.analyzeCalls()).toBe(2);
      stop();
    });

    it('settings A→B then B→A while B is still detected: the tab keeps the A job, nothing is retranslated (review R1)', async () => {
      const f = fakeApi();
      let hold: Promise<void> | undefined;
      let release = () => {};
      const detector = {
        detect: async () => {
          const h = hold;
          hold = undefined;
          if (h) await h;
          return [{ detectedLanguage: 'en', confidence: 0.95 }];
        },
      };
      const r = recording();
      const t = createTranslator(f.api, { translateClient: r.resolve }, { detector });
      const hooks = t.hooks as Required<SessionHooks>;
      const stop = t.watch(() => 1);
      hooks.active(1);
      hooks.ready(1, 'd', result);
      f.answer();
      await settle(80);
      expect(t.jobs.get(1)?.status).toBe('done');
      const sent = r.translateCalls().length;

      hold = new Promise<void>((done) => (release = done));
      f.setPrefs({ targetLang: 'vi', sourceLang: 'auto', style: 'simplified', gloss: 'first' });
      f.answer();
      await settle(20);
      // Back to A (the stored prefs normalise to the same settings as the start).
      f.setPrefs({ targetLang: 'vi', sourceLang: 'auto' });
      f.answer();
      await settle(20);
      release();
      await settle(80);
      expect(r.translateCalls().length).toBe(sent);
      expect(t.jobs.docFor(1)?.doc.style).toBe('natural');
      expect(t.jobs.get(1)?.status).toBe('done');
      // The recorded settings are A's: the tab coming back changes nothing either.
      hooks.active(1);
      f.answer();
      await settle(40);
      expect(r.translateCalls().length).toBe(sent);
      stop();
    });

    it('a detection that fails leaves no settings marked: the same change applies on the next try, refresh and Resume alike (review R2)', async () => {
      // A segment whose text throws while `explode` is on: docFor rejects (detector errors are caught inside it).
      let explode = false;
      const tricky = [
        Object.defineProperty({ ...segments[0] }, 'text', {
          get: () => {
            if (explode) throw new Error('boom');
            return text;
          },
        }),
        ...segments.slice(1),
      ] as Segment[];
      const page = { ...result, segments: tricky } as Ready;

      const f = fakeApi();
      const r = recording();
      const t = createTranslator(f.api, { translateClient: r.resolve });
      const hooks = t.hooks as Required<SessionHooks>;
      const stop = t.watch(() => 1);
      hooks.active(1);
      hooks.ready(1, 'd', page);
      f.answer();
      await settle(80);
      expect(t.jobs.get(1)?.status).toBe('done');
      const sent = r.translateCalls().length;
      explode = true;
      f.setPrefs({ targetLang: 'vi', sourceLang: 'auto', style: 'simplified', gloss: 'first' });
      f.answer();
      await settle(40);
      expect(r.translateCalls().length).toBe(sent);
      explode = false;
      hooks.active(1);
      f.answer();
      await settle(80);
      const after = r.translateCalls().slice(sent);
      expect(after.length).toBeGreaterThan(0);
      expect(after.every((req) => req.system.includes('Style mode: Simplified'))).toBe(true);
      stop();

      // Resume (no settings listener here): a failed detection, then the same Resume works.
      const g = fakeApi();
      const q = recording();
      const u = createTranslator(g.api, { translateClient: q.resolve });
      const uhooks = u.hooks as Required<SessionHooks>;
      uhooks.active(1);
      uhooks.ready(1, 'd', page);
      g.answer();
      await settle(80);
      expect(u.jobs.get(1)?.status).toBe('done');
      const n = q.translateCalls().length;
      g.setGlossary([{ term: 'crate', rendering: 'crate' }]);
      explode = true;
      u.actions(1).resume();
      g.answer();
      await settle(40);
      expect(q.translateCalls().length).toBe(n);
      explode = false;
      u.actions(1).resume();
      g.answer();
      await settle(80);
      const resumed = q.translateCalls().slice(n);
      expect(resumed.length).toBeGreaterThan(0);
      expect(resumed.every((req) => req.system.includes('- crate → crate'))).toBe(true);
    });

    describe('Resume reads the settings again (review N3)', () => {
      /** recording(), with translate calls held until `release` (the analyze call goes through, so the brief lands). */
      const held = () => {
        const r = recording();
        let release = () => {};
        const gate = new Promise<void>((done) => (release = done));
        const client: LLMClient = {
          model: r.c.model,
          reasoningReserveTokens: r.c.reasoningReserveTokens,
          async *stream(req) {
            if (!req.messages[0]?.content.startsWith('<document>')) {
              await new Promise<void>((done, fail) => {
                void gate.then(done);
                req.signal.addEventListener('abort', () => fail(req.signal.reason), { once: true });
              });
            }
            yield* r.c.stream(req);
          },
        };
        return { ...r, release, resolve: () => Promise.resolve({ ok: true as const, client, profile: GEMINI_PROFILE }) };
      };

      /** A cancelled job (by the Cancel button or the panel's pagehide) whose brief already landed. */
      const cancelled = async (how: 'button' | 'pagehide') => {
        const f = fakeApi();
        let detections = 0;
        const detector = { detect: async () => (detections++, [{ detectedLanguage: 'en', confidence: 0.95 }]) };
        const r = held();
        const t = createTranslator(f.api, { translateClient: r.resolve }, { detector });
        const hooks = t.hooks as Required<SessionHooks>;
        const stop = t.watch(() => 1);
        hooks.active(1);
        hooks.ready(1, 'd', longResult);
        f.answer();
        await settle(60);
        expect(t.jobs.get(1)?.brief?.genre).toBe('blog post');
        if (how === 'button') t.actions(1).cancel();
        else dispatchEvent(new Event('pagehide'));
        expect(t.jobs.get(1)?.status).toBe('cancelled');
        r.release();
        return { f, r, t, stop, detections: () => detections };
      };

      it('unchanged settings: Resume translates what is left, no detection, no new brief', async () => {
        const { f, r, t, stop, detections } = await cancelled('button');
        const seen = detections();
        t.actions(1).resume();
        f.answer();
        await settle(120);
        expect(t.jobs.get(1)?.status).toBe('done');
        expect(t.jobs.get(1)?.counts.final).toBe(long.length);
        expect(detections()).toBe(seen);
        expect(r.analyzeCalls()).toBe(1);
        stop();
      });

      for (const how of ['button', 'pagehide'] as const) {
        it(`a glossary or style changed while cancelled (${how}): Resume starts afresh with the new settings, keeping the brief`, async () => {
          const { f, r, t, stop } = await cancelled(how);
          f.setGlossary([{ term: 'crate', rendering: 'crate' }]);
          f.setPrefs({ targetLang: 'vi', sourceLang: 'auto', style: 'simplified', gloss: 'first' });
          f.answer();
          await settle(40);
          // Still cancelled: a settings change never restarts a cancelled job.
          expect(t.jobs.get(1)?.status).toBe('cancelled');
          const n = r.translateCalls().length;
          t.actions(1).resume();
          f.answer();
          await settle(150);
          expect(t.jobs.get(1)?.status).toBe('done');
          expect(t.jobs.get(1)?.counts.final).toBe(long.length);
          const after = r.translateCalls().slice(n);
          expect(after.length).toBeGreaterThan(0);
          for (const req of after) {
            expect(req.system).toContain('Style mode: Simplified');
            expect(req.system).toContain('- crate → crate');
            expect(req.system).toContain('Genre: blog post');
          }
          expect(r.analyzeCalls()).toBe(1);
          stop();
        });
      }

      it('a target language changed while cancelled: Resume starts afresh in it, with a new brief', async () => {
        const { f, r, t, stop } = await cancelled('button');
        f.setPrefs({ targetLang: 'ja', sourceLang: 'auto' });
        f.answer();
        await settle(40);
        expect(t.jobs.get(1)?.status).toBe('cancelled');
        t.actions(1).resume();
        f.answer();
        await settle(150);
        expect(t.jobs.get(1)?.status).toBe('done');
        expect(t.jobs.get(1)?.targetLang).toBe('ja');
        expect(r.analyzeCalls()).toBe(2);
        stop();
      });
    });
  });
});
