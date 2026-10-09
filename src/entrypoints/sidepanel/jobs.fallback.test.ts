// Jobs with a fallback chain (plan M4-E9, DESIGN §4.3.5): blocks continue on the fallback with a
// badge, a bad key stops and never falls back, finals are cached under the model that produced
// them (§7), and usage is priced with the profile that spent it (M4-E10).
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/index';
import { translatorClient } from '@/engine/testing';
import type { LLMClient, LLMError } from '@/llm/types';
import { keyScope, openTranslationCache, scopeHash, segmentKey, type TranslationCache } from '@/shared/cache';
import type { ModelProfile } from '@/shared/settings';
import type { SpendDelta } from '@/shared/spend';
import { Jobs, type ClientResult, type JobDoc } from './jobs.ts';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
function doc(n: number, w = 120): JobDoc {
  const segments: Segment[] = Array.from({ length: n }, (_, i) => {
    const text = `P${i} ${words(w)}`;
    return { id: `s${i}`, kind: 'p', text, inlineMarkup: text, domPath: `/p[${i + 1}]`, translate: true };
  });
  return { url: 'https://example.com/', title: 'T', sourceLang: 'en', targetLang: 'vi', segments };
}

const LOCAL: ModelProfile = { id: 'ollama-qwen', connectionId: 'ollama', model: 'qwen3:8b', maxConcurrency: 1, chunkTokens: 300 };
const CLOUD: ModelProfile = { id: 'haiku', connectionId: 'anthropic', model: 'claude-haiku-4-5', maxConcurrency: 2, chunkTokens: 1200, pricing: { inPerM: 1, cachedInPerM: 0.1, outPerM: 5 } };

/** A local server that answers `upFor` requests, then is stopped (every request: network error). */
function stoppable(upFor: number): LLMClient & { requests: number } {
  const inner = translatorClient(undefined, { model: LOCAL.model });
  const c = {
    model: LOCAL.model,
    requests: 0,
    reasoningReserveTokens: () => 0,
    async *stream(req: Parameters<LLMClient['stream']>[0]) {
      c.requests++;
      if (c.requests <= upFor) {
        yield* inner.stream(req);
        return;
      }
      await Promise.resolve();
      yield { type: 'error' as const, error: { kind: 'network' as const, message: "Can't reach localhost:11434" } };
    },
  };
  return c;
}

const chain = (primary: LLMClient, fallback: LLMClient, primaryProfile = LOCAL): (() => Promise<ClientResult>) => () =>
  Promise.resolve({
    ok: true,
    client: primary,
    profile: primaryProfile,
    connection: { id: primaryProfile.connectionId, label: primaryProfile === LOCAL ? 'Home Ollama' : 'My Anthropic' },
    fallback: [{ client: fallback, profile: CLOUD, connection: { id: 'anthropic', label: 'My Anthropic' } }],
  });

const instant = () => Promise.resolve();

