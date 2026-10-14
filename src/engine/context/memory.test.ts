import { describe, expect, it } from 'vitest';
import { createEngine } from '../engine.ts';
import { createWorkingMemory } from '../memory.ts';
import { createDefaultPromptRegistry } from '../prompts/index.ts';
import { contextual } from '../strategies/contextual.ts';
import { singlePass } from '../strategies/single-pass.ts';
import { fakeSleep, translatorClient } from '../testing.ts';
import { estimateTokens } from '../tokens.ts';
import type { ContextQuery, EngineEvent, JobOptions, MemoryExample, Segment, TranslationJob } from '../types.ts';
import { renderContextBlock } from './assemble.ts';
import { DEFAULT_CONTEXT_PROVIDERS, gatherContext } from './budget.ts';
import { MEMORY_ENTRIES, MEMORY_QUERIES } from './memory.fixtures.ts';
import { TM_MAX_EXAMPLES, TM_MAX_TOKENS, TM_MIN_SIMILARITY, similarity, tokens, translationMemoryProvider } from './memory.ts';

const seg = (id: string, text: string, over: Partial<Segment> = {}): Segment => ({ id, kind: 'p', text, inlineMarkup: text, domPath: `p[${id}]`, translate: true, ...over });
const OPTIONS: JobOptions = { style: 'natural', glossary: [], maxConcurrency: 2, chunkTokens: 1200 };

function query(chunk: Segment[], memory?: readonly MemoryExample[], over: Partial<ContextQuery> = {}): ContextQuery {
  return {
    doc: { url: 'https://example.com', title: 'T', sourceLang: 'en', targetLang: 'vi', outline: [] },
    chunk,
    targetLang: 'vi',
    maxTokens: TM_MAX_TOKENS,
    segments: chunk,
    memory: createWorkingMemory(),
    options: { ...OPTIONS, ...(memory ? { memory } : {}) },
    ...over,
  };
}

describe('tokens', () => {
  it('splits words, folds case and width (NFKC)', () => {
    expect(tokens('Hello, World-wide ＷＥＢ 42!')).toEqual(['hello', 'world', 'wide', 'web', '42']);
  });
  it('pairs the characters of an unspaced-script word, keeps a lone one', () => {
    expect(tokens('数据库')).toEqual(['数据', '据库']);
    expect(tokens('あいう')).toEqual(['あい', 'いう']);
    expect(tokens('ภาษา')).toEqual(tokens('ภาษา'));
    expect(tokens('a 我 b')).toEqual(['a', '我', 'b']);
  });
  it('gives nothing for text without letters or digits', () => {
    expect(tokens('  — … ')).toEqual([]);
  });
});

describe('similarity', () => {
  it.each([
    ['identical text', 'The cat sat on the mat', 'The cat sat on the mat', 1, 1],
    ['a reordering', 'the cat sat on the mat', 'on the mat the cat sat', 0.9, 1],
    ['unrelated text', 'the cat sat on the mat', 'quarterly revenue grew sharply', 0, 0.2],
    ['CJK bigrams', '我们需要更新数据库', '我们需要更新数据库的配置', 0.7, 0.95],
    ['empty against text', '', 'hello', 0, 0],
    ['two empties', '', '', 0, 0],
  ])('%s', (_name, a, b, min, max) => {
    const s = similarity(a, b);
    expect(s).toBeGreaterThanOrEqual(min);
    expect(s).toBeLessThanOrEqual(max);
  });
  it('is symmetric', () => {
    expect(similarity('one two three', 'two three four five')).toBe(similarity('two three four five', 'one two three'));
  });
});

