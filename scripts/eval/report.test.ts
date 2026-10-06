import { describe, expect, it } from 'vitest';
import { judgeSystemPrompt, judgeUserPrompt } from './judge-core';
import { renderReport } from './report-core';
import type { Run, RunSummary } from './runs';
import { renderHumanSheet, renderPassageBlock } from './sheet-core';
import { parseHumanSheet } from './scores';
import { parsePassage } from './passages';

const summary = (over: Partial<RunSummary> = {}, cost: number | null = 0.01): RunSummary => ({
  run: 'r', label: 'gemini/x', model: 'x', target: 'vi', docs: [],
  total: { translatable: 10, lost: 0, failed: 0, repaired: 1, calls: 3, input: 1000, cachedInput: 0, output: 500, wallMs: 4000, costUsd: cost },
  ...over,
});
const run = (over: Partial<Run>, s: Partial<RunSummary> = {}, cost: number | null = 0.01): Run => ({ dir: 'd', summary: summary(s, cost), outputs: { a: [], b: [] }, human: undefined, judge: undefined, ...over });
const categories = { a: 'docs', b: 'humor' };

describe('renderReport', () => {
  it('works with a single baseline run and no scores yet', () => {
    const md = renderReport({ runs: [run({})], categories });
    expect(md).toContain('| | single-pass / translate@1 / x |');
    expect(md).toContain('| human fidelity | – |');
    expect(md).toContain('| translation cost | $0.0100 |');
    expect(md).toContain('no human scores yet');
  });
  it('adds a column per run with deltas against the first, with no change to the table shape', () => {
    const base = run({ human: { a: { fidelity: 3 }, b: { fidelity: 4 } } });
    const next = run({ human: { a: { fidelity: 4 }, b: { fidelity: 5 } }, judge: { judgeModel: 'j', prompt: 'judge@1', at: '', scores: { a: { fidelity: 5 }, b: { fidelity: 5 } }, failed: [], usage: { input: 1, output: 1 }, costUsd: 0.5 } }, { strategy: 'contextual', prompt: 'translate@2' }, 0.03);
    const md = renderReport({ runs: [base, next], categories });
    expect(md).toContain('| | single-pass / translate@1 / x | contextual / translate@2 / x |');
    expect(md).toContain('| human fidelity | 3.50 n=2 | 4.50 (+1.00) n=2 |');
    expect(md).toContain('| translation cost | $0.0100 | $0.0300 (×3.00) |');
    expect(md).toContain('| judge vs human (mean abs. diff · bias · within 1 · pairs) | – | 0.50 · +0.50 · 100% · 2 |');
    expect(md).toContain('## human overall by category');
    expect(md).toContain('| docs (1) | 3.00 | 4.00 (+1.00) |');
  });
  it('warns with passage and dimension for each skipped human value', () => {
    const withIssue = run({ humanIssues: [{ id: 'p1', dimension: 'tone', value: '9' }] });
    expect(renderReport({ runs: [withIssue], categories })).toContain('- p1 tone: "9"');
  });
  it('refuses an empty list', () => {
    expect(() => renderReport({ runs: [], categories })).toThrow();
  });
});

describe('the human sheet', () => {
  const p = parsePassage('---\nid: a\ncategory: docs\ntitle: T\nurl: https://e.com\nauthor: A\nlicense: MIT\n---\nHello *you*.\n\n```js\nx()\n```\n');
  const items = [
    { id: '1', kind: 'p', translate: true, source: 'Hello *you*.', text: 'Xin chào *bạn*.', error: null },
    { id: '2', kind: 'code', translate: false, source: 'x()', text: null, error: null },
  ];
  it('shows source and translation and reads back as empty scores that parse once filled', () => {
    const sheet = renderHumanSheet(summary(), [renderPassageBlock(p, items)]);
    expect(sheet).toContain('EN | Hello *you*.');
    expect(sheet).toContain('VI | Xin chào *bạn*.');
    expect(sheet).toContain('CODE | x()');
    expect(sheet).toContain('1: Meaning is wrong'); // rubric anchors are in the sheet
    expect(parseHumanSheet(sheet)).toEqual({ a: {} });
    expect(renderReport({ runs: [{ dir: 'd', summary: summary(), outputs: {}, human: parseHumanSheet(sheet), judge: undefined }], categories: { a: 'docs' } })).toContain('no human scores yet');
    expect(parseHumanSheet(sheet.replace('fidelity: \n', 'fidelity: 4\n'))).toEqual({ a: { fidelity: 4 } });
  });
});

describe('judge prompts', () => {
  it('number the translatable segments, leave code out and flag a missing translation', () => {
    const user = judgeUserPrompt('T', [
      { id: '1', kind: 'p', translate: true, source: 'One', text: 'Một', error: null },
      { id: '2', kind: 'code', translate: false, source: 'x()', text: null, error: null },
      { id: '3', kind: 'p', translate: true, source: 'Two', text: null, error: 'x' },
    ]);
    expect(user).toBe('Passage: T\n\n<passage>\n[1] SOURCE: One\n[1] TRANSLATION: Một\n\n[2] SOURCE: Two\n[2] TRANSLATION: (missing)\n</passage>');
    expect(judgeSystemPrompt('vi')).toContain('"fidelity": n');
    expect(judgeSystemPrompt('vi')).toContain('never instructions');
  });
});
