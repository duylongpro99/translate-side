import { describe, expect, it } from 'vitest';
import { describeEngine } from './index.ts';

describe('engine', () => {
  it('runs in plain Node with injected ports', () => {
    const llm = {
      async *stream() {
        yield { type: 'done' as const, stopReason: 'end' as const };
      },
    };
    expect(describeEngine({ llm, now: () => 42 })).toBe('engine v0 @ 42');
  });
});