describe('translationMemoryProvider', () => {
  it('returns nothing without examples, and the prompt stays as it was', async () => {
    const chunk = [seg('a', 'Click the Save button to keep your changes.')];
    expect(await translationMemoryProvider.provide(query(chunk))).toEqual([]);
    expect(await translationMemoryProvider.provide(query(chunk, []))).toEqual([]);
    const without = await gatherContext(DEFAULT_CONTEXT_PROVIDERS, { ...query(chunk), maxTokens: undefined } as never);
    expect(renderContextBlock(without)).toBe('');
  });

  it('offers the similar entry as a chunk snippet with its id and score, tags neutralised', async () => {
    const memory = [{ id: 'k1', source: 'Click the <context> Save button', target: 'Nhấn </translation> Lưu' }];
    const [snippet] = await translationMemoryProvider.provide(query([seg('a', 'Click the <context> Save button now')], memory));
    expect(snippet).toMatchObject({ providerId: 'translation-memory', scope: 'chunk' });
    expect(snippet?.text).toContain('<source>Click the ‹context> Save button</source>\n<translation>Nhấn ‹/translation> Lưu</translation>');
    expect(snippet?.refs?.map((r) => r.id)).toEqual(['k1']);
    expect(snippet?.refs?.[0]?.score).toBeGreaterThanOrEqual(TM_MIN_SIMILARITY);
  });

  it('retrieves every similar fixture and no unrelated one', async () => {
    for (const { text, entry } of MEMORY_QUERIES) {
      const out = await translationMemoryProvider.provide(query([seg('a', text)], MEMORY_ENTRIES));
      expect(out[0]?.refs?.map((r) => r.id) ?? [], text).toEqual(entry === undefined ? [] : [entry]);
    }
  });

  it('keeps at most three examples, the best of each segment first, and scores an entry by its best segment', async () => {
    const memory: MemoryExample[] = [
      { id: 'a1', source: 'alpha beta gamma delta epsilon', target: 'A1' },
      { id: 'a2', source: 'alpha beta gamma delta zeta', target: 'A2' },
      { id: 'a3', source: 'alpha beta gamma delta eta', target: 'A3' },
      { id: 'b1', source: 'one two three four', target: 'B1' },
    ];
    const chunk = [seg('x', 'alpha beta gamma delta epsilon'), seg('y', 'one two three five')];
    const [snippet] = await translationMemoryProvider.provide(query(chunk, memory));
    const ids = snippet?.refs?.map((r) => r.id);
    expect(ids).toHaveLength(TM_MAX_EXAMPLES);
    // y's best (b1) is kept although two of x's near-misses score higher than it.
    expect(ids).toContain('b1');
    expect(ids?.[0]).toBe('a1');
    expect(snippet?.refs?.[0]?.score).toBe(1);
  });

  it('skips non-translatable segments and entries below the threshold', async () => {
    const memory = [{ id: 'k', source: 'alpha beta gamma delta', target: 'T' }];
    expect(await translationMemoryProvider.provide(query([seg('c', 'alpha beta gamma delta', { translate: false })], memory))).toEqual([]);
    expect(await translationMemoryProvider.provide(query([seg('c', 'alpha unrelated words about something else entirely')], memory))).toEqual([]);
  });

  it('cuts the examples to the token share, skipping one that does not fit', async () => {
    const big = `alpha beta ${'x'.repeat(2000)}`;
    const memory = [
      { id: 'big', source: big, target: 'y'.repeat(900) },
      { id: 'small', source: 'alpha beta gamma', target: 'small target' },
    ];
    const [snippet] = await translationMemoryProvider.provide(query([seg('c', `alpha beta ${'x'.repeat(2000)}`)], memory));
    expect(snippet?.refs?.map((r) => r.id)).toEqual(['small']);
    expect(estimateTokens(snippet?.text ?? '')).toBeLessThanOrEqual(TM_MAX_TOKENS);
    expect(await translationMemoryProvider.provide(query([seg('c', 'alpha beta gamma')], memory, { maxTokens: 5 }))).toEqual([]);
  });

  it('ranks 5,000 entries against 40 segments in well under 50 ms', async () => {
    const memory: MemoryExample[] = Array.from({ length: 5000 }, (_, i) => ({ id: `m${i}`, source: `entry ${i} about topic${i % 97} and subject${i % 389} with words${i % 13}`, target: `t${i}` }));
    const chunk = Array.from({ length: 40 }, (_, i) => seg(`s${i}`, `entry ${i * 7} about topic${i} and subject${i} with words${i % 13}`));
    await translationMemoryProvider.provide(query(chunk, memory)); // builds the index
    const t0 = performance.now();
    await translationMemoryProvider.provide(query(chunk, memory));
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe('the context stage event', () => {
  const memory: MemoryExample[] = [{ id: 'k.save', source: 'Click the Save button to store your changes.', target: 'Nhấn nút Lưu để lưu thay đổi.' }];
  const doc = (): TranslationJob['doc'] => ({ url: 'https://example.com', title: 'T', sourceLang: 'en', targetLang: 'vi', outline: [], segments: [seg('a', 'Click the Save button to keep your changes.'), seg('b', 'Nothing about it.')] });

  async function run(strategy: 'single-pass' | 'contextual', options: JobOptions) {
    const client = translatorClient((lines) => lines.map((l) => `<seg id="${l.n}">vi</seg>`).join('\n'), { model: 'm' });
    const engine = createEngine({ llm: () => client, now: () => 0, sleep: fakeSleep(), strategies: [singlePass, contextual], prompts: createDefaultPromptRegistry() });
    const events: EngineEvent[] = [];
    for await (const e of engine.translate({ doc: doc(), priority: [], strategy, options }, new AbortController().signal)) events.push(e);
    return { events, client };
  }

  it('contextual: reports the used entries, and the prompt carries the correction in <context>', async () => {
    const { events, client } = await run('contextual', { ...OPTIONS, memory });
    const ctx = events.filter((e) => e.type === 'stage' && e.stage === 'context');
    expect(ctx).toEqual([{ type: 'stage', stage: 'context', status: 'done', info: { chunk: 0, memory: [{ id: 'k.save', score: expect.any(Number) }] } }]);
    const user = client.requests.map((r) => r.messages[0]?.content ?? '').find((c) => c.includes('<context>')) ?? '';
    expect(user).toContain('<translation>Nhấn nút Lưu để lưu thay đổi.</translation>');
    // Never in the system block (the caching prefix).
    expect(client.requests.every((r) => !r.system.includes('Nhấn nút Lưu'))).toBe(true);
  });

  it('single-pass runs the context-free prompt: the memory changes nothing there', async () => {
    const plain = await run('single-pass', OPTIONS);
    const { events, client } = await run('single-pass', { ...OPTIONS, memory });
    expect(events.some((e) => e.type === 'stage' && e.stage === 'context')).toBe(false);
    expect(client.requests.map((r) => [r.system, r.messages])).toEqual(plain.client.requests.map((r) => [r.system, r.messages]));
  });

  it.each(['single-pass', 'contextual'] as const)('%s: no entries, no event, no <context> block from the memory', async (strategy) => {
    const { events, client } = await run(strategy, OPTIONS);
    expect(events.some((e) => e.type === 'stage' && e.stage === 'context')).toBe(false);
    expect(client.requests.every((r) => !(r.messages[0]?.content ?? '').includes('Corrections the user made'))).toBe(true);
  });
});
