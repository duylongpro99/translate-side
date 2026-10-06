// Parser fuzz test (plan M1 criterion 4, M1-E12). Seeded random chunks, with literal `<`, `>`, `&`,
// markers and sometimes literal `<seg` / `</seg>` text, get a simulated model answer with 0–3
// random S2 faults (faults.ts), fed in random deltas. The repair call answers the re-requested
// segments cleanly, or (one run in five) with one more fault. Properties:
// - no segment is lost: each ends with a final of the right text, or with `segment.failed`;
// - with a clean repair nothing fails (segment loss after repair = 0), except the S2 limit: a v2
//   chunk whose model did not copy the nonce and whose text has the L-adjacent or L-tail shape (a
//   literal close followed by a tag or by the segment's end) can fail, as the repair repeats it;
// - no silent corruption: a segment's last final is the model's text for it, except the ids
//   faults.ts marks tainted (a merge near the 1.6× ratio threshold, a wrong first copy, stray text
//   after an unclosed segment), and their number is bounded, and the two declared limits of plain
//   v2 with the nonce not copied (M1-D11, L1 and L2), counted on their own;
// - the finals and failures do not depend on how the stream is split.
// A mutation check runs the same fuzz without the merge rule and expects it to catch the loss.

import { describe, expect, it } from 'vitest';
import type { NormalizedEvent, StopReason } from '../../llm/types.ts';
import type { EngineEvent, Segment } from '../types.ts';
import { deltaSizes, lcg, simulateOutput, type Fault } from './faults.ts';
import { translateChunk, type ChunkCall, type TranslateChunkOptions } from './translate-chunk.ts';
import { toWire, type WireChunk } from './wire.ts';

export const ITERATIONS = 3000;
export const SEED = 20261006;

const WORDS = ['the', 'future', 'is', 'lazy', 'Vec<T>', 'a < b', 'x > y', '`<div>`', 'AT&T', '&amp;', '2>&1', '[link]docs[/link]', '**bold**', '*em*', '<p>', '<segment>', '<se', '=>', 'Result<T, E>', 'đã', '日本語'];
const LITERAL = ['<seg id="2">', '</seg>', '<seg>', '< /seg>', '<SEG id=1>', '</seg><seg id="1">'];

function randomChunk(rng: () => number, k: number): WireChunk {
  const n = 1 + Math.floor(rng() * 25);
  const literal = rng() < 0.2;
  const segments: Segment[] = Array.from({ length: n }, (_, i) => {
    const words = Array.from({ length: 1 + Math.floor(rng() * 30) }, () => WORDS[Math.floor(rng() * WORDS.length)] as string);
    if (literal && rng() < 0.3) words.splice(Math.floor(rng() * (words.length + 1)), 0, LITERAL[Math.floor(rng() * LITERAL.length)] as string);
    // L-tail: a literal close at the very end of the segment.
    if (literal && rng() < 0.1) words.push('</seg>');
    const markup = words.join(' ');
    return { id: `k${k}s${i}`, kind: 'p', text: markup, inlineMarkup: markup, domPath: `p[${i}]`, translate: true };
  });
  return toWire(segments);
}

export const translateText = (s: string): string => `T: ${s}`;

/** S2's declared limit without the nonce: a literal close followed by a tag-shaped string or by the end of the text. */
const L_SHAPE = /<\s*\/\s*seg\s*>\s*(<\s*\/?\s*seg(\s[^<>]*)?>|$)/i;
const lShaped = (chunk: WireChunk): boolean => chunk.segments.some((e) => L_SHAPE.test(translateText(e.segment.inlineMarkup).trim()));

/**
 * Decision M1-D11, the declared limits of plain v2 (nonce not copied) on wrong text. Segment `n`
 * may end with another segment's text when the source of another segment names it in a literal:
 * L1, an L-adjacent `</seg><seg id="n">` and the model drops or merges away segment n (its tail
 * is accepted as n); L2, a literal `<seg id="n">` and the model empties segment i, leaves it
 * unclosed and sends a wrong copy of n (the per-id counts tie with a genuine echo).
 */
const OPEN_TAG = /<\s*seg(\s[^<>]*)?>/gi;
const openIds = (text: string): number[] =>
  [...text.matchAll(OPEN_TAG)].flatMap((m) => {
    const g = /\bid\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))/i.exec(m[1] ?? '');
    return g === null ? [] : [Number(g[1] ?? g[2] ?? g[3])];
  });
function declaredLimit(chunk: WireChunk, n: number, faults: readonly Fault[]): 'L1' | 'L2' | null {
  const others = chunk.segments.filter((e) => e.n !== n).map((e) => e.segment.inlineMarkup);
  const adjacent = others.some((t) => [...t.matchAll(/<\s*\/\s*seg\s*>\s*(<\s*seg(\s[^<>]*)?>)/gi)].some((m) => openIds(m[1] ?? '').includes(n)));
  if (adjacent && (faults.includes('drop') || faults.includes('merge'))) return 'L1';
  if (others.some((t) => openIds(t).includes(n)) && (faults.includes('swallow-dup') || faults.includes('dup'))) return 'L2';
  return null;
}

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

interface Outcome {
  /** Last final text per id, or 'FAILED'. */
  end: Map<string, string>;
  rerequested: number;
}

