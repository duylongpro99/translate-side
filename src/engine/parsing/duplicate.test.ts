import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../../llm/types.ts';
import { fakeClient } from '../testing.ts';
import type { EngineEvent, Segment } from '../types.ts';
import { COPY_MIN_WORDS, COPY_SIMILARITY, DIFFERENT_SOURCE_SIMILARITY, copiesNeighbour, similarity } from './duplicate.ts';
import { translateChunk, type ChunkCall, type ChunkReport } from './translate-chunk.ts';
import { toWire } from './wire.ts';

const segment = (id: string, markup: string): Segment => ({ id, kind: 'p', text: markup, inlineMarkup: markup, domPath: `p[${id}]`, translate: true });
const answer = (text: string): NormalizedEvent[] => [{ type: 'text', delta: text }, { type: 'usage', input: 100, output: 50 }, { type: 'done', stopReason: 'end' }];

// rust-book-ownership at 400 tokens (M2 round 11, judge round 13): chunk 1's only segment (the
// stack/heap paragraph) came back as a re-translation of the context tail's paragraph.
const TAIL_SOURCE = 'Because ownership is a new concept for many programmers, it does take some time to get used to. The good news is that the more experienced you become with Rust and the rules of the ownership system, the easier you’ll find it to naturally develop code that is safe and efficient. Keep at it!';
const TAIL_TRANSLATION = 'Vì sở hữu là một khái niệm mới đối với nhiều lập trình viên, nên cần có thời gian để làm quen. Tin tốt là càng có kinh nghiệm với Rust và các quy tắc của hệ thống sở hữu, bạn sẽ càng dễ dàng viết ra mã nguồn an toàn và hiệu quả một cách tự nhiên hơn. Hãy kiên trì nhé!';
const STACK_SOURCE = 'Both the stack and the heap are parts of memory available to your code to use at runtime, but they are structured in different ways. The stack stores values in the order it gets them and removes the values in the opposite order.';
const COPY = 'Vì quyền sở hữu là một khái niệm mới đối với nhiều lập trình viên, nên bạn cần có thời gian để làm quen. Tin vui là càng có kinh nghiệm với Rust và các quy tắc của hệ thống quyền sở hữu, bạn càng dễ dàng viết ra những đoạn mã an toàn và hiệu quả một cách tự nhiên. Cứ kiên trì nhé!';
const STACK_TRANSLATION = 'Cả ngăn xếp và bộ nhớ heap đều là những phần bộ nhớ mà mã của bạn có thể dùng khi chạy, nhưng chúng được tổ chức theo những cách khác nhau. Ngăn xếp lưu giá trị theo thứ tự nhận được và xóa chúng theo thứ tự ngược lại.';

