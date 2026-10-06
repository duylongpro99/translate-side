import { describe, expect, it } from 'vitest';
import type { LLMClient, NormalizedEvent } from '@/llm/types';
import { askJudge, judgeOnce, QuotaStop } from './judge-core';

const GOOD = '{"fidelity": 4, "naturalness": 3, "tone": 4, "terminology": 5, "comment": "ok"}';

/** A client that plays one scripted answer per call. */
function scripted(answers: NormalizedEvent[][]): LLMClient & { calls: number } {
  const c = {
    calls: 0,
    model: 'm',
    reasoningReserveTokens: 0,
    async *stream() {
      yield* answers[Math.min(c.calls++, answers.length - 1)] as NormalizedEvent[];
    },
  };
  return c as unknown as LLMClient & { calls: number };
}
const text = (t: string): NormalizedEvent[] => [{ type: 'text', delta: t }, { type: 'usage', input: 10, cachedInput: 4, output: 2 }, { type: 'done', stopReason: 'end' }];
const fail = (kind: string, message: string, extra: object = {}): NormalizedEvent[] => [{ type: 'error', error: { kind, message, ...extra } } as unknown as NormalizedEvent];
const noSleep = async (): Promise<void> => undefined;
const usage = (): { input: number; cachedInput: number; output: number } => ({ input: 0, cachedInput: 0, output: 0 });

describe('askJudge', () => {
  it('returns the text and counts input, cached input and output tokens', async () => {
    const u = usage();
    expect(await askJudge(scripted([text(GOOD)]), 's', 'u', u, noSleep)).toBe(GOOD);
    expect(u).toEqual({ input: 10, cachedInput: 4, output: 2 });
  });
  it('retries an overloaded model with backoff, then succeeds', async () => {
    const waits: number[] = [];
    const llm = scripted([fail('overloaded', 'busy'), fail('overloaded', 'busy'), text(GOOD)]);
    expect(await askJudge(llm, 's', 'u', usage(), async (ms) => void waits.push(ms))).toBe(GOOD);
    expect(llm.calls).toBe(3);
    expect(waits).toEqual([2000, 4000]);
  });
  it('gives up with an error after repeated bursts', async () => {
    const llm = scripted([fail('overloaded', 'busy')]);
    await expect(askJudge(llm, 's', 'u', usage(), noSleep)).rejects.toThrow('overloaded: busy');
    expect(llm.calls).toBe(6);
  });
  it('stops on a daily quota without retrying', async () => {
    for (const e of [fail('quota', 'out'), fail('rate_limit', 'Quota exceeded ... PerDay'), fail('rate_limit', 'x', { retryAfterMs: 9 * 3600_000 })]) {
      const llm = scripted([e]);
      await expect(askJudge(llm, 's', 'u', usage(), noSleep)).rejects.toBeInstanceOf(QuotaStop);
      expect(llm.calls).toBe(1);
    }
  });
  it('does not retry an error that is not transient', async () => {
    const llm = scripted([fail('auth', 'bad key')]);
    await expect(askJudge(llm, 's', 'u', usage(), noSleep)).rejects.toThrow('auth: bad key');
    expect(llm.calls).toBe(1);
  });
});

describe('judgeOnce', () => {
  it('asks again when a dimension is missing and takes the complete second reply', async () => {
    const replies = ['{"fidelity": 4}', GOOD];
    let n = 0;
    expect(await judgeOnce(async () => replies[n++] as string, 's', 'u')).toEqual({ fidelity: 4, naturalness: 3, tone: 4, terminology: 5, comment: 'ok' });
    expect(n).toBe(2);
  });
  it('returns undefined, not partial scores, when the retry is still incomplete', async () => {
    let n = 0;
    expect(await judgeOnce(async () => (n++, '{"fidelity": 4}'), 's', 'u')).toBeUndefined();
    expect(n).toBe(2);
  });
});
