// @vitest-environment jsdom
// Navigation and SPA reads in the translator (plan M5-E3, E2): a page reached by a navigation waits
// for Translate this page unless its site is allowlisted; a never-translate site sends nothing; a
// page that changes is translated again from the cache, so only new or changed blocks are sent.
import { PRIVACY_NOTICE_VERSION } from './privacy.ts';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/index';
import { renderLines, translatorClient } from '@/engine/testing';
import { openTranslationCache, type TranslationCache } from '@/shared/cache';
import { GEMINI_PROFILE } from '@/shared/settings';
import type { SessionHooks } from './controller.ts';
import { createTranslator } from './translator.ts';

type Api = Parameters<typeof createTranslator>[0];
type Page = Parameters<Required<SessionHooks>['ready']>[2];

function fakeApi(sites: { allow?: string[]; never?: string[] } = {}, granted: string[] = []) {
  const sync = new Map<string, unknown>([
    ['prefs', { targetLang: 'vi', sourceLang: 'auto' }],
    ['siteAllowlist', sites.allow ?? []],
    ['siteNever', sites.never ?? []],
  ]);
  const perms = new Set(granted);
  const requested: string[][] = [];
  const listeners = () => ({ addListener: () => {}, removeListener: () => {} });
  const pick = (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => sync.has(k)).map((k) => [k, sync.get(k)]));
  const api = {
    storage: {
      sync: { get: (k: string | string[]) => Promise.resolve(pick(k)), set: (o: Record<string, unknown>) => (Object.entries(o).forEach(([k, v]) => sync.set(k, v)), Promise.resolve()), onChanged: listeners() },
      local: { get: () => Promise.resolve({ privacyNotice: { version: PRIVACY_NOTICE_VERSION, at: 0 } }), set: () => Promise.resolve(), onChanged: listeners() },
      session: { onChanged: listeners(), get: () => Promise.resolve({}), remove: () => Promise.resolve() },
    },
    permissions: {
      onAdded: listeners(),
      contains: ({ origins }: { origins: string[] }) => Promise.resolve(origins.every((o) => perms.has(o))),
      request: ({ origins }: { origins: string[] }) => (requested.push(origins), origins.forEach((o) => perms.add(o)), Promise.resolve(true)),
    },
    i18n: { getUILanguage: () => 'en' },
  } as unknown as Api;
  return { api, sync, requested };
}

const words = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(' ');
const seg = (id: string, text: string): Segment => ({ id, kind: 'p', text, inlineMarkup: text, domPath: `/p[${id}]`, translate: true });
const page = (url: string, segments: Segment[]): Page => ({ ok: true, via: 'walk', url, title: 'Docs', lang: 'en', segments }) as Page;
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await settle(2);
  }
}

/** A client that records each block text it was sent, and a fresh cache per test. */
function setup(sites?: Parameters<typeof fakeApi>[0], granted?: string[], opts: { slow?: () => Promise<void> } = {}) {
  const f = fakeApi(sites, granted);
  const sent: string[] = [];
  let resolved = 0;
  const client = translatorClient((lines) => {
    for (const l of lines) sent.push(l.source);
    return renderLines(lines, (s) => `vi:${s}`);
  });
  const slowClient = opts.slow
    ? {
        ...client,
        async *stream(req: Parameters<typeof client.stream>[0]) {
          await opts.slow?.();
          yield* client.stream(req);
        },
      }
    : client;
  const cache = openTranslationCache({ factory: new IDBFactory() }) as TranslationCache;
  const t = createTranslator(f.api, { translateClient: () => (resolved++, Promise.resolve({ ok: true, client: slowClient, profile: GEMINI_PROFILE })), cache }, { detector: undefined });
  const hooks = t.hooks as Required<SessionHooks>;
  hooks.active(1);
  return { f, t, hooks, sent, resolved: () => resolved };
}

const sidebar = [seg('a', `Getting started ${words(30, 'intro')}`), seg('b', `Installation ${words(30, 'install')}`)];
const p1 = page('https://docs.example.org/one', [...sidebar, seg('c', `Page one ${words(40, 'one')}`)]);
const p2 = page('https://docs.example.org/two', [...sidebar, seg('d', `Page two ${words(40, 'two')}`)]);

