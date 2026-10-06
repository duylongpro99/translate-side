// The comparison report (plan M2 §2): one column per run (strategy / prompt / model), so `contextual` and
// `translate@2` runs join the table later with no change here. The first run is the baseline: later columns show the change.
import { DIMENSIONS } from './rubric.ts';
import { agreement, aggregate, type Aggregate, type ScoreSet } from './scores.ts';
import { runLabel, type Run } from './runs.ts';

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

export function renderReport({ runs, categories }: ReportInput): string {
  const [first] = runs;
  if (first === undefined) throw new Error('no runs to compare');
  const baseCost = first.summary.total.costUsd;
  const head = ['| |', ...runs.map((r) => ` ${runLabel(r.summary)} |`)].join('');
  const rule = `|---|${runs.map(() => '---|').join('')}`;
  const judgeSets = runs.map((r) => r.judge?.scores);
  const lines: string[] = [
    '# Eval comparison',
    '',
    `Scores are 1–5 means over the passages scored (n). Columns after the first show the change from the first run (${runLabel(first.summary)}). Human scores are the source of truth; judge scores are shown for regression checks until calibrated.`,
    '',
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
    `| passages translated | ${runs.map((r) => Object.keys(r.outputs).length).join(' | ')} |`,
    `| segments lost after repair | ${runs.map((r) => `${r.summary.total.lost}/${r.summary.total.translatable}`).join(' | ')} |`,
    `| segments repaired | ${runs.map((r) => r.summary.total.repaired).join(' | ')} |`,
    `| LLM calls | ${runs.map((r) => r.summary.total.calls).join(' | ')} |`,
    `| input / output tokens | ${runs.map((r) => `${r.summary.total.input} / ${r.summary.total.output}`).join(' | ')} |`,
    `| translation cost | ${runs.map((r, i) => `${money(r.summary.total.costUsd)}${i > 0 && r.summary.total.costUsd !== null && baseCost ? ` (×${(r.summary.total.costUsd / baseCost).toFixed(2)})` : ''}`).join(' | ')} |`,
    `| wall time (s) | ${runs.map((r) => (r.summary.total.wallMs / 1000).toFixed(0)).join(' | ')} |`,
  ];
  if (runs.some((r) => r.judge)) lines.push(`| judge cost | ${runs.map((r) => (r.judge ? money(r.judge.costUsd) : '–')).join(' | ')} |`);

  const cats = [...new Set(Object.values(categories))].sort();
  if (cats.length) {
    for (const [name, sets] of [['human', runs.map((r) => r.human)], ['judge', judgeSets]] as const) {
      if (!sets.some(Boolean)) continue;
      lines.push('', `## ${name} overall by category`, '', head, rule);
      for (const c of cats) {
        const ids = Object.keys(categories).filter((id) => categories[id] === c);
        const aggs = sets.map((s) => (s ? aggregate(s, ids) : undefined));
        lines.push(`| ${c} (${ids.length}) | ${aggs.map((a, i) => cell(a?.overall, aggs[0]?.overall, i === 0)).join(' | ')} |`);
      }
    }
  }
  const unscored = runs.map((r) => (r.human && aggregate(r.human).overall !== undefined ? '' : `- ${runLabel(r.summary)}: no human scores yet (fill in ${r.dir}/human-scores.md)`)).filter(Boolean);
  if (unscored.length) lines.push('', ...unscored);
  for (const r of runs) {
    if (!r.humanIssues?.length) continue;
    lines.push('', `Warning: ${r.humanIssues.length} human score(s) in ${runLabel(r.summary)} were skipped (a score is a number from 1 to 5):`);
    for (const i of r.humanIssues) lines.push(`- ${i.id} ${i.dimension}: "${i.value}"`);
  }
  return `${lines.join('\n')}\n`;
}
