// The per-page cost readout and the running total it feeds (plan M3-E9).
import { describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/index';
import { translatorClient } from '@/engine/testing';
import { costUsd } from '@/shared/cost';
import { ANTHROPIC_HAIKU_PROFILE, GEMINI_PROFILE } from '@/shared/settings';
import { anthropicPrice } from '@/shared/pricing';
import type { SpendDelta } from '@/shared/spend';
import type { SessionHooks } from './controller.ts';
import { Jobs, type JobDoc } from './jobs.ts';
import { createTranslator } from './translator.ts';

const text = (i: number) => `Paragraph ${i} ${'word '.repeat(150)}`;
const segments: Segment[] = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, kind: 'p', text: text(i), inlineMarkup: text(i), domPath: `/p[${i + 1}]`, translate: true }));
const doc: JobDoc = { url: 'https://example.com/', title: 'T', sourceLang: 'en', targetLang: 'vi', segments };
const settle = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));

describe('cost (M3-E9)', () => {
  it('every usage report goes to onSpend, priced; their sum is the page readout', async () => {
    const deltas: SpendDelta[] = [];
    const client = translatorClient();
    const jobs = new Jobs({ translateClient: () => Promise.resolve({ ok: true, client, profile: GEMINI_PROFILE }), strategy: 'single-pass', onSpend: (d) => deltas.push(d) });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc);
    const view = jobs.get(1);
    expect(client.requests.length).toBeGreaterThan(1);
    expect(deltas).toHaveLength(client.requests.length);
    const sum = deltas.reduce((a, d) => ({ input: a.input + d.usage.input, cachedInput: a.cachedInput + d.usage.cachedInput, output: a.output + d.usage.output }), { input: 0, cachedInput: 0, output: 0 });
    expect(sum).toEqual(view?.usage);
    expect(deltas.reduce((a, d) => a + (d.usd ?? 0), 0)).toBeCloseTo(view?.cost ?? NaN, 12);
  });

  it('an Anthropic-preset profile is priced from the built-in table (route.ts puts it on the profile)', async () => {
    const pricing = anthropicPrice(ANTHROPIC_HAIKU_PROFILE.model);
    const jobs = new Jobs({ translateClient: () => Promise.resolve({ ok: true, client: translatorClient(), profile: { ...ANTHROPIC_HAIKU_PROFILE, ...(pricing ? { pricing } : {}) } }), strategy: 'single-pass' });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc);
    const view = jobs.get(1);
    expect(view?.cost).toBeCloseTo(costUsd(pricing, view?.usage ?? { input: 0, cachedInput: 0, output: 0 }) ?? NaN, 12);
    expect(view?.cost).toBeGreaterThan(0);
  });

  it('the panel adds what a page cost to the running total in storage.local', async () => {
    const local = new Map<string, unknown>([['privacyNotice', { version: 1, at: 0 }]]);
    const none = { addListener: () => {}, removeListener: () => {} };
    const api = {
      storage: {
        sync: { get: (k: string) => Promise.resolve(k === 'prefs' ? { prefs: { targetLang: 'vi', sourceLang: 'auto' } } : {}), onChanged: none },
        local: { get: (k: string) => Promise.resolve(local.has(k) ? { [k]: local.get(k) } : {}), set: (o: Record<string, unknown>) => (Object.entries(o).forEach(([k, v]) => local.set(k, v)), Promise.resolve()), onChanged: none },
        session: { get: () => Promise.resolve({}), remove: () => Promise.resolve(), onChanged: none },
      },
      permissions: { onAdded: none },
      i18n: { getUILanguage: () => 'en' },
    } as unknown as Parameters<typeof createTranslator>[0];
    const t = createTranslator(api, { translateClient: () => Promise.resolve({ ok: true as const, client: translatorClient(), profile: GEMINI_PROFILE }), strategy: 'single-pass' }, { detector: undefined });
    (t.hooks as Required<SessionHooks>).active(1);
    (t.hooks as Required<SessionHooks>).ready(1, 'd', { ok: true, via: 'walk', url: 'https://example.com/', title: 'T', lang: 'en', segments });
    const end = Date.now() + 2000;
    while (t.jobs.get(1)?.status !== 'done' && Date.now() < end) await settle(5);
    await settle(30);
    const spend = local.get('spend') as { usd: number; input: number; output: number };
    expect(spend.usd).toBeCloseTo(t.jobs.get(1)?.cost ?? NaN, 12);
    expect(spend.input).toBe(t.jobs.get(1)?.usage.input);
    expect(spend.output).toBe(t.jobs.get(1)?.usage.output);
  });
});
