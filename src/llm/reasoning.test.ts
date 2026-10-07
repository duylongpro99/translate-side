import { describe, expect, it } from 'vitest';
import { reasoningFor, reserveTokensOf } from './reasoning.ts';
import type { Quirks } from './types.ts';

const policy: Quirks['reasoning'] = {
  control: 'effort',
  lowest: 'off',
  reserveTokens: 0,
  byChunk: [
    { fromChunk: 1, lowest: 'minimal', reserveTokens: 3000 },
    { fromChunk: 4, lowest: 'low', reserveTokens: 5000 },
  ],
};

describe('reasoningFor (per-chunk thinking, M2-D16)', () => {
  it('uses the base setting without a chunk index (analyze) and before the first entry', () => {
    expect(reasoningFor(policy, {})).toEqual({ control: 'effort', lowest: 'off', reserveTokens: 0 });
    expect(reasoningFor(policy, { chunkIndex: 0 })).toEqual({ control: 'effort', lowest: 'off', reserveTokens: 0 });
  });

  it('uses the last entry the chunk has reached, keeping the control', () => {
    expect(reasoningFor(policy, { chunkIndex: 1 })).toEqual({ control: 'effort', lowest: 'minimal', reserveTokens: 3000 });
    expect(reasoningFor(policy, { chunkIndex: 3 })).toEqual({ control: 'effort', lowest: 'minimal', reserveTokens: 3000 });
    expect(reasoningFor(policy, { chunkIndex: 4 })).toEqual({ control: 'effort', lowest: 'low', reserveTokens: 5000 });
    // A flipped control (§4.2.4: the endpoint rejected reasoning_effort) applies to every chunk.
    expect(reasoningFor({ ...policy, control: 'none' }, { chunkIndex: 9 })?.control).toBe('none');
  });

  it('passes a plain setting through, and nothing when there is none', () => {
    expect(reasoningFor({ control: 'effort', lowest: 'off', reserveTokens: 0 }, { chunkIndex: 5 })).toEqual({ control: 'effort', lowest: 'off', reserveTokens: 0 });
    expect(reasoningFor(undefined, { chunkIndex: 1 })).toBeUndefined();
  });

  it('reports the largest reserve the policy can send', () => {
    expect(reserveTokensOf(policy)).toBe(5000);
    expect(reserveTokensOf({ control: 'effort', lowest: 'low', reserveTokens: 256 })).toBe(256);
    expect(reserveTokensOf(undefined)).toBe(0);
  });
});