describe('reads after a navigation (plan M5-E3)', () => {
  it('a site that is not allowlisted: the page waits for Translate this page, nothing is resolved or sent', async () => {
    const { t, hooks, sent, resolved } = setup();
    hooks.ready(1, 'd1', p1, { asked: false });
    await settle(30);
    expect(t.offers.get(1)).toEqual({ docId: 'd1', url: p1.url, reason: 'ask', site: 'docs.example.org' });
    expect(t.jobs.get(1)).toBeUndefined();
    expect(resolved()).toBe(0);
    expect(sent).toEqual([]);

    t.translatePage(1);
    await until(() => t.jobs.get(1)?.status === 'done');
    expect(t.offers.get(1)).toBeUndefined();
    expect(sent.length).toBe(3);
  });

  it('a gesture on a waiting page (Alt+T, the toolbar) translates it', async () => {
    const { t, hooks } = setup();
    hooks.ready(1, 'd1', p1, { asked: false });
    await settle(30);
    hooks.asked(1, 'd1');
    await until(() => t.jobs.get(1)?.status === 'done');
    expect(t.offers.get(1)).toBeUndefined();
  });

  it('an allowlisted site with its permission translates each page by itself; without the permission it waits', async () => {
    const yes = setup({ allow: ['*.example.org'] }, ['https://docs.example.org/*']);
    yes.hooks.ready(1, 'd1', p1, { asked: false });
    await until(() => yes.t.jobs.get(1)?.status === 'done');
    expect(yes.t.offers.get(1)).toBeUndefined();

    const no = setup({ allow: ['*.example.org'] });
    no.hooks.ready(1, 'd1', p1, { asked: false });
    await settle(30);
    expect(no.t.offers.get(1)?.reason).toBe('ask');
    expect(no.resolved()).toBe(0);
  });

  it('pages 2 and 3 of an allowlisted site: the repeated blocks come from the cache, 0 tokens for them (§3 #2)', async () => {
    const { t, hooks, sent } = setup({ allow: ['docs.example.org'] }, ['https://docs.example.org/*']);
    hooks.ready(1, 'd1', p1, { asked: true });
    await until(() => t.jobs.get(1)?.status === 'done');
    await t.jobs.cacheIdle();
    sent.length = 0;
    hooks.gone(1);
    hooks.ready(1, 'd2', p2, { asked: false });
    await until(() => t.jobs.docOf(1) === 'd2' && t.jobs.get(1)?.status === 'done');
    expect(sent).toEqual([p2.segments[2]?.text]);
    expect(t.jobs.get(1)?.cached).toBe(2);
  });

  it('Always translate on this site asks for the permission, allowlists the site and translates the page', async () => {
    const { f, t, hooks } = setup();
    hooks.ready(1, 'd1', p1, { asked: false });
    await settle(30);
    expect(await t.allowSite(1)).toBe(true);
    expect(f.requested).toEqual([['https://docs.example.org/*', 'http://docs.example.org/*']]);
    expect(f.sync.get('siteAllowlist')).toEqual(['docs.example.org']);
    await until(() => t.jobs.get(1)?.status === 'done');
  });

  it('a never-translate site: nothing is sent, even when asked, and the page says why', async () => {
    const { t, hooks, sent, resolved } = setup({ never: ['docs.example.org'] });
    hooks.ready(1, 'd1', p1, { asked: true });
    await settle(50);
    expect(t.offers.get(1)?.reason).toBe('never');
    expect(t.jobs.get(1)).toBeUndefined();
    expect(resolved()).toBe(0);
    expect(sent).toEqual([]);
    // Translate this page does nothing there.
    t.translatePage(1);
    await settle(30);
    expect(t.jobs.get(1)).toBeUndefined();
  });
});

