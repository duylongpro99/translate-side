import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { contextual, CONTEXTUAL_TRANSLATE_PROMPT_ID, refine, REVIEW_PROMPT_ID } from '@/engine/index';
import { PANEL_STRATEGY } from '@/entrypoints/sidepanel/jobs';
import { APIBOX_JUDGE_QUIRKS, APIBOX_QWEN_QUIRKS } from '@/llm/presets';
import { DEFAULT_CONNECTION, DEFAULT_PROFILE } from '@/shared/settings';
import { BASELINE_DIR, belowM2, computeDimensions, fromProblems, GATE_BEST_FILE, GATE_CHUNK_TOKENS, GATE_FILE, gateFile, judgeMismatch, judgePass, lineCost, main, MIN_MARGIN, PINNED_JUDGE, renderPass, reviewedSegments, runConfigMismatch, runGate, sampleSd, shippedConfig, translateArgs, type GateConfig, type GateFile, type GateSummary, type PassResult } from './gate';
import { JUDGE_MODEL, JUDGE_PROMPT_ID } from './judge-core';
import { PROVIDERS } from './providers';

const dims = (baseline: number, margin: number) => ({ baseline, sd: margin / 2, margin, m2c400: baseline, runs: [baseline] });
const gate: Pick<GateFile, 'dimensions' | 'judge'> = {
  judge: PINNED_JUDGE,
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
  judge: PINNED_JUDGE,
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
    expect(cfg.translatePrompt).toBe(CONTEXTUAL_TRANSLATE_PROMPT_ID);
    expect(cfg.concurrency).toBe(DEFAULT_PROFILE.maxConcurrency);
    expect(cfg.chunkTokens).toBe(GATE_CHUNK_TOKENS);
    expect(PROVIDERS[cfg.provider]?.conn.baseUrl).toBe(DEFAULT_CONNECTION.baseUrl);
  });
  it('passes that configuration to the harness', () => {
    const args = translateArgs(shippedConfig(), 'out');
    expect(args.join(' ')).toBe(`--set eval --provider apibox --model ${DEFAULT_PROFILE.model} --strategy contextual --prompt ${CONTEXTUAL_TRANSLATE_PROMPT_ID} --chunk-tokens 400 --concurrency ${DEFAULT_PROFILE.maxConcurrency} --target vi --out out`);
  });
});

describe('best mode', () => {
  it('builds the shipped configuration with refine, its version and the shipped review prompt', () => {
    const best = shippedConfig('best');
    expect(best).toEqual({ ...shippedConfig(), strategy: refine.id, strategyVersion: refine.version, translatePrompt: CONTEXTUAL_TRANSLATE_PROMPT_ID, reviewPrompt: REVIEW_PROMPT_ID });
    // The Balanced configuration has no review prompt at all, so eval/gate.json's config is unchanged.
    expect(shippedConfig()).not.toHaveProperty('reviewPrompt');
    expect(shippedConfig('balanced')).toEqual(shippedConfig());
  });
  it('passes the review prompt to the harness', () => {
    expect(translateArgs(shippedConfig('best'), 'out').join(' ')).toBe(`--set eval --provider apibox --model ${DEFAULT_PROFILE.model} --strategy refine --prompt ${CONTEXTUAL_TRANSLATE_PROMPT_ID} --review-prompt ${REVIEW_PROMPT_ID} --chunk-tokens 400 --concurrency ${DEFAULT_PROFILE.maxConcurrency} --target vi --out out`);
  });
  it('reads and writes its own baseline file and folders, never the Balanced ones', () => {
    expect(GATE_FILE).toBe('eval/gate.json');
    expect(gateFile('balanced')).toBe(GATE_FILE);
    expect(gateFile('best')).toBe(GATE_BEST_FILE);
    expect(GATE_BEST_FILE).toBe('eval/gate-best.json');
    expect(BASELINE_DIR(3)).toBe('eval/runs/gate-baseline-3');
    expect(BASELINE_DIR(3, 'best')).toBe('eval/runs/gate-best-baseline-3');
    expect(judgeMismatch({ judge: { ...PINNED_JUDGE, model: 'other' } }, PINNED_JUDGE, GATE_BEST_FILE)).toMatch(/^eval\/gate-best\.json was scored by other/);
  });
  it('fails a refine pass in which no segment was reviewed, and prints the reviewed count', () => {
    expect(judgePass(gate, pass({ reviewed: 0 })).reasons).toEqual(['no segment was reviewed: the review pass did not run']);
    const ok = judgePass(gate, pass({ reviewed: 40 }));
    expect(ok.ok).toBe(true);
    expect(renderPass(1, pass({ reviewed: 40 }), ok)).toContain('revised segments 48, reviewed segments 40, lost 0/149');
    // A Balanced pass has no review count and is not asked for one.
    expect(judgePass(gate, pass()).ok).toBe(true);
    expect(renderPass(1, pass(), judgePass(gate, pass()))).toContain('revised segments 48, lost 0/149');
  });
  it('counts the segments the review answered for, not the skipped ones', () => {
    expect(reviewedSegments({ review: { chunks: 3, accepted: 4, unchanged: 30, rejected: 2, skipped: 9, input: 1, output: 1 } })).toBe(36);
    expect(reviewedSegments({ review: null })).toBe(0);
    expect(reviewedSegments({})).toBe(0);
  });
});

