// Eval regression gate: pnpm run eval:gate [-- --timeout-min n]
//                       pnpm run eval:gate -- --baseline 5    (re-baseline: writes eval/runs/gate-baseline-<n>/ and eval/gate.json)
// Translates the 23 eval passages with the shipped default (DEFAULT_PROFILE's model and quirks, the panel's
// strategy) at chunk 400, so the passages long enough to split (about 10 of the 23) run the brief, briefed chunks
// and the chunk-0 revision, then scores them with the pinned judge and compares each dimension's mean with eval/gate.json:
// a dimension below its baseline mean minus its margin fails the pass. A failed pass is run once more; the gate
// is red only when both fail. It refuses (exit 2) when gate.json's judge differs from judge-core.ts, and stops a
// pass at the spend cap or the timeout with a verdict. Runs locally with the keys in .env (eval/README.md says when).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import { contextual, CONTEXTUAL_TRANSLATE_PROMPT_ID, singlePass, TRANSLATE_PROMPT_ID } from '@/engine/index';
import { PANEL_STRATEGY } from '@/entrypoints/sidepanel/jobs';
import { APIBOX_JUDGE_QUIRKS } from '@/llm/presets';
import type { Quirks } from '@/llm/types';
import { DEFAULT_CONNECTION, DEFAULT_PROFILE, withProfileQuirks } from '@/shared/settings';
import { JUDGE_MODEL, JUDGE_PROMPT_ID } from './judge-core.ts';
import { harnessQuirks, PROVIDERS } from './providers.ts';
import { dimensionMeans } from './report-core.ts';
import { DIMENSIONS, type Dimension } from './rubric.ts';
import { loadRun, type RunSummary } from './runs.ts';

/**
 * About 10 of the 23 eval passages split into several chunks at this size; a one-chunk passage skips the brief
 * (contextual.ts), so the gate checks that some chunks were briefed and some segments revised.
 */
export const GATE_CHUNK_TOKENS = 400;
/** A margin never below this: the judge scores whole points, so a smaller one turns noise red. */
export const MIN_MARGIN = 0.1;
/** USD at the nominal prices of pricing.ts (the APIBOX ones are unverified); a gate run stops above it. */
export const SPEND_CAP_USD = 0.5;
export const GATE_FILE = 'eval/gate.json';
/** Fewer baseline runs give no usable standard deviation (the plan takes 5). */
export const MIN_BASELINE_RUNS = 3;
export const M2_C400_RUN = 'eval/runs/baseline-contextual-translate2-qwen3.8-flash-c400';
export const BASELINE_DIR = (n: number): string => `eval/runs/gate-baseline-${n}`;

/** What makes judge scores comparable: the model, the prompt id and the thinking effort (judge.ts resumes only on all three). */
export interface JudgeIdentity {
  model: string;
  prompt: string;
  effort: string;
}

/** The judge judge-core.ts pins, with the thinking judge.ts sends to APIBOX. */
export const PINNED_JUDGE: JudgeIdentity = { model: JUDGE_MODEL, prompt: JUDGE_PROMPT_ID, effort: String(APIBOX_JUDGE_QUIRKS.reasoning?.lowest ?? 'off') };

const judgeLabel = (j: JudgeIdentity): string => `${j.model} (${j.prompt}, thinking ${j.effort})`;

export interface GateConfig {
  /** The harness provider whose connection is the shipped default's (providers.ts). */
  provider: string;
  model: string;
  quirks: Quirks;
  strategy: string;
  strategyVersion: number;
  translatePrompt: string;
  chunkTokens: number;
  concurrency: number;
  set: 'eval';
  target: string;
}

export interface GateDimension {
  /** Mean over the baseline runs of each run's 23-passage judge mean. */
  baseline: number;
  /** Sample standard deviation of those run means. */
  sd: number;
  /** max(2 × sd, MIN_MARGIN). */
  margin: number;
  /** The M2 c400 run's judge mean, the reference the baseline was checked against. */
  m2c400: number;
  /** Each baseline run's judge mean. */
  runs: number[];
}

export interface GateFile {
  judge: JudgeIdentity;
  config: GateConfig;
  marginRule: string;
  dimensions: Record<Dimension, GateDimension>;
  baselineRuns: string[];
  m2c400Run: string;
  createdAt: string;
}