describe('Jobs with a fallback chain (§3 #3: stop Ollama mid-page → blocks continue on the fallback with a badge)', () => {
  it('finishes the page on the fallback; blocks name the model that translated them; the bar says why', async () => {
    const local = stoppable(1);
    const cloud = translatorClient(undefined, { model: CLOUD.model });
    const spent: SpendDelta[] = [];
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: chain(local, cloud), sleep: instant, onSpend: (d) => spent.push(d) });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc(4));
    const view = jobs.get(1);
    expect(view?.status).toBe('done');
    expect(view?.model).toBe(LOCAL.model);
    expect(view?.counts).toEqual({ total: 4, final: 4, failed: 0 });
    const models = [...(view?.segs.values() ?? [])].map((s) => s.model);
    expect(models[0]).toBe(LOCAL.model);
    expect(models.slice(1)).toEqual([CLOUD.model, CLOUD.model, CLOUD.model]);
    expect(view?.fallback).toMatchObject({ from: LOCAL.model, to: CLOUD.model, error: { kind: 'network' } });
    // Sticky: after the stop, the local server was asked only for the one chunk's retries.
    expect(local.requests).toBe(1 + 4);
    // Usage is priced with the profile that spent it: the local model is free, the fallback is not.
    expect(spent.map((d) => d.profileId)).toEqual([LOCAL.id, CLOUD.id, CLOUD.id, CLOUD.id]);
    expect(spent[0]?.usd).toBeUndefined();
    expect(spent[1]?.usd).toBeGreaterThan(0);
    expect(view?.cost).toBeCloseTo(spent.reduce((n, d) => n + (d.usd ?? 0), 0), 10);
  });

  it('a fallback final is cached under the model that produced it, not the primary (§7)', async () => {
    const cache = openTranslationCache({ factory: new IDBFactory() }) as TranslationCache;
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: chain(stoppable(1), translatorClient(undefined, { model: CLOUD.model })), sleep: instant, cache });
    jobs.setActive(1);
    const d = doc(3);
    await jobs.start(1, 'd', d);
    await jobs.cacheIdle();
    const scope = (model: string) => scopeHash(keyScope({ targetLang: 'vi', model, strategy: 'single-pass' }));
    const keys = (model: string) => d.segments.map((s) => segmentKey(scope(model), s));
    const underLocal = await cache.getMany(keys(LOCAL.model));
    const underCloud = await cache.getMany(keys(CLOUD.model));
    expect([...underLocal.keys()]).toEqual([keys(LOCAL.model)[0]]);
    expect([...underCloud.keys()].sort()).toEqual(keys(CLOUD.model).slice(1).sort());
  });

  it('a bad key stops (§3 #4): "Fix key" names the connection, it is marked error, nothing is sent to the fallback', async () => {
    const refused: LLMError = { kind: 'auth', status: 401, message: 'Key invalid or missing' };
    let primaryRequests = 0;
    const primary: LLMClient = {
      model: CLOUD.model,
      reasoningReserveTokens: () => 0,
      async *stream() {
        primaryRequests++;
        await Promise.resolve();
        yield { type: 'error', error: refused };
      },
    };
    const backup = translatorClient(undefined, { model: LOCAL.model });
    const marked: [string, LLMError][] = [];
    const jobs = new Jobs({
      strategy: 'single-pass',
      translateClient: () =>
        Promise.resolve({ ok: true, client: primary, profile: CLOUD, connection: { id: 'anthropic', label: 'My Anthropic' }, fallback: [{ client: backup, profile: LOCAL, connection: { id: 'ollama', label: 'Home Ollama' } }] }),
      sleep: instant,
      onAuthError: (id, e) => marked.push([id, e]),
    });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc(4));
    const view = jobs.get(1);
    expect(view?.status).toBe('stopped');
    expect(view?.stopError?.kind).toBe('auth');
    expect(view?.connection).toMatchObject({ id: 'anthropic' });
    expect(marked).toEqual([['anthropic', refused]]);
    expect(primaryRequests).toBe(1);
    expect(backup.requests).toHaveLength(0);
  });

  it('a fallback that is refused for its key marks that connection, not the primary', async () => {
    const local = stoppable(0);
    let backupRequests = 0;
    const backup: LLMClient = {
      model: CLOUD.model,
      reasoningReserveTokens: () => 0,
      async *stream() {
        backupRequests++;
        await Promise.resolve();
        yield { type: 'error', error: { kind: 'auth', status: 401, message: 'Key invalid or missing' } };
      },
    };
    const marked: string[] = [];
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: chain(local, backup), sleep: instant, onAuthError: (id) => marked.push(id) });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc(2));
    expect(jobs.get(1)?.status).toBe('stopped');
    expect(jobs.get(1)?.connection).toMatchObject({ id: 'anthropic' });
    expect(marked).toEqual(['anthropic']);
    expect(backupRequests).toBe(1);
  });
});