/** A finished harness run of exactly `cfg` (the fields run.ts writes that the gate compares). */
const runOf = (cfg: GateConfig, over: Partial<GateSummary> = {}): GateSummary => ({
  run: 'r1',
  set: cfg.set,
  label: `${cfg.provider}/${cfg.model}`,
  model: cfg.model,
  strategy: cfg.strategy,
  strategyVersion: cfg.strategyVersion,
  prompt: cfg.translatePrompt,
  prompts: { translate: cfg.translatePrompt, analyze: 'analyze@1', ...(cfg.reviewPrompt === undefined ? {} : { review: cfg.reviewPrompt }) },
  style: 'natural',
  gloss: 'first',
  glossary: 0,
  chunkTokens: cfg.chunkTokens,
  concurrency: cfg.concurrency,
  target: cfg.target,
  thinking: { reasoning: cfg.quirks.reasoning },
  total: { translatable: 1, lost: 0, failed: 0, repaired: 0, calls: 1, input: 1, cachedInput: 0, output: 1, wallMs: 1, costUsd: 0.001 },
  docs: [],
  ...over,
});

describe('seeding a baseline from finished runs', () => {
  const best = shippedConfig('best');
  it('accepts a run of exactly the gate configuration', () => {
    expect(runConfigMismatch(runOf(best), best)).toEqual([]);
    expect(runConfigMismatch(runOf(shippedConfig()), shippedConfig())).toEqual([]);
  });
  it('names every difference from the gate configuration', () => {
    expect(runConfigMismatch(runOf(best, { label: 'mock', chunkTokens: 1500 }), best)).toEqual([`provider/model "mock", not "${best.provider}/${best.model}"`, 'chunk tokens 1500, not 400']);
    expect(runConfigMismatch(runOf(best, { prompts: { translate: CONTEXTUAL_TRANSLATE_PROMPT_ID, review: 'review@0' } }), best)).toEqual(['review prompt "review@0", not "' + REVIEW_PROMPT_ID + '"']);
    // A contextual run cannot seed the Best baseline.
    expect(runConfigMismatch(runOf(shippedConfig()), best)).toContain('strategy "contextual", not "refine"');
    expect(runConfigMismatch(runOf(best, { thinking: null }), best)[0]).toMatch(/^thinking none, not /);
    expect(runConfigMismatch(runOf(best, { style: 'faithful', glossary: 2 }), best)).toEqual(['style "faithful", not "natural"', 'personal glossary 2, not 0']);
  });
  it('refuses missing runs, other configurations and a baseline folder holding another run', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-from-'));
    try {
      const write = (dir: string, s: GateSummary) => {
        fs.mkdirSync(path.join(root, dir), { recursive: true });
        fs.writeFileSync(path.join(root, dir, 'summary.json'), JSON.stringify(s));
      };
      write('r/a', runOf(best, { run: 'a' }));
      write('r/b', runOf(best, { run: 'b', concurrency: 1 }));
      write('r/c', runOf(best, { run: 'c' }));
      expect(fromProblems(['r/a', 'r/c'], best, 'best', root)).toEqual([]);
      expect(fromProblems(['r/a', 'r/b', 'r/none'], best, 'best', root)).toEqual([`r/b: concurrency 1, not ${best.concurrency}`, 'r/none: no summary.json (not a finished harness run)']);
      // The second baseline folder already holds run c: seeding it again is fine, another run is refused.
      write(BASELINE_DIR(2, 'best'), runOf(best, { run: 'c' }));
      expect(fromProblems(['r/a', 'r/c'], best, 'best', root)).toEqual([]);
      expect(fromProblems(['r/c', 'r/a'], best, 'best', root)).toEqual([`${BASELINE_DIR(2, 'best')} already holds another run (c): delete the old baseline runs first`]);
      // The Balanced folders are another mode's: not in the way.
      expect(fromProblems(['r/c', 'r/a'], shippedConfig(), 'balanced', root).some((p) => p.includes('already holds'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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
    expect(judgePass(gate, pass({ judge: { ...PINNED_JUDGE, model: 'mock-judge' } })).ok).toBe(false);
    expect(judgePass(gate, pass({ judge: { ...PINNED_JUDGE, effort: 'off' } })).reasons[0]).toContain('thinking off');
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
  it('pins the judge-core.ts model and prompt with the thinking judge.ts sends', () => {
    expect(PINNED_JUDGE).toEqual({ model: JUDGE_MODEL, prompt: JUDGE_PROMPT_ID, effort: APIBOX_JUDGE_QUIRKS.reasoning?.lowest });
  });
  it('accepts the pinned judge and refuses another model, prompt or thinking effort', () => {
    expect(judgeMismatch(gate)).toBeUndefined();
    expect(judgeMismatch({ judge: { ...PINNED_JUDGE, model: 'gemini-3.7-flash' } })).toContain('re-baseline deliberately');
    expect(judgeMismatch({ judge: { ...PINNED_JUDGE, prompt: 'judge@2' } })).toContain(`the pinned judge is ${JUDGE_MODEL} (${JUDGE_PROMPT_ID}, thinking ${PINNED_JUDGE.effort})`);
    expect(judgeMismatch({ judge: { ...PINNED_JUDGE, effort: 'low' } })).toContain('thinking low');
  });
});

describe('margins', () => {
  it('uses the sample SD, twice of it, never below the minimum', () => {
    expect(sampleSd([4, 4, 4])).toBe(0);
    expect(sampleSd([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2.5));
    const fid = [4.2, 4.4, 4.6, 4.4, 4.4];
    const runs = fid.map((f) => ({ fidelity: f, naturalness: 4, tone: 4, terminology: 4.3 + (f - 4.4) / 2 }));
    const d = computeDimensions(runs, { fidelity: 4.6, naturalness: 4.3, tone: 4, terminology: 3.9 });
    expect(d.fidelity.baseline).toBeCloseTo(4.4);
    expect(d.fidelity.margin).toBeCloseTo(2 * sampleSd(fid));
    expect(d.naturalness.margin).toBe(MIN_MARGIN);
    // 2 × SD 0.141 is below the minimum: one point on 3 of 23 passages must not turn the gate red.
    expect(d.terminology.margin).toBe(MIN_MARGIN);
    expect(MIN_MARGIN).toBe(0.2);
    // naturalness 4.00 < 4.30 − 0.20; fidelity 4.40 ≥ 4.60 − 0.28.
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

describe('main', () => {
  it.each([
    [['--baseline', '0'], '--baseline expects'],
    [['--baseline', 'x'], '--baseline expects'],
    [['--baseline', '2'], '--baseline expects'],
    [['--baseline', '4.5'], '--baseline expects'],
    [['--timeout-min', 'x'], '--timeout-min expects'],
    [['--timeout-min', '0'], '--timeout-min expects'],
    [['--baselin', '5'], "Unknown option '--baselin'"],
    [['--mode', 'fast'], '--mode expects balanced or best, not "fast"'],
    [['--mode', 'best', '--from', 'a,b,c'], '--from seeds the baseline runs, so it needs --baseline with as many runs as folders (3 given, no --baseline)'],
    [['--baseline', '3', '--from', 'a,b'], '(2 given, --baseline 3)'],
    [['--mode', 'best', '--baseline', '3', '--from', 'eval/runs/none-1,eval/runs/none-2,eval/runs/none-3'], 'eval/runs/none-2: no summary.json'],
    [['--mode', 'best', '--baseline', '3', '--from', 'eval/runs/gate-baseline-1,eval/runs/gate-baseline-2,eval/runs/gate-baseline-3'], 'eval/runs/gate-baseline-1: strategy "contextual", not "refine"'],
  ])('refuses %j before any call', async (argv, message) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await main(argv)).toBe(2);
      expect(log.mock.calls.flat().join('\n')).toContain(message);
    } finally {
      log.mockRestore();
    }
  });
});
