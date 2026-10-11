import { describe, expect, it } from 'vitest';
import { contextual } from '@/engine/index';
import { PANEL_STRATEGY } from '@/entrypoints/sidepanel/jobs';
import { APIBOX_QWEN_QUIRKS } from '@/llm/presets';
import { DEFAULT_CONNECTION, DEFAULT_PROFILE } from '@/shared/settings';
import { belowM2, computeDimensions, GATE_CHUNK_TOKENS, judgeMismatch, judgePass, lineCost, MIN_MARGIN, runGate, sampleSd, shippedConfig, translateArgs, type GateFile, type PassResult } from './gate';
import { JUDGE_MODEL, JUDGE_PROMPT_ID } from './judge-core';
import { PROVIDERS } from './providers';

const dims = (baseline: number, margin: number) => ({ baseline, sd: margin / 2, margin, m2c400: baseline, runs: [baseline] });
const gate: Pick<GateFile, 'dimensions' | 'judge'> = {
  judge: { model: JUDGE_MODEL, prompt: JUDGE_PROMPT_ID },
  dimensions: { fidelity: dims(4.5, 0.1), naturalness: dims(4, 0.2), tone: dims(4.2, 0.1), terminology: dims(4.4, 0.1) },
};
const pass = (over: Partial<PassResult> = {}): PassResult => ({
  dir: 'eval-results/gate-x',
  means: { fidelity: 4.5, naturalness: 4, tone: 4.2, terminology: 4.4 },
  scored: 23,
  passages: 23,
  briefedChunks: 11,
  revised: 48,
  lost: 0,
  translatable: 149,
  translateUsd: 0.005,
  judgeUsd: 0.15,
  judgeModel: JUDGE_MODEL,
  judgePrompt: JUDGE_PROMPT_ID,
  wallMs: 900_000,
  ...over,
});

describe('shippedConfig', () => {
  it('takes the model, quirks and strategy from the shipped constants, at chunk 400', () => {
    const cfg = shippedConfig();
    expect(cfg.model).toBe(DEFAULT_PROFILE.model);
    expect(cfg.quirks).toEqual({ ...DEFAULT_CONNECTION.quirks, ...DEFAULT_PROFILE.quirks });
    expect(cfg.quirks).toMatchObject(APIBOX_QWEN_QUIRKS);
    expect(cfg.strategy).toBe(PANEL_STRATEGY);
    expect(cfg.strategyVersion).toBe(contextual.version);
    expect(cfg.translatePrompt).toBe('translate@2');
    expect(cfg.concurrency).toBe(DEFAULT_PROFILE.maxConcurrency);
    expect(cfg.chunkTokens).toBe(GATE_CHUNK_TOKENS);
    expect(PROVIDERS[cfg.provider]?.conn.baseUrl).toBe(DEFAULT_CONNECTION.baseUrl);
  });
  it('passes that configuration to the harness', () => {
    const args = translateArgs(shippedConfig(), 'out');
    expect(args.join(' ')).toBe(`--set eval --provider apibox --model ${DEFAULT_PROFILE.model} --strategy contextual --prompt translate@2 --chunk-tokens 400 --concurrency ${DEFAULT_PROFILE.maxConcurrency} --target vi --out out`);
  });
});

describe('judgePass', () => {
  it('is green at the baseline and exactly at the floor', () => {
    expect(judgePass(gate, pass()).ok).toBe(true);
    const v = judgePass(gate, pass({ means: { fidelity: 4.4, naturalness: 3.8, tone: 4.1, terminology: 4.3 } }));
    expect(v.ok).toBe(true);
    expect(v.spendUsd).toBeCloseTo(0.155);
  });
  it('fails a dimension below its baseline minus its margin, naming the drop', () => {
    const v = judgePass(gate, pass({ means: { fidelity: 4.5, naturalness: 3.7, tone: 4.2, terminology: 4.4 } }));
    expect(v.ok).toBe(false);
    expect(v.rows.find((r) => r.dimension === 'naturalness')?.ok).toBe(false);
    expect(v.reasons).toEqual(['naturalness 3.70 < floor 3.80 (baseline 4.00 − margin 0.20)']);
  });
  it('fails a pass in which no chunk was briefed or no segment revised, whatever the scores', () => {
    expect(judgePass(gate, pass({ briefedChunks: 0 })).reasons).toEqual(['no chunk carried the brief: the contextual path did not run']);
    expect(judgePass(gate, pass({ revised: 0 })).reasons).toEqual(['no segment was revised: the chunk-0 second pass did not run']);
  });
  it('fails an incomplete, lossy, unpriced, stopped or other-judge pass', () => {
    expect(judgePass(gate, pass({ scored: 22 })).reasons).toEqual(['judge scored 22/23 passages']);
    expect(judgePass(gate, pass({ lost: 2 })).reasons).toEqual(['2/149 segments lost']);
    expect(judgePass(gate, pass({ judgeUsd: null })).ok).toBe(false);
    expect(judgePass(gate, pass({ translateUsd: 0, judgeUsd: 0 })).reasons).toEqual(['no priced calls reported: a pass without real spend is not a result']);
    expect(judgePass(gate, pass({ judgeModel: 'mock-judge' })).ok).toBe(false);
    const timedOut = judgePass(gate, pass({ error: 'timed out while judging (25 min)', means: {}, scored: 0 }));
    expect(timedOut.ok).toBe(false);
    expect(timedOut.reasons[0]).toBe('timed out while judging (25 min)');
    expect(timedOut.rows.every((r) => r.score === undefined && !r.ok)).toBe(true);
  });
});

