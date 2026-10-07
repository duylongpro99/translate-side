// The comparison report (plan M2 §2): one column per run (strategy / prompt / model), so `contextual` and
// `translate@2` runs join the table later with no change here. The first run is the baseline: later columns show the change.
import { DIMENSIONS } from './rubric.ts';
import { agreement, aggregate, type Aggregate, type ScoreSet } from './scores.ts';
import { runLabel, type Run, type RunSummary } from './runs.ts';

export interface ReportInput {
  runs: Run[];
  /** Passage id → category, from eval/passages. */
  categories: Record<string, string>;
}

const f2 = (n: number | undefined): string => (n === undefined ? '–' : n.toFixed(2));
const sgn = (n: number): string => (n >= 0 ? `+${n.toFixed(2)}` : n.toFixed(2));
const money = (n: number | null | undefined): string => (n === null || n === undefined ? 'n/a' : `$${n.toFixed(4)}`);

/** `4.10 (+0.25)`: the value, and its difference from the first run's when both exist. */
function cell(value: number | undefined, base: number | undefined, first: boolean, n?: number): string {
  if (value === undefined) return '–';
  const delta = !first && base !== undefined ? ` (${sgn(value - base)})` : '';
  return `${f2(value)}${delta}${n === undefined ? '' : ` n=${n}`}`;
}

function scoreRows(title: string, sets: (ScoreSet | undefined)[]): string[] {
  const aggs: (Aggregate | undefined)[] = sets.map((s) => (s ? aggregate(s) : undefined));
  const rows = DIMENSIONS.map((d) => `| ${title} ${d} | ${aggs.map((a, i) => cell(a?.perDimension[d].mean, aggs[0]?.perDimension[d].mean, i === 0, a?.perDimension[d].n)).join(' | ')} |`);
  rows.push(`| **${title} overall** | ${aggs.map((a, i) => cell(a?.overall, aggs[0]?.overall, i === 0)).join(' | ')} |`);
  return rows;
}

type Totals = RunSummary['total'];

/** The passages a run translated: its summary's docs, or its output files for runs without them. */
export function passagesOf(r: Run): string[] {
  return r.summary.docs.length ? r.summary.docs.map((d) => d.slug) : Object.keys(r.outputs);
}

/** The passages every run translated, in the first run's order. */
export function commonPassages(runs: readonly Run[]): string[] {
  const [first, ...rest] = runs;
  if (first === undefined) return [];
  const others = rest.map((r) => new Set(passagesOf(r)));
  return passagesOf(first).filter((id) => others.every((s) => s.has(id)));
}

/** A run's totals over `ids`: its own totals when it translated exactly those, else the sum of their doc lines. */
export function totalsOn(r: Run, ids: readonly string[]): Totals {
  const own = passagesOf(r);
  if (own.length === ids.length && ids.every((id) => own.includes(id))) return r.summary.total;
  const want = new Set(ids);
  const docs = r.summary.docs.filter((d) => want.has(d.slug));
  const sum = (k: Exclude<keyof Totals, 'costUsd' | 'failed'>) => docs.reduce((n, d) => n + (d[k] ?? 0), 0);
  const costs = docs.map((d) => d.costUsd);
  return {
    translatable: sum('translatable'),
    lost: sum('lost'),
    failed: 0,
    repaired: sum('repaired'),
    calls: sum('calls'),
    input: sum('input'),
    cachedInput: sum('cachedInput'),
    output: sum('output'),
    wallMs: sum('wallMs'),
    costUsd: costs.some((c) => c === null || c === undefined) ? null : costs.reduce<number>((n, c) => n + (c ?? 0), 0),
  };
}

/** The scores of `ids` only. */
const pick = (set: ScoreSet | undefined, ids: readonly string[]): ScoreSet | undefined => (set === undefined ? undefined : Object.fromEntries(ids.filter((id) => id in set).map((id) => [id, set[id]])) as ScoreSet);