/**
 * The configuration the extension ships: the default profile's model and quirks over the default connection's
 * (as the app builds its client), the panel's strategy and its translate prompt. Throws when the harness cannot
 * send exactly that (no provider with the default connection, or different quirks).
 */
export function shippedConfig(): GateConfig {
  const provider = Object.entries(PROVIDERS).find(([, p]) => p.conn.baseUrl === DEFAULT_CONNECTION.baseUrl && p.conn.protocol === DEFAULT_CONNECTION.protocol);
  if (provider === undefined) throw new Error(`no harness provider for the default connection ${DEFAULT_CONNECTION.baseUrl} (scripts/eval/providers.ts)`);
  const [name, preset] = provider;
  const app = withProfileQuirks({ ...DEFAULT_CONNECTION, apiKey: '', hasHostPermission: async () => true }, DEFAULT_PROFILE).quirks;
  const harness = harnessQuirks(preset, DEFAULT_PROFILE.model);
  if (!isDeepStrictEqual(app, harness)) throw new Error(`the harness would send other quirks for ${DEFAULT_PROFILE.model} than the extension (providers.ts vs settings.ts): ${JSON.stringify(harness)} vs ${JSON.stringify(app)}`);
  const strategy = [singlePass, contextual].find((s) => s.id === PANEL_STRATEGY);
  if (strategy === undefined) throw new Error(`the harness cannot run the panel's strategy ${PANEL_STRATEGY}`);
  return {
    provider: name,
    model: DEFAULT_PROFILE.model,
    quirks: app,
    strategy: strategy.id,
    strategyVersion: strategy.version,
    translatePrompt: strategy.id === contextual.id ? CONTEXTUAL_TRANSLATE_PROMPT_ID : TRANSLATE_PROMPT_ID,
    chunkTokens: GATE_CHUNK_TOKENS,
    concurrency: DEFAULT_PROFILE.maxConcurrency,
    set: 'eval',
    target: 'vi',
  };
}

/** The harness arguments of a gate pass. */
export function translateArgs(cfg: GateConfig, out: string): string[] {
  return ['--set', cfg.set, '--provider', cfg.provider, '--model', cfg.model, '--strategy', cfg.strategy, '--prompt', cfg.translatePrompt, '--chunk-tokens', String(cfg.chunkTokens), '--concurrency', String(cfg.concurrency), '--target', cfg.target, '--out', out];
}

/** Why the gate must not compare against gate.json, or undefined: scores of another judge are not comparable. */
export function judgeMismatch(gate: Pick<GateFile, 'judge'>, judge = PINNED_JUDGE): string | undefined {
  if (gate.judge.model === judge.model && gate.judge.prompt === judge.prompt && gate.judge.effort === judge.effort) return undefined;
  return `${GATE_FILE} was scored by ${judgeLabel(gate.judge)} but the pinned judge is ${judgeLabel(judge)}: re-baseline deliberately (eval/README.md) before gating`;
}

export function sampleSd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Baseline means, SDs and margins from the baseline runs' per-dimension judge means. */
export function computeDimensions(runs: readonly Record<Dimension, number>[], m2c400: Record<Dimension, number>): Record<Dimension, GateDimension> {
  return Object.fromEntries(
    DIMENSIONS.map((d) => {
      const xs = runs.map((r) => r[d]);
      const sd = sampleSd(xs);
      return [d, { baseline: xs.reduce((a, b) => a + b, 0) / xs.length, sd, margin: Math.max(2 * sd, MIN_MARGIN), m2c400: m2c400[d], runs: xs }];
    }),
  ) as Record<Dimension, GateDimension>;
}

/** The dimensions whose baseline mean is below the M2 c400 judge mean minus the margin. */
export function belowM2(dims: Record<Dimension, GateDimension>): Dimension[] {
  return DIMENSIONS.filter((d) => dims[d].baseline < dims[d].m2c400 - dims[d].margin);
}

/** What one translate-and-judge pass produced. Undefined fields: the pass stopped before writing them. */
export interface PassResult {
  dir: string;
  means: Partial<Record<Dimension, number>>;
  scored: number;
  passages: number;
  briefedChunks: number;
  revised: number;
  lost: number;
  translatable: number;
  translateUsd: number | null;
  judgeUsd: number | null;
  /** Who scored the pass (judge.json). */
  judge?: JudgeIdentity;
  wallMs: number;
  /** A timeout, the spend cap, or a harness/judge failure. */
  error?: string;
}