describe('the copied-neighbour guard (round 13)', () => {
  it('flags the live copy: same translation, different source', () => {
    expect(similarity(COPY, TAIL_TRANSLATION)).toBeGreaterThanOrEqual(COPY_SIMILARITY);
    expect(copiesNeighbour(STACK_SOURCE, COPY, [{ source: TAIL_SOURCE, translation: TAIL_TRANSLATION }])).toBe(true);
    expect(copiesNeighbour(STACK_SOURCE, STACK_TRANSLATION, [{ source: TAIL_SOURCE, translation: TAIL_TRANSLATION }])).toBe(false);
  });

  it('lets repeated source text repeat, and short translations (headings, labels) repeat', () => {
    expect(copiesNeighbour(TAIL_SOURCE, COPY, [{ source: TAIL_SOURCE, translation: TAIL_TRANSLATION }])).toBe(false);
    expect(copiesNeighbour('Example', 'Ví dụ', [{ source: 'Specification', translation: 'Ví dụ' }])).toBe(false);
    expect(similarity('a', 'a')).toBe(0);
  });

  it('re-requests a segment that copies the tail, and accepts the repair (the stage passes the tail as neighbours)', async () => {
    const client = fakeClient([answer(`<seg id="1">${COPY}</seg>`), answer(`<seg id="1">${STACK_TRANSLATION}</seg>`)]);
    const call: ChunkCall = () => client.stream({ model: client.model, system: '', messages: [], maxOutputTokens: 100, signal: new AbortController().signal });
    const events: EngineEvent[] = [];
    const gen = translateChunk(toWire([segment('s', STACK_SOURCE)]), call, { producedBy: { strategy: 'contextual', stage: 'translate', model: 'fake-model' }, revision: 1, role: 'translate', neighbours: [{ source: TAIL_SOURCE, translation: TAIL_TRANSLATION }] });
    let report: ChunkReport | undefined;
    for (;;) {
      const r = await gen.next();
      if (r.done === true) {
        report = r.value;
        break;
      }
      events.push(r.value);
    }
    expect(client.requests).toHaveLength(2);
    expect(report.first.copied).toEqual([1]);
    expect(events.filter((e) => e.type === 'segment.final')).toEqual([expect.objectContaining({ id: 's', text: STACK_TRANSLATION, attempt: 2 })]);
  });

  it('within one call: a later segment that copies an earlier one is re-requested', async () => {
    const other = 'The heap is less organized: when you put data on the heap, you request a certain amount of space from the memory allocator.';
    const client = fakeClient([answer(`<seg id="1">${STACK_TRANSLATION}</seg>\n<seg id="2">${STACK_TRANSLATION}</seg>`), answer('<seg id="2">Bộ nhớ heap kém ngăn nắp hơn: khi đặt dữ liệu lên heap, bạn xin một lượng chỗ nhất định.</seg>')]);
    const call: ChunkCall = () => client.stream({ model: client.model, system: '', messages: [], maxOutputTokens: 100, signal: new AbortController().signal });
    const gen = translateChunk(toWire([segment('a', STACK_SOURCE), segment('b', other)]), call, { producedBy: { strategy: 'single-pass', stage: 'translate', model: 'fake-model' }, revision: 1, role: 'translate', neighbours: [] });
    const finals: [string, number][] = [];
    for (;;) {
      const r = await gen.next();
      if (r.done === true) break;
      if (r.value.type === 'segment.final') finals.push([r.value.id, r.value.attempt ?? 1]);
    }
    expect(finals).toEqual([['a', 1], ['b', 2]]);
  });

  it('without `neighbours` the guard is off: a copy within the call is accepted (single-pass, translate@1)', async () => {
    const other = 'The heap is less organized: when you put data on the heap, you request a certain amount of space from the memory allocator.';
    const client = fakeClient([answer(`<seg id="1">${STACK_TRANSLATION}</seg>\n<seg id="2">${STACK_TRANSLATION}</seg>`)]);
    const call: ChunkCall = () => client.stream({ model: client.model, system: '', messages: [], maxOutputTokens: 100, signal: new AbortController().signal });
    const gen = translateChunk(toWire([segment('a', STACK_SOURCE), segment('b', other)]), call, { producedBy: { strategy: 'single-pass', stage: 'translate', model: 'fake-model' }, revision: 1, role: 'translate' });
    const finals: [string, number][] = [];
    for (;;) {
      const r = await gen.next();
      if (r.done === true) {
        expect(r.value.first.copied).toBeUndefined();
        break;
      }
      if (r.value.type === 'segment.final') finals.push([r.value.id, r.value.attempt ?? 1]);
    }
    expect(client.requests).toHaveLength(1);
    expect(finals).toEqual([['a', 1], ['b', 1]]);
  });
});

// Boundaries (round 14, NB4). `run(prefix, n)` is n distinct words; `sharing(x)` is a 21-word
// text (20 bigrams) whose first x bigrams are those of `T`, so its Dice similarity to `T` is x/20.
const run = (prefix: string, n: number, from = 0): string[] => Array.from({ length: n }, (_, i) => `${prefix}${from + i}`);
const T = run('t', 21).join(' ');
const sharing = (x: number, prefix = 'u'): string => [...run('t', x + 1), ...run(prefix, 20 - x)].join(' ');
const S = run('s', 21).join(' ');
const sourceSharing = (x: number): string => [...run('s', x + 1), ...run('v', 20 - x)].join(' ');

describe('the copied-neighbour guard: boundaries (round 14)', () => {
  it('builds the similarities it means to', () => {
    expect([12, 11].map((x) => similarity(T, sharing(x)))).toEqual([0.6, 0.55]);
    expect([6, 5].map((x) => similarity(S, sourceSharing(x)))).toEqual([0.3, 0.25]);
    expect(similarity(S, T)).toBe(0);
  });

  it(`length floor: ${COPY_MIN_WORDS - 1} words may repeat, ${COPY_MIN_WORDS} may not`, () => {
    const short = run('w', COPY_MIN_WORDS - 1).join(' ');
    const long = run('w', COPY_MIN_WORDS).join(' ');
    expect(copiesNeighbour(S, short, [{ source: T, translation: short }])).toBe(false);
    expect(copiesNeighbour(S, long, [{ source: T, translation: long }])).toBe(true);
  });

  it(`translation similarity: a copy at ${COPY_SIMILARITY}, not just under it`, () => {
    expect(copiesNeighbour(S, sharing(12), [{ source: T, translation: T }])).toBe(true);
    expect(copiesNeighbour(S, sharing(11), [{ source: T, translation: T }])).toBe(false);
    expect(copiesNeighbour(S, sharing(13), [{ source: T, translation: T }])).toBe(true);
  });

  it(`source similarity: a different passage just under ${DIFFERENT_SOURCE_SIMILARITY}, the same one at it`, () => {
    expect(copiesNeighbour(sourceSharing(5), T, [{ source: S, translation: T }])).toBe(true);
    expect(copiesNeighbour(sourceSharing(6), T, [{ source: S, translation: T }])).toBe(false);
    expect(copiesNeighbour(sourceSharing(7), T, [{ source: S, translation: T }])).toBe(false);
  });
});
