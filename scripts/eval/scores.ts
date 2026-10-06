// Scores (plan M2-E8): the human sheet is the source of truth, the judge's scores are checked against it.
// Parsers are lenient on purpose, like the rest of the project: a malformed line costs one score, not the run.
import { DIMENSIONS, type Dimension } from './rubric.ts';

export type Scores = Partial<Record<Dimension, number>>;
/** Scores by passage id. */
export type ScoreSet = Record<string, Scores>;

/** A number from 1 to 5, in halves, or undefined. Accepts "4", 4, "4/5", "4.5", "**4**". */
export function toScore(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v.replace(/[*_`]/g, '').trim()) : Number.NaN;
  if (!Number.isFinite(n) || n < 1 || n > 5) return undefined;
  return Math.round(n * 2) / 2;
}

const DIM_RE = DIMENSIONS.join('|');

/** A filled-in sheet line the parser could not use (not a number from 1 to 5). Empty lines are skips, not issues. */
export interface SheetIssue {
  id: string;
  dimension: Dimension;
  value: string;
}

/** `## <id>` sections holding lines like `fidelity: 4`. Anything else in the file is ignored; unusable values are listed in `issues`. */
export function readHumanSheet(md: string): { scores: ScoreSet; issues: SheetIssue[] } {
  const scores: ScoreSet = {};
  const issues: SheetIssue[] = [];
  let id: string | undefined;
  const line = new RegExp(`^\\s*(${DIM_RE})\\s*[:=]\\s*(.*)$`, 'i');
  for (const l of md.replace(/\r\n/g, '\n').split('\n')) {
    const h = /^##\s+(\S+)/.exec(l);
    if (h) {
      id = h[1] as string;
      scores[id] = {};
      continue;
    }
    const m = line.exec(l);
    if (!m || id === undefined) continue;
    const dimension = (m[1] as string).toLowerCase() as Dimension;
    const raw = (m[2] as string).trim();
    const s = toScore(/^\s*([0-9]+(?:\.[0-9]+)?)/.exec(raw)?.[1]);
    if (s !== undefined) (scores[id] as Scores)[dimension] = s;
    else if (raw !== '') issues.push({ id, dimension, value: raw });
  }
  return { scores, issues };
}

export const parseHumanSheet = (md: string): ScoreSet => readHumanSheet(md).scores;

export interface JudgeReply {
  scores: Scores;
  comment?: string;
}

/** The first balanced `{…}` in the text, string-aware; fences and chatter around it are ignored. */
function firstObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

/** Judge answer → scores. JSON first (fenced or bare), then `fidelity: 4` style lines; never throws. */
export function parseJudgeReply(text: string): JudgeReply {
  const scores: Scores = {};
  let comment: string | undefined;
  const obj = firstObject(text);
  if (obj) {
    try {
      const j = JSON.parse(obj) as Record<string, unknown>;
      const lower = Object.fromEntries(Object.entries(j).map(([k, v]) => [k.toLowerCase(), v]));
      for (const d of DIMENSIONS) {
        const v = lower[d];
        const s = toScore(typeof v === 'object' && v !== null ? (v as Record<string, unknown>).score : v);
        if (s !== undefined) scores[d] = s;
      }
      for (const k of ['comment', 'comments', 'reason', 'rationale', 'notes']) if (typeof lower[k] === 'string') comment ??= lower[k] as string;
    } catch {
      // fall through to the line scan
    }
  }
  for (const d of DIMENSIONS) {
    if (scores[d] !== undefined) continue;
    const m = new RegExp(`["*_\\s]${d}["*_]*\\s*[:=]\\s*["*_]*([0-9](?:\\.[0-9])?)`, 'i').exec(` ${text}`);
    const s = toScore(m?.[1]);
    if (s !== undefined) scores[d] = s;
  }
  return comment === undefined ? { scores } : { scores, comment };
}

export const mean = (xs: number[]): number | undefined => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

export interface Aggregate {
  /** Per dimension: mean and how many passages carry a score. */
  perDimension: Record<Dimension, { mean: number | undefined; n: number }>;
  /** Mean of all scores given. */
  overall: number | undefined;
}

/** `ids` limits the passages counted (all of them when absent). */
export function aggregate(set: ScoreSet, ids?: readonly string[]): Aggregate {
  const keys = ids ?? Object.keys(set);
  const perDimension = {} as Aggregate['perDimension'];
  const all: number[] = [];
  for (const d of DIMENSIONS) {
    const xs = keys.map((k) => set[k]?.[d]).filter((x): x is number => x !== undefined);
    perDimension[d] = { mean: mean(xs), n: xs.length };
    all.push(...xs);
  }
  return { perDimension, overall: mean(all) };
}

/** Judge vs human on the passages and dimensions both scored: mean absolute difference, signed bias, and how many pairs. */
export function agreement(judge: ScoreSet, human: ScoreSet): { pairs: number; mae: number | undefined; bias: number | undefined; within1: number | undefined } {
  const diffs: number[] = [];
  for (const id of Object.keys(human)) for (const d of DIMENSIONS) {
    const h = human[id]?.[d];
    const j = judge[id]?.[d];
    if (h !== undefined && j !== undefined) diffs.push(j - h);
  }
  return {
    pairs: diffs.length,
    mae: mean(diffs.map(Math.abs)),
    bias: mean(diffs),
    within1: diffs.length ? diffs.filter((x) => Math.abs(x) <= 1).length / diffs.length : undefined,
  };
}