export interface DimensionRow {
  dimension: Dimension;
  baseline: number;
  margin: number;
  floor: number;
  score: number | undefined;
  ok: boolean;
}

export interface PassVerdict {
  ok: boolean;
  rows: DimensionRow[];
  reasons: string[];
  spendUsd: number;
}

export const passSpend = (p: Pick<PassResult, 'translateUsd' | 'judgeUsd'>): number => (p.translateUsd ?? 0) + (p.judgeUsd ?? 0);

/** What makes a pass unusable whatever its scores: it stopped, is incomplete, skipped the briefed path, lost segments or spent nothing. */
export function passProblems(p: PassResult, judge: JudgeIdentity): string[] {
  const reasons: string[] = [];
  if (p.error) reasons.push(p.error);
  if (p.passages === 0 || p.scored < p.passages) reasons.push(`judge scored ${p.scored}/${p.passages} passages`);
  if (p.judge !== undefined && judgeMismatch({ judge: p.judge }, judge)) reasons.push(`scored by ${judgeLabel(p.judge)}, not ${judgeLabel(judge)}`);
  if (p.briefedChunks === 0) reasons.push('no chunk carried the brief: the contextual path did not run');
  if (p.revised === 0) reasons.push('no segment was revised: the chunk-0 second pass did not run');
  if (p.lost > 0) reasons.push(`${p.lost}/${p.translatable} segments lost`);
  if (p.translateUsd === null || p.judgeUsd === null || passSpend(p) <= 0) reasons.push('no priced calls reported: a pass without real spend is not a result');
  return reasons;
}

/** A pass is green when it has no problem and no dimension fell below its floor. */
export function judgePass(gate: Pick<GateFile, 'dimensions' | 'judge'>, p: PassResult): PassVerdict {
  const rows = DIMENSIONS.map((d): DimensionRow => {
    const g = gate.dimensions[d];
    const floor = g.baseline - g.margin;
    const score = p.means[d];
    return { dimension: d, baseline: g.baseline, margin: g.margin, floor, score, ok: score !== undefined && score >= floor - 1e-9 };
  });
  const reasons = passProblems(p, gate.judge);
  for (const r of rows.filter((x) => !x.ok && x.score !== undefined)) reasons.push(`${r.dimension} ${r.score?.toFixed(2)} < floor ${r.floor.toFixed(2)} (baseline ${r.baseline.toFixed(2)} − margin ${r.margin.toFixed(2)})`);
  return { ok: reasons.length === 0, rows, reasons, spendUsd: passSpend(p) };
}

export interface GateOutcome {
  green: boolean;
  passes: { result: PassResult; verdict: PassVerdict }[];
  spendUsd: number;
}

/**
 * One pass, and once more if it fails (a judge or provider blip should not block a merge); red only when both
 * fail. The second pass gets what is left of the spend cap; none is run once the cap is spent.
 */
export async function runGate(gate: Pick<GateFile, 'dimensions' | 'judge'>, runPass: (attempt: number, budgetUsd: number) => Promise<PassResult>, log: (line: string) => void, capUsd = SPEND_CAP_USD): Promise<GateOutcome> {
  const passes: GateOutcome['passes'] = [];
  let spent = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const budget = capUsd - spent;
    if (budget <= 0) {
      log(`spend cap $${capUsd.toFixed(2)} reached: no further pass`);
      break;
    }
    const result = await runPass(attempt, budget);
    const verdict = judgePass(gate, result);
    spent += verdict.spendUsd;
    passes.push({ result, verdict });
    log(renderPass(attempt, result, verdict));
    if (verdict.ok) break;
  }
  const green = passes.some((p) => p.verdict.ok);
  log(`\neval gate ${green ? 'GREEN' : 'RED'}: ${passes.length} pass(es), spend $${spent.toFixed(4)} at nominal prices (APIBOX prices unverified, scripts/eval/pricing.ts)`);
  return { green, passes, spendUsd: spent };
}

const f2 = (n: number | undefined): string => (n === undefined ? '–' : n.toFixed(2));
const sgn = (n: number): string => (n >= 0 ? `+${n.toFixed(2)}` : `−${Math.abs(n).toFixed(2)}`);
const usd = (n: number | null): string => (n === null ? 'n/a' : `$${n.toFixed(4)}`);

