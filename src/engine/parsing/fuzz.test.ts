// Parser fuzz test (plan M1 criterion 4, M1-E12). Seeded random chunks, with literal `<`, `>`, `&`,
// markers and sometimes literal `<seg` / `</seg>` text, get a simulated model answer with 0–3
// random S2 faults (faults.ts), fed in random deltas. The repair call answers the re-requested
// segments cleanly, or (one run in five) with one more fault. Properties:
// - no segment is lost: each ends with a final of the right text, or with `segment.failed`;
// - with a clean repair nothing fails (segment loss after repair = 0), except the S2 limit: a v2
//   chunk whose model did not copy the nonce can fail (L-adjacent/L-tail repeat in the repair);
// - no silent corruption: a segment's last final is the model's text for it, except a merge the
//   length-ratio rule misses (S2: suspect-merged needs ratio > 1.6× the median);
// - the finals and failures do not depend on how the stream is split.

import { describe, expect, it } from 'vitest';
import type { NormalizedEvent, StopReason } from '../../llm/types.ts';
import type { EngineEvent, Segment } from '../types.ts';
import { deltaSizes, lcg, simulateOutput, type Fault } from './faults.ts';
import { translateChunk, type ChunkCall } from './translate-chunk.ts';
import { toWire, type WireChunk } from './wire.ts';

export const ITERATIONS = 3000;
export const SEED = 20261006;

const WORDS = ['the', 'future', 'is', 'lazy', 'Vec<T>', 'a < b', 'x > y', '`<div>`', 'AT&T', '&amp;', '2>&1', '[link]docs[/link]', '**bold**', '*em*', '<p>', '<segment>', '<se', '=>', 'Result<T, E>', 'đã', '日本語'];
const LITERAL = ['<seg id="2">', '</seg>', '<seg>', '< /seg>', '<SEG id=1>'];

function randomChunk(rng: () => number, k: number): WireChunk {
  const n = 1 + Math.floor(rng() * 25);
  const literal = rng() < 0.2;
  const segments: Segment[] = Array.from({ length: n }, (_, i) => {
    const words = Array.from({ length: 1 + Math.floor(rng() * 30) }, () => WORDS[Math.floor(rng() * WORDS.length)] as string);
    if (literal && rng() < 0.3) words.splice(Math.floor(rng() * (words.length + 1)), 0, LITERAL[Math.floor(rng() * LITERAL.length)] as string);
    const markup = words.join(' ');
    return { id: `k${k}s${i}`, kind: 'p', text: markup, inlineMarkup: markup, domPath: `p[${i}]`, translate: true };
  });
  return toWire(segments);
}

export const translateText = (s: string): string => `T: ${s}`;

function stream(output: string, stopReason: StopReason, rng: () => number): NormalizedEvent[] {
  const next = deltaSizes(rng, 1 + Math.floor(rng() * 12));
  const events: NormalizedEvent[] = [];
  for (let i = 0; i < output.length; ) {
    const n = next();
    events.push({ type: 'text', delta: output.slice(i, i + n) });
    i += n;
  }
  events.push({ type: 'usage', input: 1, output: 1 }, { type: 'done', stopReason });
  return events;
}

async function* play(events: NormalizedEvent[]): AsyncGenerator<NormalizedEvent> {
  for (const e of events) yield e;
}

const options = { producedBy: { strategy: 's', stage: 'translate', model: 'm' }, revision: 1, role: 'translate' as const };

interface Outcome {
  /** Last final text per id, or 'FAILED'. */
  end: Map<string, string>;
  rerequested: number;
}

async function runOnce(chunk: WireChunk, first: { output: string; stopReason: StopReason }, repairFaults: Fault[], copyNonce: boolean, simSeed: number, splitSeed: number): Promise<Outcome> {
  const rng = lcg(splitSeed);
  const call: ChunkCall = (sent, attempt) => {
    if (attempt === 1) return play(stream(first.output, first.stopReason, rng));
    const sim = simulateOutput(sent, translateText, lcg(simSeed), { faults: repairFaults, copyNonce });
    return play(stream(sim.output, sim.stopReason, rng));
  };
  const end = new Map<string, string>();
  const gen = translateChunk(chunk, call, options);
  for (;;) {
    const r = await gen.next();
    if (r.done === true) return { end, rerequested: r.value.first.plan.rerequest.length };
    const e: EngineEvent = r.value;
    if (e.type === 'segment.final') end.set(e.id, e.text);
    else if (e.type === 'segment.failed') end.set(e.id, 'FAILED');
  }
}

describe(`parser fuzz (${ITERATIONS} chunks, seed ${SEED})`, () => {
  it('loses no segment, corrupts none silently, and is split-independent', async () => {
    const rng = lcg(SEED);
    const stats = { chunks: 0, segments: 0, v2: 0, faulted: 0, rerequested: 0, lostCleanRepair: 0, failedNonceLimit: 0, failedFaultyRepair: 0, taintedWrong: 0 };
    for (let k = 0; k < ITERATIONS; k++) {
      const chunk = randomChunk(rng, k);
      const copyNonce = rng() < 0.8;
      const first = simulateOutput(chunk, translateText, rng, { faults: Math.floor(rng() * 4), copyNonce });
      const faultyRepair = rng() < 0.2;
      const pick = Math.floor(rng() * 15);
      const repairFaults: Fault[] = faultyRepair ? [(['drop', 'merge', 'empty', 'cut', 'dup', 'unclose-middle', 'reorder', 'quote-drift', 'preamble', 'between-text', 'bad-id', 'unknown', 'fence', 'case-drift', 'unclose-last'] as const)[pick] as Fault] : [];
      const seed = 1 + Math.floor(rng() * 1e9);
      const a = await runOnce(chunk, first, repairFaults, copyNonce, seed, seed + 1);
      const b = await runOnce(chunk, first, repairFaults, copyNonce, seed, seed + 7919);
      const ctx = `chunk ${k} (${chunk.grammar}${chunk.nonce === undefined ? '' : copyNonce ? ', nonce' : ', nonce not copied'}) faults ${first.faults.join(',')} repair ${repairFaults.join(',')}`;
      expect(b.end, `split dependence: ${ctx}`).toEqual(a.end);

      stats.chunks++;
      stats.segments += chunk.segments.length;
      stats.v2 += chunk.grammar === 'v2' ? 1 : 0;
      stats.faulted += first.faults.length > 0 ? 1 : 0;
      stats.rerequested += a.rerequested;
      for (const e of chunk.segments) {
        const got = a.end.get(e.segment.id);
        expect(got, `segment ${e.n} has no final and no failure: ${ctx}`).toBeDefined();
        const want = translateText(e.segment.inlineMarkup).trim();
        if (got === 'FAILED') {
          if (faultyRepair) stats.failedFaultyRepair++;
          else if (chunk.grammar === 'v2' && !copyNonce) stats.failedNonceLimit++;
          else {
            stats.lostCleanRepair++;
            expect.fail(`segment ${e.n} lost after a clean repair: ${ctx}\n${first.output}`);
          }
        } else if (got !== want) {
          if (first.tainted.has(e.n) || (faultyRepair && repairFaults[0] === 'merge')) stats.taintedWrong++;
          else expect(got, `segment ${e.n} silently wrong: ${ctx}\n${first.output}`).toBe(want);
        }
      }
    }
    expect(stats.lostCleanRepair).toBe(0);
    expect(stats.chunks).toBe(ITERATIONS);
    // Printed for the report (criterion 3/4 evidence).
    console.log(`fuzz seed ${SEED}: ${JSON.stringify(stats)}`);
  });
});
