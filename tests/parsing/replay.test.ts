// Replay of the S2 model outputs (spikes/s2/runs, gpt-oss:20b) through the engine's chunk path
// (plan M1 criterion 3, parser/repair side): every recorded first-pass answer goes through
// translateChunk with the option-C grammar, and where S2 recorded a repair answer, that answer is
// the follow-up call. Counts the segments re-requested and lost after the one repair round.
// Escaped-source arms are skipped: the engine sends the source unescaped (S2).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent, StopReason } from '@/llm/types';
import type { EngineEvent, Segment } from '@/engine/types';
import { toWire, translateChunk, type ChunkCall, type WireSegment } from '@/engine/index';

const S2 = path.resolve(import.meta.dirname, '../../spikes/s2');
const RUNS = path.join(S2, 'runs');

interface SourceChunk {
  id: string;
  segs: { id: number; kind: string; text: string }[];
}
interface Row {
  chunk: string;
  status: number;
  finish: string;
  escape: boolean;
  content: string;
}

const readJson = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(S2, f), 'utf8')) as T;
const readRows = (f: string): Row[] =>
  fs
    .readFileSync(path.join(RUNS, f), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row)
    .filter((r) => r.status === 200);
const SOURCES = new Map([...readJson<SourceChunk[]>('chunks.json'), ...readJson<SourceChunk[]>('adversarial.json'), ...readJson<SourceChunk[]>('chunks-large.json')].map((c) => [c.id, c]));
const stop = (finish: string): StopReason => (finish === 'length' ? 'max_tokens' : finish === 'stop' ? 'end' : 'other');
const answer = (content: string, finish: string): NormalizedEvent[] => [
  ...Array.from({ length: Math.ceil(content.length / 7) }, (_, i): NormalizedEvent => ({ type: 'text', delta: content.slice(i * 7, i * 7 + 7) })),
  { type: 'done', stopReason: stop(finish) },
];
async function* play(events: NormalizedEvent[]): AsyncGenerator<NormalizedEvent> {
  for (const e of events) yield e;
}

const ARMS = fs
  .readdirSync(RUNS)
  .filter((f) => f.endsWith('.jsonl') && !f.includes('.repair'))
  .map((f) => f.replace(/\.jsonl$/, ''))
  .sort();

interface ArmStats {
  chunks: number;
  segments: number;
  rerequested: number;
  repairCalls: number;
  lost: number;
  noRepairRecorded: number;
}

async function replayArm(arm: string): Promise<ArmStats> {
  const repairFile = `${arm}.repair-plain.jsonl`;
  const repairs = fs.existsSync(path.join(RUNS, repairFile)) ? new Map(readRows(repairFile).map((r) => [r.chunk, r])) : new Map<string, Row>();
  const stats: ArmStats = { chunks: 0, segments: 0, rerequested: 0, repairCalls: 0, lost: 0, noRepairRecorded: 0 };
  for (const row of readRows(`${arm}.jsonl`)) {
    if (row.escape) continue;
    const source = SOURCES.get(row.chunk);
    if (source === undefined) throw new Error(`${arm}: unknown chunk ${row.chunk}`);
    const entries: WireSegment[] = source.segs.map((s) => {
      const segment: Segment = { id: `${row.chunk}/${s.id}`, kind: 'p', text: s.text, inlineMarkup: s.text, domPath: `p[${s.id}]`, translate: true };
      return { n: s.id, segment };
    });
    const repair = repairs.get(row.chunk);
    let calls = 0;
    const call: ChunkCall = (_chunk, attempt) => {
      calls++;
      if (attempt === 1) return play(answer(row.content, row.finish));
      // No recorded repair: an empty answer, so whatever was re-requested counts as lost.
      return play(repair === undefined ? answer('', 'stop') : answer(repair.content, repair.finish));
    };
    const failed: string[] = [];
    const gen = translateChunk(toWire(entries), call, { producedBy: { strategy: 'replay', stage: 'translate', model: 'gpt-oss:20b' }, revision: 1, role: 'translate' });
    let report;
    for (;;) {
      const r = await gen.next();
      if (r.done === true) {
        report = r.value;
        break;
      }
      const e: EngineEvent = r.value;
      if (e.type === 'segment.failed') failed.push(e.id);
    }
    stats.chunks++;
    stats.segments += entries.length;
    stats.rerequested += report.first.plan.rerequest.length;
    if (calls > 1) {
      stats.repairCalls++;
      if (repair === undefined) stats.noRepairRecorded++;
    }
    stats.lost += failed.length;
  }
  return stats;
}

describe('S2 replay (recorded gpt-oss:20b outputs through translateChunk)', () => {
  it('loses no segment after one repair round', async () => {
    const all: Record<string, ArmStats> = {};
    for (const arm of ARMS) all[arm] = await replayArm(arm);
    console.log(`S2 replay: ${JSON.stringify(all)}`);
    const total = Object.values(all).reduce(
      (t, s) => ({ chunks: t.chunks + s.chunks, segments: t.segments + s.segments, rerequested: t.rerequested + s.rerequested, lost: t.lost + s.lost }),
      { chunks: 0, segments: 0, rerequested: 0, lost: 0 },
    );
    console.log(`S2 replay total: ${JSON.stringify(total)}`);
    // S2 §4: the three arms with recorded repairs re-requested 248 + 31 + 14 segments, 0 lost.
    expect([all['cut-1.0']?.rerequested, all['cut-2.0']?.rerequested, all['vi-raw-medium']?.rerequested]).toEqual([248, 31, 14]);
    // Every chunk that needed a repair has a recorded one, so the loss count is real.
    expect(Object.values(all).reduce((n, s) => n + s.noRepairRecorded, 0)).toBe(0);
    expect(total.lost).toBe(0);
  });
});