/** The per-dimension table and the spend of a pass, printed whatever ended it. */
export function renderPass(attempt: number, p: PassResult, v: PassVerdict): string {
  return [
    '',
    `pass ${attempt}: ${v.ok ? 'GREEN' : 'RED'} (${p.dir}, ${(p.wallMs / 1000).toFixed(0)} s)`,
    '| dimension | baseline | margin | floor | score | vs baseline | |',
    '|---|---|---|---|---|---|---|',
    ...v.rows.map((r) => `| ${r.dimension} | ${f2(r.baseline)} | ${f2(r.margin)} | ${f2(r.floor)} | ${f2(r.score)} | ${r.score === undefined ? '–' : sgn(r.score - r.baseline)} | ${r.ok ? 'ok' : 'FAIL'} |`),
    `passages scored ${p.scored}/${p.passages}, briefed chunks ${p.briefedChunks}, revised segments ${p.revised}, lost ${p.lost}/${p.translatable}`,
    `spend: translate ${usd(p.translateUsd)} + judge ${usd(p.judgeUsd)} = $${v.spendUsd.toFixed(4)}`,
    ...v.reasons.map((r) => `- ${r}`),
  ].join('\n');
}

// ---- live passes (child processes: the harness and the judge, as `pnpm run eval` and `eval:judge` run them) ----

const ROOT = process.cwd();

interface Child {
  code: number | null;
  /** Set when the deadline or the budget killed it. */
  killed?: string;
}

/** Runs a node script, echoing its stdout; `onLine` may return a reason to stop it. */
function runScript(script: string, args: string[], deadline: number, onLine: (line: string) => string | undefined): Promise<Child> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    let killed: string | undefined;
    const stop = (why: string): void => {
      if (killed !== undefined) return;
      killed = why;
      child.kill('SIGTERM');
    };
    const timer = setTimeout(() => stop('timeout'), Math.max(0, deadline - Date.now()));
    let buf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        process.stdout.write(`  ${line}\n`);
        const why = onLine(line);
        if (why !== undefined) stop(why);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, ...(killed === undefined ? {} : { killed }) });
    });
  });
}

const readJson = <T>(file: string): T | undefined => (fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : undefined);

/** The cost the harness prints at the end of each passage line (`… 12.3s $0.00021`). */
export function lineCost(line: string): number {
  const m = /\scalls \d+ .*\s\$(\d+\.\d+)(?:\s|$)/.exec(line);
  return m ? Number(m[1]) : 0;
}

/** Summary fields the harness writes beyond RunSummary's. */
type GateSummary = Omit<RunSummary, 'total' | 'docs'> & { total: RunSummary['total'] & { revised?: number }; docs: (RunSummary['docs'][number] & { briefedChunks?: number })[] };

