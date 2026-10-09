// @vitest-environment jsdom
// The monthly soft limit in the panel (plan M4-E10): a run stops before it sends anything once this
// month's spend reached the limit, a cached page is not stopped, "Continue anyway" goes on for the
// month, and a failed "Continue anyway" says so (review 3 #3).
import { IDBFactory } from 'fake-indexeddb';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/index';
import { translatorClient } from '@/engine/testing';
import { openTranslationCache, type TranslationCache } from '@/shared/cache';
import { GEMINI_PROFILE } from '@/shared/settings';
import { monthKey, SPEND_KEY, SPEND_LIMIT_KEY, type LimitReached } from '@/shared/spend';
import type { SessionHooks } from './controller.ts';
import { JobBar, type JobActions } from './JobBar.tsx';
import { Jobs, type JobDoc, type JobView } from './jobs.ts';
import { createTranslator } from './translator.ts';

const text = (i: number) => `Paragraph ${i} ${'word '.repeat(150)}`;
const segments: Segment[] = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, kind: 'p', text: text(i), inlineMarkup: text(i), domPath: `/p[${i + 1}]`, translate: true }));
const doc: JobDoc = { url: 'https://example.com/', title: 'T', sourceLang: 'en', targetLang: 'vi', segments };
const settle = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await settle(5);
  }
}
const reached: LimitReached = { limitUsd: 5, monthUsd: 5.25 };

describe('Jobs and the soft limit (M4-E10)', () => {
  it('stops before the first request: nothing sent, the view carries the limit', async () => {
    const client = translatorClient();
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: () => Promise.resolve({ ok: true, client, profile: GEMINI_PROFILE }), spendLimit: () => Promise.resolve(reached) });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc);
    const v = jobs.get(1);
    expect(v?.status).toBe('stopped');
    expect(v?.limit).toEqual(reached);
    expect(client.requests).toHaveLength(0);
  });

  it('a page all in the cache is shown, not stopped (nothing to send)', async () => {
    const cache = openTranslationCache({ factory: new IDBFactory() }) as TranslationCache;
    const first = new Jobs({ strategy: 'single-pass', translateClient: () => Promise.resolve({ ok: true, client: translatorClient(), profile: GEMINI_PROFILE }), cache });
    first.setActive(1);
    await first.start(1, 'd', doc);
    await first.cacheIdle();
    const client = translatorClient();
    const again = new Jobs({ strategy: 'single-pass', translateClient: () => Promise.resolve({ ok: true, client, profile: GEMINI_PROFILE }), cache, spendLimit: () => Promise.resolve(reached) });
    again.setActive(1);
    await again.start(1, 'd', doc);
    expect(again.get(1)?.status).toBe('done');
    expect(again.get(1)?.limit).toBeUndefined();
    expect(client.requests).toHaveLength(0);
  });

  it('a block retranslated past the limit is not sent; it keeps its text and says why', async () => {
    const gate: { limit?: LimitReached } = {};
    const client = translatorClient();
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: () => Promise.resolve({ ok: true, client, profile: GEMINI_PROFILE }), spendLimit: () => Promise.resolve(gate.limit) });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc);
    const sent = client.requests.length;
    const before = jobs.get(1)?.segs.get('s2')?.text;
    gate.limit = reached;
    await jobs.retranslateSegment(1, 's2');
    const seg = jobs.get(1)?.segs.get('s2');
    expect(client.requests).toHaveLength(sent);
    expect(seg?.text).toBe(before);
    expect(seg?.redoError?.message).toContain('soft limit of $5');
  });
});