async function runOnce(
  chunk: WireChunk,
  first: { output: string; stopReason: StopReason },
  repairFaults: Fault[],
  copyNonce: boolean,
  simSeed: number,
  splitSeed: number,
  options: TranslateChunkOptions,
): Promise<Outcome> {
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

const REPAIR_FAULTS = ['drop', 'merge', 'empty', 'cut', 'dup', 'unclose-middle', 'reorder', 'quote-drift', 'preamble', 'between-text', 'bad-id', 'unknown', 'fence', 'case-drift', 'unclose-last'] as const;

const newStats = () => ({ chunks: 0, segments: 0, v2: 0, lShaped: 0, faulted: 0, rerequested: 0, lostCleanRepair: 0, failedNonceLimit: 0, wrongLimitL1: 0, wrongLimitL2: 0, failedFaultyRepair: 0, taintedWrong: 0, silentWrong: 0, splitDependent: 0 });

interface FuzzResult {
  stats: ReturnType<typeof newStats>;
  /** Property violations, with context. */
  violations: string[];
}

async function fuzz(iterations: number, seed: number, mergeFactor?: number): Promise<FuzzResult> {
  const options: TranslateChunkOptions = { producedBy: { strategy: 's', stage: 'translate', model: 'm' }, revision: 1, role: 'translate', ...(mergeFactor === undefined ? {} : { mergeFactor }) };
  const rng = lcg(seed);
  const stats = newStats();
  const violations: string[] = [];
  for (let k = 0; k < iterations; k++) {
    const chunk = randomChunk(rng, k);
    const copyNonce = rng() < 0.8;
    const first = simulateOutput(chunk, translateText, rng, { faults: Math.floor(rng() * 4), copyNonce });
    const faultyRepair = rng() < 0.2;
    const pick = Math.floor(rng() * REPAIR_FAULTS.length);
    const repairFaults: Fault[] = faultyRepair ? [REPAIR_FAULTS[pick] as Fault] : [];
    const simSeed = 1 + Math.floor(rng() * 1e9);
    const a = await runOnce(chunk, first, repairFaults, copyNonce, simSeed, simSeed + 1, options);
    const b = await runOnce(chunk, first, repairFaults, copyNonce, simSeed, simSeed + 7919, options);
    const ctx = `chunk ${k} (${chunk.grammar}${chunk.nonce === undefined ? '' : copyNonce ? ', nonce' : ', nonce not copied'}) faults ${first.faults.join(',')} stop ${first.stopReason} repair ${repairFaults.join(',')}\n${first.output}`;
    if (JSON.stringify([...b.end]) !== JSON.stringify([...a.end])) {
      stats.splitDependent++;
      violations.push(`split dependence: ${ctx}`);
    }
    const nonceLimit = chunk.grammar === 'v2' && !copyNonce && lShaped(chunk);
    stats.chunks++;
    stats.segments += chunk.segments.length;
    stats.v2 += chunk.grammar === 'v2' ? 1 : 0;
    stats.lShaped += chunk.grammar === 'v2' && lShaped(chunk) ? 1 : 0;
    stats.faulted += first.faults.length > 0 ? 1 : 0;
    stats.rerequested += a.rerequested;
    for (const e of chunk.segments) {
      const got = a.end.get(e.segment.id);
      if (got === undefined) violations.push(`segment ${e.n} has no final and no failure: ${ctx}`);
      else if (got === 'FAILED') {
        if (faultyRepair) stats.failedFaultyRepair++;
        else if (nonceLimit) stats.failedNonceLimit++;
        else {
          stats.lostCleanRepair++;
          violations.push(`segment ${e.n} lost after a clean repair: ${ctx}`);
        }
      } else if (got !== translateText(e.segment.inlineMarkup).trim()) {
        // A merge in the repair answer is the same S2 limit as in the first one.
        const limit = chunk.grammar === 'v2' && !copyNonce ? declaredLimit(chunk, e.n, first.faults) : null;
        if (first.tainted.has(e.n) || (faultyRepair && repairFaults[0] === 'merge')) stats.taintedWrong++;
        else if (limit === 'L1') stats.wrongLimitL1++;
        else if (limit === 'L2') stats.wrongLimitL2++;
        else {
          stats.silentWrong++;
          violations.push(`segment ${e.n} silently wrong (${JSON.stringify(got)}): ${ctx}`);
        }
      }
    }
  }
  return { stats, violations };
}

describe(`parser fuzz (${ITERATIONS} chunks, seed ${SEED})`, () => {
  it('loses no segment, corrupts none silently, and is split-independent', async () => {
    const { stats, violations } = await fuzz(ITERATIONS, SEED);
    // Printed for the report (criterion 3/4 evidence).
    console.log(`fuzz seed ${SEED}: ${JSON.stringify(stats)}`);
    expect(violations.slice(0, 3)).toEqual([]);
    expect(stats.chunks).toBe(ITERATIONS);
    // The wrong-text exemption stays small. The nonce limit is S2's declared one and not bounded:
    // the random chunks make the L shapes common on purpose.
    expect(stats.taintedWrong).toBeLessThan(stats.segments / 200);
  }, 60_000);

  it('holds on seeds 1–12 too (1,000 chunks each)', async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { stats, violations } = await fuzz(1000, seed);
      expect(violations.slice(0, 3), `seed ${seed}`).toEqual([]);
      expect(stats.taintedWrong, `seed ${seed}`).toBeLessThan(stats.segments / 200);
    }
  }, 60_000);

  // Review T-B5 (seed 42, chunk 2582: taint after a cut), T-B6 (seed 123456789, chunk 157: M1-D10 per
  // id) and M1-D11 (seed 999999937, chunk 2175: limit L1).
  it.each([42, 123456789, 999999937])('holds on the tester seed %i (3,000 chunks)', async (seed) => {
    const { violations } = await fuzz(3000, seed);
    expect(violations.slice(0, 3)).toEqual([]);
  }, 60_000);

  it('catches the loss when the merge rule is removed (mutation check)', async () => {
    const { stats } = await fuzz(500, SEED, Number.POSITIVE_INFINITY);
    expect(stats.silentWrong).toBeGreaterThan(0);
  }, 60_000);
});