/** One translate-and-judge pass into `dir`, stopped at `deadline` or when its spend passes `budgetUsd`. `resume` keeps a finished translation. */
async function livePass(cfg: GateConfig, dir: string, deadline: number, budgetUsd: number, resume = false): Promise<PassResult> {
  const t0 = Date.now();
  const abs = path.resolve(ROOT, dir);
  let translateUsd = 0;
  let error: string | undefined;
  const summaryFile = path.join(abs, 'summary.json');
  if (!(resume && fs.existsSync(summaryFile))) {
    const tr = await runScript('scripts/eval.mjs', translateArgs(cfg, abs), deadline, (line) => {
      translateUsd += lineCost(line);
      return translateUsd > budgetUsd ? 'spend cap' : undefined;
    });
    if (tr.killed) error = tr.killed === 'timeout' ? `timed out while translating (${((deadline - t0) / 60000).toFixed(0)} min)` : `stopped at the spend cap while translating ($${translateUsd.toFixed(4)} > $${budgetUsd.toFixed(4)})`;
    else if (!fs.existsSync(summaryFile)) error = `the harness exited ${tr.code} without a summary`;
  }
  const summary = readJson<GateSummary>(summaryFile);
  if (summary?.total.costUsd !== undefined && summary.total.costUsd !== null) translateUsd = summary.total.costUsd;
  const judgeFile = path.join(abs, 'judge.json');
  // judge.ts rewrites judge.json after every passage: a read caught mid-write keeps the last cost seen.
  let lastJudgeCost = 0;
  const judgeCost = (): number => {
    try {
      lastJudgeCost = readJson<{ costUsd: number | null }>(judgeFile)?.costUsd ?? lastJudgeCost;
    } catch {
      // partial file
    }
    return lastJudgeCost;
  };
  if (error === undefined && summary !== undefined) {
    const jr = await runScript('scripts/eval-judge.mjs', [abs], deadline, () => (translateUsd + judgeCost() > budgetUsd ? 'spend cap' : undefined));
    if (jr.killed) error = jr.killed === 'timeout' ? `timed out while judging (${((deadline - t0) / 60000).toFixed(0)} min)` : `stopped at the spend cap while judging ($${(translateUsd + judgeCost()).toFixed(4)} > $${budgetUsd.toFixed(4)})`;
    else if (jr.code !== 0) error = `the judge exited ${jr.code}`;
  }
  const run = summary === undefined ? undefined : loadRun(abs);
  const judge = run?.judge;
  const means = judge ? dimensionMeans(judge.scores) : {};
  return {
    dir,
    means: Object.fromEntries(Object.entries(means).filter(([, v]) => v !== undefined)) as PassResult['means'],
    scored: judge ? Object.keys(judge.scores).length : 0,
    passages: run ? Object.keys(run.outputs).length : 0,
    briefedChunks: summary ? summary.docs.reduce((n, d) => n + (d.briefedChunks ?? 0), 0) : 0,
    revised: summary?.total.revised ?? 0,
    lost: summary?.total.lost ?? 0,
    translatable: summary?.total.translatable ?? 0,
    translateUsd: summary === undefined && translateUsd === 0 ? null : translateUsd,
    judgeUsd: judge ? judge.costUsd : null,
    ...(judge ? { judge: { model: judge.judgeModel, prompt: judge.prompt, effort: judge.reasoning?.effort ?? 'off' } } : {}),
    wallMs: Date.now() - t0,
    ...(error === undefined ? {} : { error }),
  };
}

function keyCheck(cfg: GateConfig): string | undefined {
  if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));
  const need = [PROVIDERS[cfg.provider]?.keyName, 'AIBOX_API_KEY'];
  const missing = [...new Set(need)].filter((k): k is string => k !== undefined && !process.env[k]);
  return missing.length ? `${missing.join(', ')} not set (.env or the environment): the gate needs live calls` : undefined;
}

/** `--baseline n`: n passes into eval/runs/gate-baseline-<i>/ (a finished one is kept), then eval/gate.json. */
async function baseline(cfg: GateConfig, n: number, timeoutMin: number): Promise<number> {
  const results: PassResult[] = [];
  for (let i = 1; i <= n; i++) {
    const dir = BASELINE_DIR(i);
    console.log(`\nbaseline run ${i}/${n} → ${dir}`);
    const r = await livePass(cfg, dir, Date.now() + timeoutMin * 60_000, SPEND_CAP_USD, true);
    const problems = passProblems(r, PINNED_JUDGE);
    console.log(`baseline run ${i}: ${DIMENSIONS.map((d) => `${d} ${f2(r.means[d])}`).join(', ')}; briefed chunks ${r.briefedChunks}, revised ${r.revised}; spend translate ${usd(r.translateUsd)} + judge ${usd(r.judgeUsd)}`);
    if (problems.length) {
      console.log(`baseline run ${i} is not usable:\n${problems.map((x) => `- ${x}`).join('\n')}\nFix the cause and run the same command again (finished runs are kept).`);
      return 1;
    }
    fs.rmSync(path.join(ROOT, dir, 'calls.jsonl'), { force: true });
    results.push(r);
  }
  const m2 = loadRun(path.join(ROOT, M2_C400_RUN)).judge;
  if (m2 === undefined || judgeMismatch({ judge: { model: m2.judgeModel, prompt: m2.prompt, effort: m2.reasoning?.effort ?? 'off' } })) throw new Error(`${M2_C400_RUN} has no judge.json from ${judgeLabel(PINNED_JUDGE)}`);
  const dims = computeDimensions(
    results.map((r) => r.means as Record<Dimension, number>),
    dimensionMeans(m2.scores) as Record<Dimension, number>,
  );
  console.log(['', '| dimension | runs | baseline | SD | margin | M2 c400 | M2 c400 − margin | |', '|---|---|---|---|---|---|---|---|', ...DIMENSIONS.map((d) => { const g = dims[d]; return `| ${d} | ${g.runs.map(f2).join(' ')} | ${f2(g.baseline)} | ${g.sd.toFixed(3)} | ${f2(g.margin)} | ${f2(g.m2c400)} | ${f2(g.m2c400 - g.margin)} | ${g.baseline < g.m2c400 - g.margin ? 'BELOW' : 'ok'} |`; })].join('\n'));
  console.log(`baseline spend $${results.reduce((a, r) => a + passSpend(r), 0).toFixed(4)} at nominal prices`);
  const below = belowM2(dims);
  if (below.length) {
    console.log(`\nHEAD is below the M2 c400 reference on ${below.join(', ')}: ${GATE_FILE} not written. Report it; do not re-baseline over a regression.`);
    return 3;
  }
  const file: GateFile = { judge: PINNED_JUDGE, config: cfg, marginRule: `max(2 × sample SD of the ${n} run means, ${MIN_MARGIN})`, dimensions: dims, baselineRuns: results.map((r) => r.dir), m2c400Run: M2_C400_RUN, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(ROOT, GATE_FILE), `${JSON.stringify(file, null, 1)}\n`);
  console.log(`\nwrote ${GATE_FILE}`);
  return 0;
}