describe('the panel: Continue anyway (M4-E10, review 3 #3)', () => {
  function api(opts: { failSet?: boolean } = {}) {
    const local = new Map<string, unknown>([
      ['privacyNotice', { version: 1, at: 0 }],
      [SPEND_LIMIT_KEY, { monthlyUsd: 5 }],
      [SPEND_KEY, { since: 0, usd: 5.25, input: 1, cachedInput: 0, output: 1, unpricedTokens: 0, months: { [monthKey(Date.now())]: 5.25 }, days: {}, profiles: {} }],
    ]);
    const none = { addListener: () => {}, removeListener: () => {} };
    return {
      local,
      api: {
        storage: {
          sync: { get: (k: string) => Promise.resolve(k === 'prefs' ? { prefs: { targetLang: 'vi', sourceLang: 'auto' } } : {}), onChanged: none },
          local: {
            get: (k: string) => Promise.resolve(local.has(k) ? { [k]: structuredClone(local.get(k)) } : {}),
            set: (o: Record<string, unknown>) => {
              if (opts.failSet && SPEND_LIMIT_KEY in o) return Promise.reject(new Error('QUOTA_BYTES quota exceeded'));
              Object.entries(o).forEach(([k, v]) => local.set(k, v));
              return Promise.resolve();
            },
            onChanged: none,
          },
          session: { get: () => Promise.resolve({}), remove: () => Promise.resolve(), onChanged: none },
        },
        permissions: { onAdded: none },
        i18n: { getUILanguage: () => 'en' },
      } as unknown as Parameters<typeof createTranslator>[0],
    };
  }
  const open = (a: ReturnType<typeof api>) => {
    const client = translatorClient();
    const t = createTranslator(a.api, { translateClient: () => Promise.resolve({ ok: true as const, client, profile: GEMINI_PROFILE }), strategy: 'single-pass', cache: undefined }, { detector: undefined });
    (t.hooks as Required<SessionHooks>).active(1);
    (t.hooks as Required<SessionHooks>).ready(1, 'd', { ok: true, via: 'walk', url: 'https://example.com/', title: 'T', lang: 'en', segments });
    return { t, client };
  };

  it('stops at the limit, then goes on for the rest of the month', async () => {
    const a = api();
    const { t, client } = open(a);
    await until(() => t.jobs.get(1)?.status === 'stopped');
    expect(t.jobs.get(1)?.limit).toEqual({ limitUsd: 5, monthUsd: 5.25 });
    expect(client.requests).toHaveLength(0);
    t.actions(1).continuePastLimit();
    await until(() => t.jobs.get(1)?.status === 'done');
    expect(client.requests.length).toBeGreaterThan(0);
    expect(a.local.get(SPEND_LIMIT_KEY)).toEqual({ monthlyUsd: 5, continuedFor: monthKey(Date.now()) });
  });

  it('a Continue anyway that could not be saved stays stopped and says why', async () => {
    const a = api({ failSet: true });
    const { t, client } = open(a);
    await until(() => t.jobs.get(1)?.status === 'stopped');
    t.actions(1).continuePastLimit();
    await until(() => t.jobs.get(1)?.limit?.failed !== undefined);
    expect(t.jobs.get(1)?.status).toBe('stopped');
    expect(t.jobs.get(1)?.limit?.failed).toContain('Could not save “Continue anyway” (QUOTA_BYTES quota exceeded)');
    expect(client.requests).toHaveLength(0);
  });
});

describe('the bar at the limit (M4-E10)', () => {
  const view: JobView = { status: 'stopped', paused: false, model: 'm', targetLang: 'vi', sourceLang: 'en', segments: [], segs: new Map(), counts: { total: 6, final: 0, failed: 0 }, usage: { input: 0, cachedInput: 0, output: 0 }, cost: undefined, unmetered: 0, startedAt: 0, limit: reached };
  const actions = (calls: string[]): JobActions => ({
    cancel: () => calls.push('cancel'),
    resume: () => calls.push('resume'),
    openOptions: () => calls.push('options'),
    retrySegment: () => calls.push('retry'),
    retranslateSegment: () => calls.push('retranslate'),
    retranslatePage: () => calls.push('retranslate-page'),
    grantAccess: () => calls.push('grant'),
    continuePastLimit: () => calls.push('continue-limit'),
  });

  it('says what was spent against the limit; Continue anyway and Settings act; a failure shows', () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    const calls: string[] = [];
    act(() => render(<JobBar job={view} actions={actions(calls)} />, root));
    const bar = root.querySelector('[data-testid=job-limit]');
    expect(bar?.textContent).toContain("This month's spend ($5.25) reached your soft limit of $5.00. Nothing was sent.");
    expect(bar?.getAttribute('role')).toBe('alert');
    root.querySelector<HTMLButtonElement>('[data-testid=limit-continue]')?.click();
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Settings')?.click();
    expect(calls).toEqual(['continue-limit', 'options']);
    expect(root.querySelector('[data-testid=limit-failed]')).toBeNull();
    act(() => render(<JobBar job={{ ...view, limit: { ...reached, failed: 'Could not save.' } }} actions={actions(calls)} />, root));
    expect(root.querySelector('[data-testid=limit-failed]')?.textContent).toBe('Could not save.');
  });
});
