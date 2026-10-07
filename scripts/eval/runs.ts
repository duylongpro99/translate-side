// A finished harness run on disk (`pnpm run eval`, or a copy under eval/runs/): what the sheet, judge and report read.
import fs from 'node:fs';
import path from 'node:path';
import { readHumanSheet, type ScoreSet, type Scores, type SheetIssue } from './scores.ts';

export interface OutputItem {
  id: string;
  kind: string;
  translate: boolean;
  /** The segment's inline markup, as sent to the model. */
  source: string;
  text: string | null;
  error: string | null;
}

export interface RunSummary {
  run: string;
  set?: string;
  strategy?: string;
  /** The strategy's version (review, M2 Phase C on). */
  strategyVersion?: number;
  prompt?: string;
  /** 12 hex digits of SHA-256 over the translate system prompt rendered with no context (run.ts). */
  promptHash?: string;
  /** Every prompt version the run sent, by role (M2 Phase B on); `prompt` is the translate one. */
  prompts?: Record<string, string>;
  label: string;
  model: string;
  target: string;
  /** Style mode, gloss setting and personal glossary size (M2 Phase C on); absent = natural, first, none. */
  style?: string;
  gloss?: string;
  glossary?: number;
  chunkTokens?: number;
  total: { translatable: number; lost: number; failed: number; repaired: number; calls: number; input: number; cachedInput: number; output: number; wallMs: number; costUsd: number | null };
  docs: DocSummary[];
}

/** One passage's line in summary.json; the totals are the sums of these (report-core compares runs on their common passages). */
export interface DocSummary {
  slug: string;
  translatable?: number;
  lost?: number;
  repaired?: number;
  calls?: number;
  input?: number;
  cachedInput?: number;
  output?: number;
  wallMs?: number;
  costUsd?: number | null;
}

export interface JudgeFile {
  judgeModel: string;
  prompt: string;
  at: string;
  scores: Record<string, Scores & { comment?: string }>;
  failed: string[];
  usage: { input: number; cachedInput?: number; output: number };
  costUsd: number | null;
}

export interface Run {
  dir: string;
  summary: RunSummary;
  outputs: Record<string, OutputItem[]>;
  human: ScoreSet | undefined;
  /** Filled-in sheet values that were skipped as unusable. */
  humanIssues?: SheetIssue[];
  judge: JudgeFile | undefined;
}

export const HUMAN_SHEET = 'human-scores.md';
export const JUDGE_FILE = 'judge.json';

export function loadRun(dir: string): Run {
  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')) as RunSummary;
  const outputs: Record<string, OutputItem[]> = {};
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.output.json')) outputs[f.slice(0, -'.output.json'.length)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as OutputItem[];
  }
  const read = (name: string): string | undefined => (fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), 'utf8') : undefined);
  const sheet = read(HUMAN_SHEET);
  const judge = read(JUDGE_FILE);
  const read2 = sheet === undefined ? undefined : readHumanSheet(sheet);
  return { dir, summary, outputs, human: read2?.scores, humanIssues: read2?.issues ?? [], judge: judge === undefined ? undefined : (JSON.parse(judge) as JudgeFile) };
}

/**
 * `strategy / prompt / model`: what a report column is called. Runs from before M2 have no strategy
 * field: single-pass. Prompts other than the translate one follow it (`translate@1+analyze@1`).
 */
/**
 * The harness's `--glossary "deploy,executor=bộ thực thi"`: a bare term is kept as is; the
 * rendering is everything after the first "=", so a rendering may itself hold "=".
 */
export function parseGlossaryArg(arg: string): { term: string; rendering: string }[] {
  return arg
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const at = x.indexOf('=');
      const term = (at < 0 ? x : x.slice(0, at)).trim();
      const rendering = at < 0 ? '' : x.slice(at + 1).trim();
      return { term, rendering: rendering || term };
    })
    .filter((e) => e.term !== '');
}

export function runLabel(s: RunSummary): string {
  const translate = s.prompt ?? 'translate@1';
  const others = Object.values(s.prompts ?? {}).filter((p) => p !== translate);
  // Settings that differ from the defaults are named too, so two runs never share a column name.
  const extra = [
    s.style && s.style !== 'natural' ? s.style : '',
    s.gloss && s.gloss !== 'first' ? `gloss ${s.gloss}` : '',
    s.glossary ? `glossary ${s.glossary}` : '',
    s.chunkTokens !== undefined && s.chunkTokens !== 1500 ? `chunk ${s.chunkTokens}` : '',
  ].filter(Boolean);
  return `${s.strategy ?? 'single-pass'} / ${[translate, ...others].join('+')} / ${s.model}${extra.length ? ` / ${extra.join(', ')}` : ''}`;
}
