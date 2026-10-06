import { describe, expect, it } from 'vitest';
import { agreement, aggregate, parseHumanSheet, parseJudgeReply, toScore } from './scores';

describe('toScore', () => {
  it('reads numbers and strings in 1–5, rounds to halves, drops the rest', () => {
    expect([toScore(4), toScore('4/5'), toScore('**3.5**'), toScore('2.74'), toScore(0), toScore(6), toScore('x'), toScore(undefined)]).toEqual([4, 4, 3.5, 2.5, undefined, undefined, undefined, undefined]);
  });
});

describe('parseHumanSheet', () => {
  it('reads the filled lines of each section and ignores everything else', () => {
    const md = `# Sheet\nfidelity: 5\n\n## a-1\ncategory\nEN | tone: 2 in the text\nfidelity: 4\nNaturalness = 3\ntone:\nterminology: 6\nnotes: tone: 1\n\n## b-2\nFIDELITY: 5 (great)\ntone: 2.5\n`;
    expect(parseHumanSheet(md)).toEqual({ 'a-1': { fidelity: 4, naturalness: 3 }, 'b-2': { fidelity: 5, tone: 2.5 } });
  });
  it('copes with CRLF line ends', () => {
    expect(parseHumanSheet('## a\r\nfidelity: 3\r\n')).toEqual({ a: { fidelity: 3 } });
  });
});

describe('parseJudgeReply', () => {
  it('reads a bare JSON object', () => {
    expect(parseJudgeReply('{"fidelity": 4, "naturalness": 3, "tone": 5, "terminology": 4, "comment": "Fine."}')).toEqual({ scores: { fidelity: 4, naturalness: 3, tone: 5, terminology: 4 }, comment: 'Fine.' });
  });
  it('reads fenced JSON with chatter around it, odd case, string numbers and nested scores', () => {
    const r = parseJudgeReply('Sure! Here you go:\n```json\n{"Fidelity": "4", "naturalness": {"score": 3, "why": "x"}, "tone": 5.0, "terminology": "4/5", "reason": "has } brace"}\n```\nHope that helps {really}.');
    expect(r.scores).toEqual({ fidelity: 4, naturalness: 3, tone: 5, terminology: 4 });
    expect(r.comment).toBe('has } brace');
  });
  it('falls back to lines when the JSON is broken', () => {
    expect(parseJudgeReply('{"fidelity": 4, "tone": 3,\nnaturalness: 2\n**terminology**: 5').scores).toEqual({ fidelity: 4, tone: 3, naturalness: 2, terminology: 5 });
  });
  it('drops scores out of range and never throws on junk', () => {
    expect(parseJudgeReply('{"fidelity": 9, "tone": 0}').scores).toEqual({});
    expect(parseJudgeReply('').scores).toEqual({});
    expect(parseJudgeReply('{{{{').scores).toEqual({});
  });
});

describe('aggregate and agreement', () => {
  const human = { a: { fidelity: 4, tone: 2 }, b: { fidelity: 5 } };
  const judge = { a: { fidelity: 5, tone: 4, naturalness: 3 }, b: { fidelity: 5 }, c: { fidelity: 1 } };
  it('means per dimension with counts, and overall', () => {
    const a = aggregate(human);
    expect(a.perDimension.fidelity).toEqual({ mean: 4.5, n: 2 });
    expect(a.perDimension.naturalness).toEqual({ mean: undefined, n: 0 });
    expect(a.overall).toBeCloseTo(11 / 3);
    expect(aggregate(judge, ['a']).perDimension.fidelity.mean).toBe(5);
  });
  it('compares judge with human only where both scored', () => {
    const r = agreement(judge, human);
    expect(r.pairs).toBe(3);
    expect(r.mae).toBeCloseTo(1);
    expect(r.bias).toBeCloseTo(1);
    expect(r.within1).toBeCloseTo(2 / 3);
    expect(agreement({}, human).pairs).toBe(0);
  });
});
