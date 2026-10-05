import { describe, expect, it } from 'vitest';
import { describeEngine } from './index.ts';

describe('engine', () => {
  // N5: engine tests run without the WXT test plugin, which stubs chrome/browser globals.
  it('runs in plain Node, with no extension globals present', () => {
    // eslint-disable-next-line no-restricted-globals -- checking that the globals are absent
    expect('chrome' in globalThis).toBe(false);
    // eslint-disable-next-line no-restricted-globals -- checking that the globals are absent
    expect('browser' in globalThis).toBe(false);
    expect(typeof process.versions.node).toBe('string');
  });

  it('runs with injected ports', () => {
    const llm = {
      async *stream() {
        yield { type: 'done' as const, stopReason: 'end' as const };
      },
    };
    expect(describeEngine({ llm, now: () => 42 })).toBe('engine v0 @ 42');
  });
});