describe('runGate', () => {
  const low = pass({ means: { fidelity: 4.1, naturalness: 4, tone: 4.2, terminology: 4.4 } });
  const run = async (results: PassResult[], cap?: number) => {
    const asked: { attempt: number; budget: number }[] = [];
    const log: string[] = [];
    const out = await runGate(gate, async (attempt, budget) => (asked.push({ attempt, budget }), results[attempt - 1] as PassResult), (l) => log.push(l), cap);
    return { out, asked, log: log.join('\n') };
  };
  it('passes on a green first pass without a second', async () => {
    const { out, asked, log } = await run([pass()]);
    expect(out.green).toBe(true);
    expect(asked).toHaveLength(1);
    expect(log).toContain('eval gate GREEN: 1 pass(es), spend $0.1550');
    expect(log).toContain('| fidelity | 4.50 | 0.10 | 4.40 | 4.50 | +0.00 | ok |');
  });
  it('re-runs a failed pass once and passes when the second is green', async () => {
    const { out, asked, log } = await run([low, pass()]);
    expect(out.green).toBe(true);
    expect(asked.map((a) => a.attempt)).toEqual([1, 2]);
    expect(asked[1]?.budget).toBeCloseTo(0.5 - 0.155);
    expect(log).toContain('pass 1: RED');
    expect(log).toContain('| fidelity | 4.50 | 0.10 | 4.40 | 4.10 | −0.40 | FAIL |');
    expect(log).toContain('pass 2: GREEN');
    expect(out.spendUsd).toBeCloseTo(0.31);
  });
  it('is red when both passes fail, and prints the table and the spend of each', async () => {
    const { out, log } = await run([low, low]);
    expect(out.green).toBe(false);
    expect(out.passes).toHaveLength(2);
    expect(log.match(/fidelity 4\.10 < floor 4\.40/g)).toHaveLength(2);
    expect(log).toContain('spend: translate $0.0050 + judge $0.1500 = $0.1550');
    expect(log).toContain('eval gate RED: 2 pass(es), spend $0.3100');
  });
  it('runs no second pass once the spend cap is spent', async () => {
    const { out, asked, log } = await run([pass({ error: 'stopped at the spend cap while judging', translateUsd: 0.1, judgeUsd: 0.45 })]);
    expect(out.green).toBe(false);
    expect(asked).toHaveLength(1);
    expect(log).toContain('spend cap $0.50 reached');
  });
});

describe('judge pin', () => {
  it('accepts the judge judge-core.ts pins and refuses another model or prompt', () => {
    expect(judgeMismatch(gate)).toBeUndefined();
    expect(judgeMismatch({ judge: { model: 'gemini-3.7-flash', prompt: JUDGE_PROMPT_ID } })).toContain('re-baseline deliberately');
    expect(judgeMismatch({ judge: { model: JUDGE_MODEL, prompt: 'judge@2' } })).toContain(`pins ${JUDGE_MODEL} (${JUDGE_PROMPT_ID})`);
  });
});

describe('margins', () => {
  it('uses the sample SD, twice of it, never below the minimum', () => {
    expect(sampleSd([4, 4, 4])).toBe(0);
    expect(sampleSd([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2.5));
    const runs = [4.3, 4.4, 4.5, 4.4, 4.4].map((f) => ({ fidelity: f, naturalness: 4, tone: 4, terminology: 4 }));
    const d = computeDimensions(runs, { fidelity: 4.5, naturalness: 4.2, tone: 4, terminology: 3.9 });
    expect(d.fidelity.baseline).toBeCloseTo(4.4);
    expect(d.fidelity.margin).toBeCloseTo(2 * sampleSd([4.3, 4.4, 4.5, 4.4, 4.4]));
    expect(d.naturalness.margin).toBe(MIN_MARGIN);
    // naturalness 4.00 < 4.20 − 0.10; fidelity 4.40 ≥ 4.50 − 0.14.
    expect(belowM2(d)).toEqual(['naturalness']);
  });
});

describe('lineCost', () => {
  it('reads the cost at the end of a harness passage line', () => {
    expect(lineCost('k8s-pods                           final 9/9 lost 0 repaired 0 check 0→0/0 code 0/0 calls 3 in 1200 out 600 21.0s $0.00012 (UNVERIFIED price)')).toBeCloseTo(0.00012);
    expect(lineCost('k8s-pods final 9/9 calls 3 in 1 out 1 2.0s $0.00030')).toBeCloseTo(0.0003);
    expect(lineCost('k8s-pods final 9/9 calls 3 in 1 out 1 2.0s cost n/a')).toBe(0);
    expect(lineCost('results: eval-results/x  total lost 0/149  cost $0.00534')).toBe(0);
  });
});
