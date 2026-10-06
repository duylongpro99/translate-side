// A finished harness run on disk (`pnpm run eval`, or a copy under eval/runs/): what the sheet, judge and report read.
import fs from 'node:fs';
import path from 'node:path';
import { parseHumanSheet, type ScoreSet, type Scores } from './scores.ts';

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
  prompt?: string;
  label: string;
  model: string;
  target: string;
  total: { translatable: number; lost: number; failed: number; repaired: number; calls: number; input: number; cachedInput: number; output: number; wallMs: number; costUsd: number | null };
  docs: { slug: string }[];
}

export interface JudgeFile {
  judgeModel: string;
  prompt: string;
  at: string;
  scores: Record<string, Scores & { comment?: string }>;
  failed: string[];
  usage: { input: number; output: number };
  costUsd: number | null;
}

export interface Run {
  dir: string;
  summary: RunSummary;
  outputs: Record<string, OutputItem[]>;
  human: ScoreSet | undefined;
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
  return { dir, summary, outputs, human: sheet === undefined ? undefined : parseHumanSheet(sheet), judge: judge === undefined ? undefined : (JSON.parse(judge) as JudgeFile) };
}

/** `strategy / prompt / model`: what a report column is called. Runs from before M2 have no strategy field: single-pass. */
export function runLabel(s: RunSummary): string {
  return `${s.strategy ?? 'single-pass'} / ${s.prompt ?? 'translate@1'} / ${s.model}`;
}
