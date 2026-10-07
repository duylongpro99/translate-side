import { describe, expect, it } from 'vitest';
import type { LLMError, NormalizedEvent, NormalizedRequest } from '../llm/types.ts';
import { DEFAULT_RETRY_POLICY, decideRetry, withRetry } from './retry.ts';
import { failed, fakeClient, fakeSleep, rateLimited, success } from './testing.ts';

const request = (signal: AbortSignal = new AbortController().signal): NormalizedRequest => ({
  model: 'fake-model',
  system: 's',
  messages: [{ role: 'user', content: 'u' }],
  maxOutputTokens: 100,
  signal,
});

async function collect(stream: AsyncIterable<NormalizedEvent>): Promise<NormalizedEvent[]> {
  const out: NormalizedEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const err = (kind: LLMError['kind'], extra: Partial<LLMError> = {}): LLMError => ({ kind, message: kind, ...extra });

describe('decideRetry (§4.3.5)', () => {
  it('honors Retry-After for a rate limit', () => {
    expect(decideRetry(err('rate_limit', { retryAfterMs: 14_000 }), 0)).toEqual({ action: 'retry', delayMs: 14_000 });
  });

  it('backs off exponentially with jitter when there is no Retry-After', () => {
    const { baseDelayMs } = DEFAULT_RETRY_POLICY;
    for (const kind of ['rate_limit', 'overloaded', 'network'] as const) {
      expect(decideRetry(err(kind), 0, DEFAULT_RETRY_POLICY, () => 0)).toEqual({ action: 'retry', delayMs: baseDelayMs / 2 });
      expect(decideRetry(err(kind), 2, DEFAULT_RETRY_POLICY, () => 1)).toEqual({ action: 'retry', delayMs: baseDelayMs * 4 });
    }
    const capped = decideRetry(err('overloaded'), 2, { ...DEFAULT_RETRY_POLICY, maxRetries: 10, maxDelayMs: 3000 }, () => 1);
    expect(capped).toEqual({ action: 'retry', delayMs: 3000 });
  });

  it('moves to fallback once retries are used up, or when Retry-After is too long', () => {
    expect(decideRetry(err('rate_limit'), DEFAULT_RETRY_POLICY.maxRetries)).toEqual({ action: 'fallback' });
    expect(decideRetry(err('rate_limit', { retryAfterMs: 120_000 }), 0)).toEqual({ action: 'fallback' });
  });

  it('never retries auth, quota, cors, model_not_found, bad_request or unknown; shrinks on context_length', () => {
    for (const kind of ['auth', 'quota', 'cors', 'model_not_found', 'bad_request', 'unknown'] as const) {
      expect(decideRetry(err(kind), 0), kind).toEqual({ action: 'stop' });
    }
    expect(decideRetry(err('context_length'), 0)).toEqual({ action: 'shrink' });
  });
});

describe('withRetry', () => {
  it('retries a rate limit until it succeeds, honoring Retry-After', async () => {
    const client = fakeClient([[rateLimited(14_000)], [rateLimited(11_000)], success('hello')]);
    const sleep = fakeSleep();
    const events = await collect(withRetry(client, { sleep }).stream(request()));
    expect(client.requests).toHaveLength(3);
    expect(sleep.delays).toEqual([14_000, 11_000]);
    expect(events.map((e) => e.type)).toEqual(['text', 'usage', 'done']);
  });

  it('gives up after maxRetries and yields the last error once', async () => {
    const client = fakeClient([[rateLimited(1000)]]);
    const sleep = fakeSleep();
    const events = await collect(withRetry(client, { sleep }).stream(request()));
    expect(client.requests).toHaveLength(DEFAULT_RETRY_POLICY.maxRetries + 1);
    expect(sleep.delays).toHaveLength(DEFAULT_RETRY_POLICY.maxRetries);
    expect(events).toEqual([rateLimited(1000)]);
  });

  it('does not retry errors that stop', async () => {
    const client = fakeClient([[failed(err('auth', { status: 401 }))], success('never')]);
    const sleep = fakeSleep();
    const events = await collect(withRetry(client, { sleep }).stream(request()));
    expect(client.requests).toHaveLength(1);
    expect(sleep.delays).toEqual([]);
    expect(events).toEqual([failed(err('auth', { status: 401 }))]);
  });

  it('does not retry once text has been emitted: the error goes to the caller', async () => {
    const client = fakeClient([[{ type: 'text', delta: '<seg id="1">Xin' }, failed(err('overloaded'))], success('never')]);
    const events = await collect(withRetry(client, { sleep: fakeSleep() }).stream(request()));
    expect(client.requests).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(['text', 'error']);
  });

  it('sums the usage of every attempt into one usage event before done (stream contract)', async () => {
    const client = fakeClient([[{ type: 'usage', input: 7, output: 3, cachedInput: 4, reasoningOutput: 3 }, failed(err('overloaded'))], success('ok')]);
    const events = await collect(withRetry(client, { sleep: fakeSleep(), random: () => 0 }).stream(request()));
    expect(events).toEqual([
      { type: 'text', delta: 'ok' },
      { type: 'usage', input: 17, output: 8, cachedInput: 4, reasoningOutput: 3 },
      { type: 'done', stopReason: 'end' },
    ]);
  });

  it('sends the summed usage before the final error when retries run out', async () => {
    const client = fakeClient([[{ type: 'usage', input: 3, output: 0 }, rateLimited(1000)]]);
    const events = await collect(withRetry(client, { sleep: fakeSleep() }).stream(request()));
    const total = 3 * (DEFAULT_RETRY_POLICY.maxRetries + 1);
    expect(events).toEqual([{ type: 'usage', input: total, output: 0 }, rateLimited(1000)]);
  });

  it('sends the summed usage before an error that follows text', async () => {
    const client = fakeClient([[{ type: 'usage', input: 2, output: 0 }, rateLimited()], [{ type: 'text', delta: 'Xin' }, { type: 'usage', input: 5, output: 1 }, failed(err('overloaded'))]]);
    const events = await collect(withRetry(client, { sleep: fakeSleep(), random: () => 0 }).stream(request()));
    expect(events).toEqual([{ type: 'text', delta: 'Xin' }, { type: 'usage', input: 7, output: 1 }, failed(err('overloaded'))]);
  });

  it('stops when the signal aborts during backoff', async () => {
    const client = fakeClient([[rateLimited(5000)], success('never')]);
    const controller = new AbortController();
    const sleep = async (_ms: number, signal: AbortSignal) => {
      controller.abort(new Error('cancelled'));
      signal.throwIfAborted();
    };
    await expect(collect(withRetry(client, { sleep }).stream(request(controller.signal)))).rejects.toThrow('cancelled');
    expect(client.requests).toHaveLength(1);
  });

  it('reports each retry to onRetry', async () => {
    const error = err('rate_limit', { retryAfterMs: 2000 });
    const client = fakeClient([[failed(error)], success('ok')]);
    const seen: unknown[] = [];
    await collect(withRetry(client, { sleep: fakeSleep(), onRetry: (i) => seen.push(i) }).stream(request()));
    expect(seen).toEqual([{ error, retry: 1, delayMs: 2000 }]);
  });

  it('is idempotent: wrapping a retrying client returns it unchanged', () => {
    const once = withRetry(fakeClient([success('x')]), { sleep: fakeSleep() });
    expect(withRetry(once, { sleep: fakeSleep() })).toBe(once);
  });

  it('keeps the model info of the wrapped client', () => {
    const wrapped = withRetry(fakeClient([success('x')], { model: 'm', reasoningReserveTokens: 256 }), { sleep: fakeSleep() });
    expect([wrapped.model, wrapped.reasoningReserveTokens({})]).toEqual(['m', 256]);
  });
});
