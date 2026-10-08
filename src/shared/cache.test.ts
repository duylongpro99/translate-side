import fs from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { DocumentBrief, Segment } from '@/engine/index';
import { CONTEXTUAL_CACHE_KEY } from '@/engine/index';
import { keyScope, normalizeForKey, openTranslationCache, scopeHash, segmentKey, type TranslationCache } from './cache.ts';

const seg = (text: string, kind: Segment['kind'] = 'p', inlineMarkup = text): Pick<Segment, 'kind' | 'text' | 'inlineMarkup'> => ({ kind, text, inlineMarkup });
const base = { targetLang: 'vi', model: 'm1', style: 'natural' as const, gloss: 'first' as const, strategy: 'contextual', glossary: [] };
const keyOf = (over: Partial<Parameters<typeof keyScope>[0]> = {}, s = seg('Hello *world*')) => segmentKey(scopeHash(keyScope({ ...base, ...over })), s);

describe('cache key (M3-D1)', () => {
  it('is the same across whitespace, zero-width and Unicode-form drift of a re-extraction', () => {
    const k = keyOf();
    expect(keyOf({}, seg('  Hello   *world*\n'))).toBe(k);
    expect(keyOf({}, seg('Hello *world*'))).toBe(k);
    expect(keyOf({}, seg('Hel​lo *world*'))).toBe(k);
    expect(normalizeForKey('é')).toBe(normalizeForKey('é'));
  });

  it('changes with the text, its markers, its kind and each part of the scope', () => {
    const k = keyOf();
    const others = [
      keyOf({}, seg('Hello world')),
      keyOf({}, seg('Hello *world*', 'heading')),
      keyOf({ targetLang: 'fr' }),
      keyOf({ model: 'm2' }),
      keyOf({ style: 'faithful' }),
      keyOf({ gloss: 'off' }),
      keyOf({ strategy: 'single-pass' }),
      keyOf({ glossary: [{ term: 'world', rendering: 'thế giới' }] }),
    ];
    expect(new Set([k, ...others]).size).toBe(others.length + 1);
  });

  it('carries the strategy version and prompt versions, so a new prompt invalidates old entries (§5.5)', () => {
    const scope = keyScope(base);
    expect(scope.strategy).toMatchObject({ strategy: 'contextual', version: CONTEXTUAL_CACHE_KEY.version, promptIds: CONTEXTUAL_CACHE_KEY.promptIds });
    const bumped = { ...scope, strategy: { ...scope.strategy, version: scope.strategy.version + 1 } };
    const prompted = { ...scope, strategy: { ...scope.strategy, promptIds: ['translate@3'] } };
    expect(new Set([scopeHash(scope), scopeHash(bumped), scopeHash(prompted)]).size).toBe(3);
  });

  it('does not depend on the brief (M3-D2): there is no brief input at all', () => {
    expect(segmentKey.length).toBe(2);
    expect(scopeHash.length).toBe(1);
  });

  it('a fixture re-extracted with different whitespace and ids hits every key', () => {
    const doc = JSON.parse(fs.readFileSync('fixtures/docs/goblog-pipelines.json', 'utf8')) as { segments: Segment[] };
    const scope = scopeHash(keyScope(base));
    const drift = (s: string) => ` ${s.replace(/ /g, (_, i: number) => (i % 3 === 0 ? '  ' : i % 3 === 1 ? ' ' : '\n'))}\t`;
    const first = doc.segments.filter((s) => s.translate).map((s) => segmentKey(scope, s));
    const again = doc.segments.filter((s) => s.translate).map((s) => segmentKey(scope, { kind: s.kind, text: drift(s.text), inlineMarkup: drift(s.inlineMarkup) }));
    expect(first.length).toBeGreaterThan(20);
    expect(again).toEqual(first);
  });
});

const newCache = (over: { maxBytes?: number } = {}) => {
  let t = 0;
  return openTranslationCache({ factory: new IDBFactory(), now: () => ++t, ...over }) as TranslationCache;
};
const entry = (text: string, revision = 1, attempt = 1) => ({ text, revision, attempt });

