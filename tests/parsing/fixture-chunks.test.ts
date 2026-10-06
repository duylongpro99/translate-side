// The chunker and the chunk path on the ten fixtures (plan M1 criterion 3, parser/repair side; real
// model answers come in Phase D). Each fixture is extracted as the content script does, chunked
// with the default size, and every chunk gets ROUNDS simulated answers with 0–3 seeded S2 faults
// (src/engine/parsing/faults.ts) plus a clean repair answer. Segment loss after repair must be 0.
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent, StopReason } from '@/llm/types';
import type { EngineEvent, Segment } from '@/engine/types';
import { chunkLimits, chunkSegments, DEFAULT_CHUNK_TOKENS, estimateTokens, toWire, translateChunk, type ChunkCall } from '@/engine/index';
import { lcg, simulateOutput } from '@/engine/parsing/faults';
import { extractPage } from '@/extract';
import { loadFixture, slugs } from '../fixtures/load.ts';

const ROUNDS = 20;
const SEED = 4242;
const translate = (s: string): string => `T: ${s}`;

function segmentsOf(slug: string): Segment[] {
  const r = extractPage(loadFixture(slug));
  if (!r.ok) throw new Error(`${slug}: ${r.reason}`);
  return r.segments;
}

async function* play(output: string, stopReason: StopReason): AsyncGenerator<NormalizedEvent> {
  for (let i = 0; i < output.length; i += 9) yield { type: 'text', delta: output.slice(i, i + 9) };
  yield { type: 'done', stopReason };
}

const limits = chunkLimits(DEFAULT_CHUNK_TOKENS);

describe('fixture chunks', () => {
  it.each(slugs)('%s: chunked to DESIGN size, no segment lost after repair', async (slug) => {
    const segments = segmentsOf(slug);
    const chunks = chunkSegments(segments, limits);
    const sent = segments.filter((s) => s.translate);
    expect(chunks.flatMap((c) => c.segments)).toEqual(sent);
    for (const c of chunks) {
      // Over the maximum only as one unit (one segment, or one table row).
      if (c.tokens > limits.maxTokens) expect(new Set(c.segments.map((s) => s.groupId ?? s.id)).size).toBe(1);
      // Never split a table row.
      const next = chunks[c.index + 1]?.segments[0];
      const last = c.segments.at(-1);
      if (last?.groupId !== undefined) expect(next?.groupId).not.toBe(last.groupId);
    }

    const rng = lcg(SEED + slug.length);
    let rerequested = 0;
    let lost = 0;
    for (const chunk of chunks) {
      const wire = toWire(chunk.segments);
      for (let round = 0; round < ROUNDS; round++) {
        const first = simulateOutput(wire, translate, rng, { faults: Math.floor(rng() * 4) });
        const call: ChunkCall = (w, attempt) => {
          if (attempt === 1) return play(first.output, first.stopReason);
          const clean = simulateOutput(w, translate, rng);
          return play(clean.output, clean.stopReason);
        };
        const end = new Map<string, string>();
        const gen = translateChunk(wire, call, { producedBy: { strategy: 't', stage: 'translate', model: 'm' }, revision: 1, role: 'translate' });
        for (;;) {
          const r = await gen.next();
          if (r.done === true) {
            rerequested += r.value.first.plan.rerequest.length;
            break;
          }
          const e: EngineEvent = r.value;
          if (e.type === 'segment.final') end.set(e.id, e.text);
          if (e.type === 'segment.failed') end.set(e.id, 'FAILED');
        }
        for (const e of wire.segments) {
          const got = end.get(e.segment.id);
          if (got === undefined || got === 'FAILED') lost++;
          else if (!first.tainted.has(e.n)) expect(got).toBe(translate(e.segment.inlineMarkup).trim());
        }
      }
    }
    const sizes = chunks.map((c) => c.tokens);
    console.log(
      `${slug}: ${sent.length} segments, ${chunks.length} chunks, tokens ${Math.min(...sizes)}–${Math.max(...sizes)} (total ${sent.reduce((n, s) => n + estimateTokens(s.inlineMarkup), 0)}), ` +
        `v2 chunks ${chunks.filter((c) => toWire(c.segments).grammar === 'v2').length}; ${ROUNDS} rounds: ${chunks.length * ROUNDS} answers, ${rerequested} re-requested, ${lost} lost`,
    );
    expect(lost).toBe(0);
  });
});
