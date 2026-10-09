import { describe, expect, it } from 'vitest';
import type { LLMClient, LLMError, NormalizedEvent, NormalizedRequest } from '../llm/types.ts';
import { createEngine, type EngineDeps } from './engine.ts';
import { withFallback, type FallbackInfo } from './fallback.ts';
import { createDefaultPromptRegistry } from './prompts/index.ts';
import { DEFAULT_RETRY_POLICY, withRetry } from './retry.ts';
import { contextual } from './strategies/contextual.ts';
import { singlePass } from './strategies/single-pass.ts';
import { failed, fakeClient, fakeSleep, rateLimited, success, translatorClient } from './testing.ts';
import type { EngineEvent, Segment, TranslationJob } from './types.ts';

const request = (model: string, extra: Partial<NormalizedRequest> = {}): NormalizedRequest => ({
  model,
  system: 's',
  messages: [{ role: 'user', content: 'u' }],
  maxOutputTokens: 100,
  signal: new AbortController().signal,
  ...extra,
});

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const err = (kind: LLMError['kind'], extra: Partial<LLMError> = {}): LLMError => ({ kind, message: kind, ...extra });
const retrying = (c: LLMClient, sleep = fakeSleep()) => withRetry(c, { sleep, random: () => 0 });
const attempts = DEFAULT_RETRY_POLICY.maxRetries + 1;

describe('withFallback (§4.3.5, plan M4 §5 retry vs fallback ownership)', () => {
  it.each(['rate_limit', 'overloaded', 'network'] as const)('%s: backs off on the primary, then the next link answers', async (kind) => {
    const primary = fakeClient([[failed(err(kind))]], { model: 'qwen3:8b' });
    const backup = fakeClient([success('xin chào')], { model: 'claude-haiku-4-5' });
    const sleep = fakeSleep();
    const switched: FallbackInfo[] = [];
    const chain = withFallback([retrying(primary, sleep), retrying(backup, sleep)], { onFallback: (i) => switched.push(i) });
    const req = request('qwen3:8b');
    const events = await collect(chain.stream(req));
    expect(primary.requests).toHaveLength(attempts);
    expect(sleep.delays).toHaveLength(DEFAULT_RETRY_POLICY.maxRetries);
    expect(backup.requests).toHaveLength(1);
    expect(backup.requests[0]?.model).toBe('claude-haiku-4-5');
    expect(events.map((e) => e.type)).toEqual(['text', 'usage', 'done']);
    expect(chain.servedBy?.(req)).toBe('claude-haiku-4-5');
    expect(switched).toEqual([{ from: 'qwen3:8b', to: 'claude-haiku-4-5', error: err(kind) }]);
  });

  it('a Retry-After longer than the policy waits for hands over at once', async () => {
    const primary = fakeClient([[rateLimited(120_000)]], { model: 'a' });
    const backup = fakeClient([success('ok')], { model: 'b' });
    const sleep = fakeSleep();
    await collect(withFallback([retrying(primary, sleep), retrying(backup, sleep)]).stream(request('a')));
    expect(primary.requests).toHaveLength(1);
    expect(sleep.delays).toEqual([]);
    expect(backup.requests).toHaveLength(1);
  });

  it.each(['auth', 'quota', 'cors', 'model_not_found', 'bad_request', 'context_length', 'unknown'] as const)('%s: stops at the primary, nothing is sent to the fallback', async (kind) => {
    const primary = fakeClient([[failed(err(kind, kind === 'auth' ? { status: 401 } : {}))]], { model: 'a' });
    const backup = fakeClient([success('ok')], { model: 'b' });
    const events = await collect(withFallback([retrying(primary), retrying(backup)]).stream(request('a')));
    expect(primary.requests).toHaveLength(1);
    expect(backup.requests).toHaveLength(0);
    expect(events).toEqual([{ type: 'error', error: err(kind, kind === 'auth' ? { status: 401 } : {}) }]);
  });

  it('an error after text is not handed over (text shown cannot be taken back)', async () => {
    const primary = fakeClient([[{ type: 'text', delta: 'half' }, failed(err('network'))]], { model: 'a' });
    const backup = fakeClient([success('ok')], { model: 'b' });
    const events = await collect(withFallback([retrying(primary), retrying(backup)]).stream(request('a')));
    expect(backup.requests).toHaveLength(0);
    expect(events.map((e) => e.type)).toEqual(['text', 'error']);
  });

  it('the switch is sticky: later requests skip a link that gave up, and so does another role sharing the set', async () => {
    const primary = fakeClient([[failed(err('network'))]], { model: 'a' });
    const backup = fakeClient([success('ok')], { model: 'b' });
    const dead = new Set<LLMClient>();
    const links = [retrying(primary), retrying(backup)];
    const translate = withFallback(links, { dead });
    const analyze = withFallback(links, { dead });
    await collect(translate.stream(request('a')));
    expect(translate.model).toBe('b');
    expect(analyze.model).toBe('b');
    await collect(analyze.stream(request('b')));
    await collect(translate.stream(request('b')));
    expect(primary.requests).toHaveLength(attempts);
    expect(backup.requests).toHaveLength(3);
  });

  it('every link given up: the last one is tried again, its error is the stream’s', async () => {
    const a = fakeClient([[failed(err('overloaded'))]], { model: 'a' });
    const b = fakeClient([[failed(err('overloaded'))]], { model: 'b' });
    const chain = withFallback([retrying(a), retrying(b)]);
    const first = await collect(chain.stream(request('a')));
    expect(first).toEqual([{ type: 'error', error: err('overloaded') }]);
    const second = await collect(chain.stream(request('b')));
    expect(second).toEqual([{ type: 'error', error: err('overloaded') }]);
    expect(a.requests).toHaveLength(attempts);
    expect(b.requests).toHaveLength(attempts * 2);
  });

  it('the handed-over request carries the next link’s thinking reserve in its output cap', async () => {
    const primary = fakeClient([[failed(err('network'))]], { model: 'a', reasoningReserveTokens: 0 });
    const backup = fakeClient([success('ok')], { model: 'b', reasoningReserveTokens: 400 });
    await collect(withFallback([retrying(primary), retrying(backup)]).stream(request('a', { maxOutputTokens: 100 })));
    expect(backup.requests[0]?.maxOutputTokens).toBe(500);
  });

  it('sums the failed links’ usage into the one usage event', async () => {
    const usage: NormalizedEvent = { type: 'usage', input: 3, output: 0 };
    const primary = fakeClient([[usage, failed(err('overloaded'))]], { model: 'a' });
    const backup = fakeClient([success('ok')], { model: 'b' });
    const events = await collect(withFallback([withRetry(primary, { sleep: fakeSleep(), policy: { ...DEFAULT_RETRY_POLICY, maxRetries: 0 } }), retrying(backup)]).stream(request('a')));
    expect(events.filter((e) => e.type === 'usage')).toEqual([{ type: 'usage', input: 13, output: 5 }]);
  });

  it('one link is that link, unchanged', () => {
    const only = fakeClient([success('ok')]);
    expect(withFallback([only])).toBe(only);
  });
});