describe('IndexedDB translation cache (M3-E2)', () => {
  it('is absent where there is no IndexedDB', () => {
    expect(openTranslationCache()).toBeUndefined();
  });

  it('stores and returns entries; unknown keys are misses', async () => {
    const c = newCache();
    await c.putMany(new Map([['a', entry('A')], ['b', entry('B')]]));
    const got = await c.getMany(['a', 'b', 'zz']);
    expect([...got.keys()].sort()).toEqual(['a', 'b']);
    expect(got.get('a')).toEqual(entry('A'));
    expect((await c.stats()).entries).toBe(2);
  });

  it('keeps only the highest revision, and the highest attempt of a revision (§5.2)', async () => {
    const c = newCache();
    await c.putMany(new Map([['a', entry('draft', 1)]]));
    await c.putMany(new Map([['a', entry('refined', 2)]]));
    expect((await c.getMany(['a'])).get('a')).toEqual(entry('refined', 2));
    await c.putMany(new Map([['a', entry('late draft repaired', 1, 3)]]));
    expect((await c.getMany(['a'])).get('a')).toEqual(entry('refined', 2));
    await c.putMany(new Map([['a', entry('refined again', 2, 2)]]));
    expect((await c.getMany(['a'])).get('a')).toEqual(entry('refined again', 2, 2));
    await c.putMany(new Map([['a', entry('stale', 2, 1)]]));
    expect((await c.getMany(['a'])).get('a')?.text).toBe('refined again');
    expect((await c.stats()).entries).toBe(1);
  });

  it('replace stores an entry whatever is there (a retranslate the user asked for)', async () => {
    const c = newCache();
    await c.putMany(new Map([['a', entry('refined', 2)]]));
    await c.putMany(new Map([['a', entry('retranslated', 1)]]), { replace: true });
    expect((await c.getMany(['a'])).get('a')).toEqual(entry('retranslated', 1));
  });

  it('delete removes an entry and keeps the stats right', async () => {
    const c = newCache();
    await c.putMany(new Map([['a', entry('A')], ['b', entry('B')]]));
    await c.delete(['a', 'nope']);
    expect([...(await c.getMany(['a', 'b'])).keys()]).toEqual(['b']);
    const s = await c.stats();
    expect(s.entries).toBe(1);
    await c.delete(['b']);
    expect(await c.stats()).toMatchObject({ entries: 0, bytes: 0 });
  });

  it('evicts the least recently used entries when over the limit; a read counts as use', async () => {
    const text = 'x'.repeat(200);
    const c = newCache({ maxBytes: 1500 });
    // ~ 2*(1+200)+64 = 466 bytes each: three fit, a fourth does not.
    await c.putMany(new Map([['a', entry(text)]]));
    await c.putMany(new Map([['b', entry(text)]]));
    await c.putMany(new Map([['c', entry(text)]]));
    await c.getMany(['a']); // a is now newer than b
    await c.putMany(new Map([['d', entry(text)]]));
    const got = await c.getMany(['a', 'b', 'c', 'd']);
    expect([...got.keys()].sort()).toEqual(['a', 'c', 'd']);
    const s = await c.stats();
    expect(s.entries).toBe(3);
    expect(s.bytes).toBeLessThanOrEqual(1500);
  });

  it('stores briefs by key and clear empties everything', async () => {
    const c = newCache();
    const brief: DocumentBrief = { genre: 'blog', audience: 'devs', purpose: 'explain', tone: 'dry', glossary: [] };
    expect(await c.getBrief('k')).toBeUndefined();
    await c.putBrief('k', brief);
    expect(await c.getBrief('k')).toEqual(brief);
    await c.putMany(new Map([['a', entry('A')]]));
    expect(await c.stats()).toMatchObject({ entries: 1, briefs: 1, maxBytes: 50 * 1024 * 1024 });
    await c.clear();
    expect(await c.stats()).toMatchObject({ entries: 0, bytes: 0, briefs: 0 });
  });

  it('survives reopening the same database', async () => {
    const factory = new IDBFactory();
    await (openTranslationCache({ factory }) as TranslationCache).putMany(new Map([['a', entry('A')]]));
    expect((await (openTranslationCache({ factory }) as TranslationCache).getMany(['a'])).get('a')?.text).toBe('A');
  });
});
