import { describe, expect, it } from 'vitest';
import type { NormalizedEvent, StopReason } from '../../llm/types.ts';
import { fakeClient } from '../testing.ts';
import type { EngineEvent, Segment } from '../types.ts';
import { UNREADABLE_MESSAGE, translateChunk, type ChunkCall, type ChunkReport } from './translate-chunk.ts';
import { toWire, type WireChunk } from './wire.ts';

const producedBy = { strategy: 'single-pass', stage: 'translate', model: 'fake-model' };
const options = { producedBy, revision: 1, role: 'translate' as const };

export function segment(id: string, markup: string): Segment {
  return { id, kind: 'p', text: markup, inlineMarkup: markup, domPath: `p[${id}]`, translate: true };
}

export const answer = (text: string, stopReason: StopReason = 'end', chunkSize = 5): NormalizedEvent[] => {
  const out: NormalizedEvent[] = [];
  for (let i = 0; i < text.length; i += chunkSize) out.push({ type: 'text', delta: text.slice(i, i + chunkSize) });
  out.push({ type: 'usage', input: 100, output: 50 }, { type: 'done', stopReason });
  return out;
};

/** Plays `attempts[i]` on the i-th call, through the scripted fake client (one attempt per call). */
function scripted(attempts: NormalizedEvent[][]): { call: ChunkCall; sent: WireChunk[] } {
  const client = fakeClient(attempts);
  const sent: WireChunk[] = [];
  const call: ChunkCall = (chunk) => {
    sent.push(chunk);
    return client.stream({ model: client.model, system: '', messages: [], maxOutputTokens: 100, signal: new AbortController().signal });
  };
  return { call, sent };
}

async function run(chunk: WireChunk, call: ChunkCall): Promise<{ events: EngineEvent[]; report: ChunkReport }> {
  const events: EngineEvent[] = [];
  const gen = translateChunk(chunk, call, options);
  for (;;) {
    const r = await gen.next();
    if (r.done === true) return { events, report: r.value };
    events.push(r.value);
  }
}

const finals = (events: EngineEvent[]) => events.flatMap((e) => (e.type === 'segment.final' ? [[e.id, e.text, e.attempt ?? 1] as const] : []));
const failedIds = (events: EngineEvent[]) => events.flatMap((e) => (e.type === 'segment.failed' ? [e.id] : []));

const chunk3 = toWire([segment('a', 'One.'), segment('b', 'Two.'), segment('c', 'Three.')]);