// ---- Through the engine: badges come from producedBy, which names the model that answered -----

const seg = (id: string, text = `Sentence ${id}.`): Segment => ({ id, kind: 'p', text, inlineMarkup: text, domPath: `p[${id}]`, translate: true });

function job(segments: Segment[], strategy: string, chunkTokens = 1200): TranslationJob {
  return {
    doc: { url: 'https://example.com', title: 'T', sourceLang: 'en', targetLang: 'vi', outline: [], segments },
    priority: [],
    strategy,
    options: { style: 'natural', glossary: [], maxConcurrency: 1, chunkTokens },
  };
}

function deps(primary: LLMClient, fallback: LLMClient[], onFallback?: EngineDeps['onFallback']): EngineDeps {
  return {
    llm: () => primary,
    fallback: () => fallback,
    ...(onFallback ? { onFallback } : {}),
    now: () => 0,
    sleep: fakeSleep(),
    strategies: [singlePass, contextual],
    prompts: createDefaultPromptRegistry(),
    random: () => 0,
  };
}

describe('the engine with a fallback chain', () => {
  it('a local server stopped mid-page: later chunks finish on the fallback, finals and usage name its model', async () => {
    // Small chunks: one segment each. The local model answers the first chunk, then is down.
    let up = true;
    const local = translatorClient(undefined, { model: 'qwen3:8b' });
    const stopped: LLMClient = {
      model: local.model,
      reasoningReserveTokens: () => 0,
      async *stream(req) {
        if (up) {
          up = false;
          yield* local.stream(req);
          return;
        }
        yield { type: 'error', error: err('network', { message: "Can't reach localhost:11434" }) };
      },
    };
    const cloud = translatorClient(undefined, { model: 'claude-haiku-4-5' });
    const roles: string[] = [];
    const segments = [seg('a', 'One. '.repeat(30)), seg('b', 'Two. '.repeat(30)), seg('c', 'Three. '.repeat(30))];
    const events = await collect(createEngine(deps(stopped, [cloud], (i) => roles.push(`${i.role}:${i.from}->${i.to}`))).translate(job(segments, 'single-pass', 40), new AbortController().signal));
    const finals = events.filter((e): e is Extract<EngineEvent, { type: 'segment.final' }> => e.type === 'segment.final');
    expect(finals.map((f) => [f.id, f.producedBy.model])).toEqual([
      ['a', 'qwen3:8b'],
      ['b', 'claude-haiku-4-5'],
      ['c', 'claude-haiku-4-5'],
    ]);
    expect(events.some((e) => e.type === 'segment.failed')).toBe(false);
    const usage = events.filter((e): e is Extract<EngineEvent, { type: 'usage' }> => e.type === 'usage');
    expect(usage.map((u) => u.model)).toEqual(['qwen3:8b', 'claude-haiku-4-5', 'claude-haiku-4-5']);
    // Sticky: the third chunk went straight to the fallback.
    expect(cloud.requests).toHaveLength(2);
    expect(roles).toEqual(['translate:qwen3:8b->claude-haiku-4-5']);
  });

  it('a bad key stops: no request reaches the fallback, the segments fail with auth', async () => {
    const primary = fakeClient([[failed(err('auth', { status: 401, message: 'Key invalid or missing' }))]], { model: 'claude-haiku-4-5' });
    const backup = translatorClient(undefined, { model: 'qwen3:8b' });
    const events = await collect(createEngine(deps(primary, [backup])).translate(job([seg('a'), seg('b')], 'contextual'), new AbortController().signal));
    expect(backup.requests).toHaveLength(0);
    const failedKinds = events.flatMap((e) => (e.type === 'segment.failed' ? [e.error.kind] : []));
    expect(failedKinds).toEqual(['auth', 'auth']);
  });

  it('the analyze role falls back on the same chain, and its usage names the model that answered', async () => {
    const down = fakeClient([[failed(err('overloaded'))]], { model: 'a' });
    const brief = JSON.stringify({ genre: 'g', audience: 'a', purpose: 'p', tone: 't', glossary: [] });
    const backup = translatorClient((lines) => (lines.length === 0 ? brief : lines.map((l) => `<seg id="${l.n}">vi:${l.source}</seg>`).join('\n')), { model: 'b' });
    // More than one chunk, so contextual asks for a brief (M2-D9).
    const segments = [seg('a', 'One. '.repeat(30)), seg('b', 'Two. '.repeat(30)), seg('c', 'Three. '.repeat(30))];
    const events = await collect(createEngine(deps(down, [backup])).translate(job(segments, 'contextual', 40), new AbortController().signal));
    const usage = events.filter((e): e is Extract<EngineEvent, { type: 'usage' }> => e.type === 'usage');
    expect(usage.some((u) => u.role === 'analyze')).toBe(true);
    expect(new Set(usage.map((u) => u.model))).toEqual(new Set(['b']));
    expect(events.some((e) => e.type === 'artifact')).toBe(true);
    // Sticky across roles: the translate call never went to the primary.
    expect(down.requests).toHaveLength(attempts);
  });
});