describe('SPA updates (plan M5-E2)', () => {
  it('new content on the same page: only the new block is sent, the rest comes from the cache; brief and cost are kept', async () => {
    const { t, hooks, sent } = setup();
    hooks.ready(1, 'd1', p1, { asked: true });
    await until(() => t.jobs.get(1)?.status === 'done');
    await t.jobs.cacheIdle();
    const cost = t.jobs.get(1)?.usage.input ?? 0;
    sent.length = 0;
    const more = page(p1.url, [...p1.segments, seg('e', `Later block ${words(20, 'late')}`)]);
    hooks.ready(1, 'd1', more, { asked: false, update: { urlChanged: false } });
    await until(() => t.jobs.get(1)?.status === 'done' && t.jobs.get(1)?.segments.length === 4);
    expect(sent).toEqual([more.segments[3]?.text]);
    expect(t.jobs.get(1)?.usage.input ?? 0).toBeGreaterThan(cost);
  });

  it('an update while the job runs waits for it to end: nothing in flight is thrown away', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { t, hooks, sent } = setup(undefined, undefined, { slow: () => gate });
    hooks.ready(1, 'd1', p1, { asked: true });
    await until(() => t.jobs.get(1)?.status === 'running' && sent.length === 0);
    const more = page(p1.url, [...p1.segments, seg('e', `Later block ${words(20, 'late')}`)]);
    hooks.ready(1, 'd1', more, { asked: false, update: { urlChanged: false } });
    await settle(30);
    expect(t.jobs.get(1)?.status).toBe('running');
    expect(t.jobs.get(1)?.unmetered ?? 0).toBe(0);
    release();
    await until(() => t.jobs.get(1)?.status === 'done' && t.jobs.get(1)?.segments.length === 4);
    // Each block was sent once: the three of the first run, then only the new one.
    expect([...sent].sort()).toEqual(more.segments.map((s) => s.text).sort());
  });

  it('the click after a route-change offer sends only the new route’s own blocks: the repeated ones come from the cache (review N3, §3 #2)', async () => {
    const { t, hooks, sent } = setup();
    hooks.ready(1, 'd1', p1, { asked: true });
    await until(() => t.jobs.get(1)?.status === 'done');
    await t.jobs.cacheIdle();
    sent.length = 0;
    hooks.ready(1, 'd1', p2, { asked: false, update: { urlChanged: true } });
    await settle(30);
    expect(t.offers.get(1)?.reason).toBe('ask');
    expect(sent).toEqual([]);
    t.translatePage(1);
    await until(() => t.jobs.get(1)?.status === 'done');
    expect(sent).toEqual([p2.segments[2]?.text]);
    expect(t.jobs.get(1)?.cached).toBe(2);
  });

  it('a route change on a site that is not allowlisted waits for Translate this page; the old route’s job is let go', async () => {
    const { t, hooks } = setup();
    hooks.ready(1, 'd1', p1, { asked: true });
    await until(() => t.jobs.get(1)?.status === 'done');
    hooks.ready(1, 'd1', p2, { asked: false, update: { urlChanged: true } });
    await settle(30);
    expect(t.jobs.get(1)).toBeUndefined();
    expect(t.offers.get(1)).toMatchObject({ docId: 'd1', url: p2.url, reason: 'ask' });
  });

  it('a route change on an allowlisted site translates the new route by itself', async () => {
    const { t, hooks, sent } = setup({ allow: ['docs.example.org'] }, ['https://docs.example.org/*']);
    hooks.ready(1, 'd1', p1, { asked: true });
    await until(() => t.jobs.get(1)?.status === 'done');
    await t.jobs.cacheIdle();
    sent.length = 0;
    hooks.ready(1, 'd1', p2, { asked: false, update: { urlChanged: true } });
    await until(() => t.jobs.get(1)?.status === 'done' && t.jobs.get(1)?.segments.some((s) => s.id === 'd') === true);
    expect(sent).toEqual([p2.segments[2]?.text]);
  });

  it('a page the user cancelled is not restarted by an update: it waits for Translate this page', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { t, hooks } = setup(undefined, undefined, { slow: () => gate });
    hooks.ready(1, 'd1', p1, { asked: true });
    await until(() => t.jobs.get(1)?.status === 'running');
    t.actions(1).cancel();
    release();
    hooks.ready(1, 'd1', page(p1.url, [...p1.segments, seg('e', 'More text here.')]), { asked: false, update: { urlChanged: false } });
    await settle(30);
    expect(t.jobs.get(1)).toBeUndefined();
    expect(t.offers.get(1)?.reason).toBe('ask');
  });
});