/** Entry (scripts/eval-gate.mjs). Exit 0 green, 1 red, 2 refused before any call, 3 baseline below the M2 reference. */
export async function main(argv: string[]): Promise<number> {
  let opt: { baseline?: string | undefined; 'timeout-min': string };
  try {
    ({ values: opt } = parseArgs({
      args: argv.filter((a) => a !== '--'),
      options: { baseline: { type: 'string' }, 'timeout-min': { type: 'string', default: '25' } },
    }));
  } catch (e) {
    console.log(`eval gate refused: ${(e as Error).message}`);
    return 2;
  }
  const timeoutMin = Number(opt['timeout-min']);
  if (!(Number.isFinite(timeoutMin) && timeoutMin > 0)) {
    console.log(`eval gate refused: --timeout-min expects a number of minutes above 0, not "${opt['timeout-min']}"`);
    return 2;
  }
  const runs = opt.baseline === undefined ? undefined : Number(opt.baseline);
  if (runs !== undefined && !(Number.isInteger(runs) && runs >= MIN_BASELINE_RUNS)) {
    console.log(`eval gate refused: --baseline expects a whole number of runs, at least ${MIN_BASELINE_RUNS} (the margin needs a standard deviation), not "${opt.baseline}"`);
    return 2;
  }
  let cfg: GateConfig;
  try {
    cfg = shippedConfig();
  } catch (e) {
    console.log(`eval gate refused: ${(e as Error).message}`);
    return 2;
  }
  const noKey = keyCheck(cfg);
  if (noKey) {
    console.log(`eval gate refused: ${noKey}`);
    return 2;
  }
  console.log(`eval gate: ${cfg.provider}/${cfg.model}, ${cfg.strategy}@${cfg.strategyVersion} (${cfg.translatePrompt}), chunk ${cfg.chunkTokens}, ${cfg.concurrency} in flight, judge ${judgeLabel(PINNED_JUDGE)}`);
  if (runs !== undefined) return baseline(cfg, runs, timeoutMin);
  const gate = readJson<GateFile>(path.join(ROOT, GATE_FILE));
  if (gate === undefined) {
    console.log(`eval gate refused: no ${GATE_FILE} (run pnpm run eval:gate -- --baseline 5)`);
    return 2;
  }
  const mismatch = judgeMismatch(gate);
  if (mismatch) {
    console.log(`eval gate refused: ${mismatch}`);
    return 2;
  }
  const changed = (Object.keys(cfg) as (keyof GateConfig)[]).filter((k) => !isDeepStrictEqual(cfg[k], gate.config[k]));
  if (changed.length) console.log(`note: the shipped default differs from the baseline's on ${changed.join(', ')}; scores are compared with the baseline all the same`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outcome = await runGate(gate, (attempt, budget) => livePass(cfg, path.join('eval-results', `gate-${stamp}-pass${attempt}`), Date.now() + timeoutMin * 60_000, budget), (line) => console.log(line));
  return outcome.green ? 0 : 1;
}