describe('context_length: shrink the chunk and retry (§4.3.5)', () => {
  it('splits a chunk the model finds too long into halves until each fits; finals come back for all', async () => {
    const tooLong: NormalizedEvent = { type: 'error', error: err('context_length', { status: 400, message: 'prompt is too long' }) };
    const sizes: number[] = [];
    const client = translatorClient((lines) => {
      sizes.push(lines.length);
      return lines.length > 1 ? { text: '', usage: null } : lines.map((l) => `<seg id="${l.n}">vi:${l.source}</seg>`).join('\n');
    }, { model: 'm' });
    const tight: LLMClient = {
      model: 'm',
      reasoningReserveTokens: () => 0,
      async *stream(req) {
        const n = (req.messages[0]?.content.match(/<seg /g) ?? []).length;
        if (n > 1) {
          sizes.push(n);
          yield tooLong;
          return;
        }
        yield* client.stream(req);
      },
    };
    const events = await collect(createEngine(deps(tight, [])).translate(job([seg('a'), seg('b'), seg('c')], 'single-pass'), new AbortController().signal));
    expect(events.filter((e) => e.type === 'segment.final').map((e) => (e as { id: string }).id).sort()).toEqual(['a', 'b', 'c']);
    expect(events.some((e) => e.type === 'segment.failed')).toBe(false);
    // 3 → [2 → 1, 1], 1
    expect(sizes).toEqual([3, 2, 1, 1, 1]);
  });

  it('a single segment still too long fails with the context_length error', async () => {
    const client = fakeClient([[failed(err('context_length', { message: 'prompt is too long' }))]], { model: 'm' });
    const events = await collect(createEngine(deps(client, [])).translate(job([seg('a')], 'single-pass'), new AbortController().signal));
    const fails = events.flatMap((e) => (e.type === 'segment.failed' ? [e.error.kind] : []));
    expect(fails).toEqual(['context_length']);
    expect(client.requests).toHaveLength(1);
  });
});
