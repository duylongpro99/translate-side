import { describe, expect, it } from 'vitest';
import { reviewInput, type EngineEvent, type ReviewReport, type Segment } from '@/engine/index';
import { newTally, rejectedKinds, revisedCount, tallyEvent } from './doc-tally';

const seg = (id: string, text: string): Segment => ({ id, kind: 'p', text, inlineMarkup: text, domPath: `p[${id}]`, translate: true });
const final = (id: string, text: string, revision: number, stage = 'translate'): EngineEvent => ({ type: 'segment.final', id, text, revision, producedBy: { strategy: 'refine', stage, model: 'm' } });
const chunk = (index: number, briefed: boolean, extra: { revise?: { kept: string[] }; review?: ReviewReport } = {}): EngineEvent => ({ type: 'chunk', index, briefed, ...extra });
const fold = (events: EngineEvent[]) => {
  const t = newTally();
  for (const e of events) tallyEvent(t, e);
  return t;
};

describe('tallyEvent', () => {
  it('counts briefed first-pass chunks only, never the revise or review reports that also say briefed', () => {
    const t = fold([
      chunk(0, false),
      chunk(1, true),
      chunk(0, true, { revise: { kept: ['s3'] } }),
      // Review chunks are cut from the whole job: index 0 here is not the brief-free draft chunk 0.
      chunk(0, true, { review: { ids: ['s1'], accepted: [], unchanged: ['s1'], rejected: [] } }),
      chunk(2, true, { review: { ids: ['s9'], accepted: [], unchanged: ['s9'], rejected: [] } }),
    ]);
    expect([...t.briefedChunks]).toEqual([1]);
    expect(t.reviseKept).toBe(1);
    expect(t.review.chunks).toBe(2);
  });
  it('counts a chunk-0 revision as revised even when a review replaced it, and a review alone as not', () => {
    const t = fold([
      final('s1', 'one', 1),
      final('s1', 'one, revised', 2, 'revise'),
      final('s1', 'one, reviewed', 3, 'review'),
      final('s2', 'two', 1),
      final('s2', 'two, reviewed', 3, 'review'),
      final('s3', 'three', 1),
      final('s3', 'three, revised', 2, 'revise'),
      final('s4', 'four', 1),
    ]);
    expect(revisedCount(t)).toBe(2);
    expect(t.finals.get('s1')).toEqual({ text: 'one, reviewed', attempt: 1, revision: 3, draft: 'one' });
    expect(t.finals.get('s2')).toEqual({ text: 'two, reviewed', attempt: 1, revision: 3, draft: 'two' });
    // A late revision 1 does not replace a higher revision: it becomes the draft.
    const late = fold([final('s5', 'five, reviewed', 3, 'review'), final('s5', 'five', 1)]);
    expect(late.finals.get('s5')).toEqual({ text: 'five, reviewed', attempt: 1, revision: 3, draft: 'five' });
  });
  it('sums the review reports by their ids, skipped reports as skipped, and the review tokens apart', () => {
    const t = fold([
      chunk(0, true, { review: { ids: ['s1', 's2', 's4'], accepted: ['s1', 's2'], unchanged: ['s4'], rejected: [] } }),
      chunk(1, true, { review: { ids: ['s5', 's6'], accepted: [], unchanged: ['s5'], rejected: ['s6'] } }),
      chunk(2, false, { review: { ids: ['s7', 's8'], accepted: [], unchanged: [], rejected: [], skipped: 'budget' } }),
      { type: 'usage', role: 'translate', model: 'm', input: 100, output: 50 },
      { type: 'usage', role: 'review', model: 'm', input: 30, output: 10, cachedInput: 5 },
      { type: 'usage', role: 'analyze', model: 'm', input: 7, output: 3 },
    ]);
    expect(t.review).toEqual({ chunks: 3, accepted: 2, unchanged: 2, rejected: 1, skipped: 2, input: 30, output: 10 });
    expect(t.reviewReports).toHaveLength(3);
    expect(t.usage).toEqual({ input: 137, cachedInput: 5, output: 63 });
    expect(t.analyzeUsage).toEqual({ input: 7, output: 3 });
  });
  it('lets a failure of the first pass stand only when no later revision exists', () => {
    const t = fold([final('s1', 'one', 2, 'revise'), { type: 'segment.failed', id: 's1', error: { kind: 'unknown', message: 'x' } }, { type: 'segment.failed', id: 's2', error: { kind: 'unknown', message: 'y' } }]);
    expect(t.finals.has('s1')).toBe(true);
    expect([...t.failed]).toEqual([['s2', 'unknown: y']]);
  });
});

describe('rejectedKinds', () => {
  const segments = [
    seg('s1', 'The deployment takes about 30 minutes on a fresh cluster with three nodes.'),
    seg('s2', 'Each pod gets its own IP address inside the cluster network.'),
    seg('s3', 'Use the <seg> element name only in prose.'),
    seg('s4', 'Containers in a pod share storage and network resources.'),
  ];
  const drafts = ['vi: triển khai mất khoảng 30 phút trên một cụm mới có ba nút.', 'vi: mỗi pod có địa chỉ IP riêng trong mạng của cụm.', 'vi: dùng tên phần tử <seg> chỉ trong văn xuôi.', 'vi: các container trong một pod dùng chung bộ nhớ và mạng.'];
  const user = reviewInput(segments.map((segment, i) => ({ n: i + 1, segment, draft: drafts[i] ?? '' })));
  const report: ReviewReport = { ids: ['s1', 's2', 's3', 's4'], accepted: [], unchanged: [], rejected: ['s1', 's2', 's3'] };
  it('reads the rejected candidates back from the matching call and names the failed checks', () => {
    // s1 changes a number; s2 is cut short; s3 brings a neutralised page tag back; s4 is not returned.
    const text = ['<seg id="1">vi: triển khai mất khoảng 40 phút trên một cụm mới có ba nút.</seg>', '<seg id="2">vi</seg>', '<seg id="3">vi: dùng tên phần tử ‹seg> chỉ trong văn xuôi, đã sửa.</seg>'].join('\n');
    const other = { user: reviewInput([{ n: 1, segment: seg('x', 'Something else entirely.'), draft: 'vi: khác' }]), text: '<none/>' };
    expect(rejectedKinds([report], [other, { user, text, stop: 'end' }], segments, 'vi')).toEqual({ number: 1, length: 1, tag: 1 });
  });
  it('says unknown when no call matches the report', () => {
    expect(rejectedKinds([report], [], segments, 'vi')).toEqual({ unknown: 3 });
    expect(rejectedKinds([{ ...report, rejected: [] }], [], segments, 'vi')).toEqual({});
  });
});