describe('translateChunk', () => {
  it('streams partials and finals for a clean answer, one call, usage passed on', async () => {
    const { call, sent } = scripted([answer('<seg id="1">Một.</seg>\n<seg id="2">Hai.</seg>\n<seg id="3"> Ba. </seg>')]);
    const { events, report } = await run(chunk3, call);
    expect(sent).toHaveLength(1);
    expect(finals(events)).toEqual([['a', 'Một.', 1], ['b', 'Hai.', 1], ['c', 'Ba.', 1]]);
    expect(events.filter((e) => e.type === 'segment.partial').at(-1)).toEqual({ type: 'segment.partial', id: 'c', text: ' Ba. ' });
    expect(events.filter((e) => e.type === 'usage')).toEqual([{ type: 'usage', role: 'translate', model: 'fake-model', input: 100, output: 50 }]);
    expect(report.repair).toBeUndefined();
    expect(report.failed).toEqual([]);
    // A final comes right after the segment closes, before later segments stream.
    const order = events.filter((e) => e.type !== 'usage').map((e) => `${e.type}:${'id' in e ? e.id : ''}`);
    expect(order.indexOf('segment.final:a')).toBeLessThan(order.indexOf('segment.partial:b'));
  });

  it('max_tokens cut: re-requests the cut segment and the rest in one call, with their original ids', async () => {
    const { call, sent } = scripted([answer('<seg id="1">Một.</seg><seg id="2">Ha', 'max_tokens'), answer('<seg id="2">Hai.</seg><seg id="3">Ba.</seg>')]);
    const { events, report } = await run(chunk3, call);
    expect(sent.map((c) => c.segments.map((e) => e.n))).toEqual([[1, 2, 3], [2, 3]]);
    expect(finals(events)).toEqual([['a', 'Một.', 1], ['b', 'Hai.', 2], ['c', 'Ba.', 2]]);
    expect(report.first.plan.rerequest).toEqual([2, 3]);
    expect(report.failed).toEqual([]);
    expect(events.filter((e) => e.type === 'usage')).toHaveLength(2);
  });

  it('ambiguous output: the whole chunk again; finals already shown are replaced with attempt 2', async () => {
    const { call, sent } = scripted([
      answer('<seg id="1">Một.</seg><seg id="1">X</seg><seg id="2">Hai.</seg><seg id="3">Ba.</seg>'),
      answer('<seg id="1">Một!</seg><seg id="2">Hai!</seg><seg id="3">Ba!</seg>'),
    ]);
    const { events } = await run(chunk3, call);
    expect(sent[1]?.segments.map((e) => e.n)).toEqual([1, 2, 3]);
    expect(finals(events).filter(([, , a]) => a === 2)).toEqual([['a', 'Một!', 2], ['b', 'Hai!', 2], ['c', 'Ba!', 2]]);
    // No partial preview over text already shown as final.
    const second = events.slice(events.findIndex((e) => e.type === 'usage') + 1);
    expect(second.some((e) => e.type === 'segment.partial')).toBe(false);
  });

  it('a segment still bad after the repair fails; good ones are kept', async () => {
    const { call } = scripted([answer('<seg id="1">Một.</seg><seg id="2"></seg>'), answer('<seg id="2"> </seg><seg id="3">Ba.</seg>')]);
    const { events, report } = await run(chunk3, call);
    expect(finals(events)).toEqual([['a', 'Một.', 1], ['b', '', 1], ['c', 'Ba.', 2]]);
    expect(failedIds(events)).toEqual(['b']);
    const failed = events.find((e) => e.type === 'segment.failed');
    expect(failed?.type === 'segment.failed' && failed.error.message).toBe(UNREADABLE_MESSAGE);
    expect(report.failed).toEqual(['b']);
  });

  it('a stream error fails the segments with no accepted text, with that error, and makes no repair call', async () => {
    const error = { kind: 'auth' as const, status: 401, message: 'bad key' };
    const { call, sent } = scripted([[{ type: 'text', delta: '<seg id="1">Một.</seg><seg id="2">Ha' }, { type: 'error', error }]]);
    const { events } = await run(chunk3, call);
    expect(sent).toHaveLength(1);
    expect(finals(events)).toEqual([['a', 'Một.', 1]]);
    expect(events.filter((e) => e.type === 'segment.failed')).toEqual([
      { type: 'segment.failed', id: 'b', error },
      { type: 'segment.failed', id: 'c', error },
    ]);
  });

  it('a repair call error fails what it should have repaired, with that error', async () => {
    const error = { kind: 'overloaded' as const, message: 'busy' };
    const { call } = scripted([answer('<seg id="1">Một.</seg>'), [{ type: 'error', error }]]);
    const { events } = await run(chunk3, call);
    expect(events.filter((e) => e.type === 'segment.failed')).toEqual([
      { type: 'segment.failed', id: 'b', error },
      { type: 'segment.failed', id: 'c', error },
    ]);
  });

  it('literal tags in the source: v2 with a nonce, and the echoed text parses right', async () => {
    const chunk = toWire([segment('a', 'Type <seg id="2"> and </seg> here.'), segment('b', 'Two.')]);
    expect(chunk.grammar).toBe('v2');
    const n = chunk.nonce ?? '';
    const { call } = scripted([answer(`<seg id="1" n="${n}">Gõ <seg id="2"> và </seg> ở đây.</seg>\n<seg id="2" n="${n}">Hai.</seg>`)]);
    const { events, report } = await run(chunk, call);
    expect(finals(events)).toEqual([['a', 'Gõ <seg id="2"> và </seg> ở đây.', 1], ['b', 'Hai.', 1]]);
    expect(report.first.plan.rerequest).toEqual([]);
  });

  it('propagates an abort as a throw', async () => {
    const controller = new AbortController();
    const client = fakeClient([answer('<seg id="1">Một.</seg><seg id="2">Hai.</seg><seg id="3">Ba.</seg>', 'end', 2)]);
    const call: ChunkCall = () => client.stream({ model: 'm', system: '', messages: [], maxOutputTokens: 1, signal: controller.signal });
    const gen = translateChunk(chunk3, call, options);
    await gen.next();
    controller.abort(new Error('cancelled'));
    await expect(gen.next()).rejects.toThrow('cancelled');
  });
});