export function renderReport({ runs: all, categories }: ReportInput): string {
  const [first] = all;
  if (first === undefined) throw new Error('no runs to compare');
  // Runs over different passage sets are compared on the passages they all translated (review F2):
  // scores, segments, calls, tokens, cost and its ratio, wall time. The table says which runs cover more.
  const common = commonPassages(all);
  const counts = all.map((r) => passagesOf(r).length);
  const partial = counts.some((n) => n !== common.length);
  const runs = all.map((r) => (partial ? { ...r, human: pick(r.human, common), judge: r.judge && { ...r.judge, scores: pick(r.judge.scores, common) ?? {} } } : r));
  const totals = all.map((r) => totalsOn(r, common));
  const baseCost = totals[0]?.costUsd;
  const head = ['| |', ...runs.map((r) => ` ${runLabel(r.summary)} |`)].join('');
  const rule = `|---|${runs.map(() => '---|').join('')}`;
  const judgeSets = runs.map((r) => r.judge?.scores);
  const lines: string[] = [
    '# Eval comparison',
    '',
    `Scores are 1–5 means over the passages scored (n). Columns after the first show the change from the first run (${runLabel(first.summary)}). Human scores are the source of truth; judge scores are shown for regression checks until calibrated.`,
    '',
    ...(partial
      ? [
          `The runs cover different passages, so every row below is over the ${common.length} passages all of them translated: ${all.map((r, i) => `${runLabel(r.summary)} ${counts[i]}`).join(', ')}.`,
          '',
        ]
      : []),
    head,
    rule,
    ...scoreRows('human', runs.map((r) => r.human)),
    ...scoreRows('judge', judgeSets),
    `| judge vs human (mean abs. diff · bias · within 1 · pairs) | ${runs
      .map((r) => {
        const a = r.judge && r.human ? agreement(r.judge.scores, r.human) : undefined;
        return a && a.pairs ? `${f2(a.mae)} · ${a.bias === undefined ? '–' : sgn(a.bias)} · ${a.within1 === undefined ? '–' : `${Math.round(a.within1 * 100)}%`} · ${a.pairs}` : '–';
      })
      .join(' | ')} |`,
    `| judge model | ${runs.map((r) => (r.judge ? `${r.judge.judgeModel} (${r.judge.prompt})` : '–')).join(' | ')} |`,
    `| passages translated | ${counts.map((n) => (partial ? `${n}, ${common.length} compared${n > common.length ? '' : ' (fewer)'}` : `${n}`)).join(' | ')} |`,
    `| segments lost after repair | ${totals.map((t) => `${t.lost}/${t.translatable}`).join(' | ')} |`,
    `| segments repaired | ${totals.map((t) => t.repaired).join(' | ')} |`,
    `| LLM calls | ${totals.map((t) => t.calls).join(' | ')} |`,
    `| input / output tokens | ${totals.map((t) => `${t.input} / ${t.output}`).join(' | ')} |`,
    `| translation cost | ${totals.map((t, i) => `${money(t.costUsd)}${i > 0 && t.costUsd !== null && baseCost ? ` (×${(t.costUsd / baseCost).toFixed(2)})` : ''}`).join(' | ')} |`,
    `| wall time (s) | ${totals.map((t) => (t.wallMs / 1000).toFixed(0)).join(' | ')} |`,
  ];
  if (runs.some((r) => r.judge)) lines.push(`| judge cost${partial ? ' (whole run)' : ''} | ${runs.map((r) => (r.judge ? money(r.judge.costUsd) : '–')).join(' | ')} |`);

  const cats = [...new Set(Object.values(categories))].sort();
  if (cats.length) {
    for (const [name, sets] of [['human', runs.map((r) => r.human)], ['judge', judgeSets]] as const) {
      if (!sets.some(Boolean)) continue;
      lines.push('', `## ${name} overall by category`, '', head, rule);
      for (const c of cats) {
        const ids = Object.keys(categories).filter((id) => categories[id] === c && (!partial || common.includes(id)));
        if (ids.length === 0) continue;
        const aggs = sets.map((s) => (s ? aggregate(s, ids) : undefined));
        lines.push(`| ${c} (${ids.length}) | ${aggs.map((a, i) => cell(a?.overall, aggs[0]?.overall, i === 0)).join(' | ')} |`);
      }
    }
  }
  const unscored = all.map((r) => (r.human && aggregate(r.human).overall !== undefined ? '' : `- ${runLabel(r.summary)}: no human scores yet (fill in ${r.dir}/human-scores.md)`)).filter(Boolean);
  if (unscored.length) lines.push('', ...unscored);
  for (const r of runs) {
    if (!r.humanIssues?.length) continue;
    lines.push('', `Warning: ${r.humanIssues.length} human score(s) in ${runLabel(r.summary)} were skipped (a score is a number from 1 to 5):`);
    for (const i of r.humanIssues) lines.push(`- ${i.id} ${i.dimension}: "${i.value}"`);
  }
  return `${lines.join('\n')}\n`;
}
