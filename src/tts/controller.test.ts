import { describe, expect, it, vi } from 'vitest';
import { createReadAloud, type ReadBlock, type ReadState } from './controller';
import { TtsError } from './errors';
import type { Playback, PlaybackEnd, SpeakOptions, TtsEngine } from './types';

/** An engine whose playbacks end when the test says so. */
function fakeEngine({ prefetch = false } = {}) {
  const calls: { text: string; opts: SpeakOptions }[] = [];
  const prefetched: string[] = [];
  const open: { resolve: (e: PlaybackEnd) => void; reject: (e: unknown) => void }[] = [];
  const engine: TtsEngine = {
    id: 'system',
    voices: async () => [],
    speak(text, opts): Playback {
      calls.push({ text, opts });
      let resolve!: (e: PlaybackEnd) => void;
      let reject!: (e: unknown) => void;
      const done = new Promise<PlaybackEnd>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      open.push({ resolve, reject });
      return { done, stop: () => resolve('stopped') };
    },
    ...(prefetch ? { prefetch: (text: string) => void prefetched.push(text) } : {}),
  };
  const finish = async () => {
    await vi.waitFor(() => expect(open.length).toBeGreaterThan(0));
    open.shift()?.resolve('ended');
  };
  return { engine, calls, prefetched, open, finish };
}

const BLOCKS: ReadBlock[] = [
  { id: 'a', text: 'First.', lang: 'en' },
  { id: 'b', text: '', lang: 'en' },
  { id: 'c', text: 'Third.', lang: 'en' },
  { id: 'd', text: 'Fourth.', lang: 'vi' },
];
const [first, empty, third] = BLOCKS as [ReadBlock, ReadBlock, ReadBlock, ReadBlock];
const next = (id: string) => BLOCKS[BLOCKS.findIndex((b) => b.id === id) + 1];

function setup({ readOn = true, prefetch = false } = {}) {
  const fake = fakeEngine({ prefetch });
  const states: ReadState[] = [];
  const reader = createReadAloud({ engine: () => fake.engine, readOn: () => readOn, voiceFor: (l) => (l === 'vi' ? 'Linh' : undefined), onChange: (s) => states.push(s) });
  return { ...fake, states, reader };
}

describe('createReadAloud', () => {
  it('reads on through the following blocks, skipping empty ones, then goes idle', async () => {
    const t = setup();
    const playing = t.reader.play(first, next);
    await t.finish();
    await t.finish();
    await t.finish();
    await playing;
    expect(t.calls.map((c) => c.text)).toEqual(['First.', 'Third.', 'Fourth.']);
    expect(t.calls[2]?.opts).toEqual({ lang: 'vi', voice: 'Linh', note: undefined });
    expect(t.states.map((s) => s.blockId ?? s.status)).toEqual(['a', 'c', 'd', 'idle']);
  });

  it('reads one block when read-on is off', async () => {
    const t = setup({ readOn: false });
    const playing = t.reader.play(first, next);
    await t.finish();
    await playing;
    expect(t.calls.map((c) => c.text)).toEqual(['First.']);
    expect(t.reader.state).toEqual({ status: 'idle' });
  });

  it('stops at once; stop is idempotent and stops nothing twice', async () => {
    const t = setup();
    const playing = t.reader.play(first, next);
    await vi.waitFor(() => expect(t.calls).toHaveLength(1));
    t.reader.stop();
    t.reader.stop();
    await playing;
    expect(t.calls).toHaveLength(1);
    expect(t.states.map((s) => s.status)).toEqual(['reading', 'idle']);
  });

  it('keeps one playback: a new play stops the old one', async () => {
    const t = setup({ readOn: false });
    const firstPlay = t.reader.play(first, next);
    await vi.waitFor(() => expect(t.calls).toHaveLength(1));
    const second = t.reader.play(third, next);
    await firstPlay;
    await t.finish(); // the first playback's (already stopped) entry
    await t.finish();
    await second;
    expect(t.calls.map((c) => c.text)).toEqual(['First.', 'Third.']);
    expect(t.reader.state.status).toBe('idle');
  });

  it('starts at the next block with text when the first one is empty', async () => {
    const t = setup({ readOn: false });
    const playing = t.reader.play(empty, next);
    await t.finish();
    await playing;
    expect(t.calls.map((c) => c.text)).toEqual(['Third.']);
  });

  it('reports a failure with its kind and block, then goes idle', async () => {
    const t = setup();
    const playing = t.reader.play(first, next);
    await vi.waitFor(() => expect(t.open).toHaveLength(1));
    t.open[0]?.reject(new TtsError('no-voice', 'No voice'));
    await playing;
    expect(t.reader.state).toEqual({ status: 'idle', error: { kind: 'no-voice', message: 'No voice', blockId: 'a' } });
  });

  it('prepares each block, and has a cloud voice fetch the next one while this one plays', async () => {
    const fake = fakeEngine({ prefetch: true });
    const prepare = vi.fn(async (b: ReadBlock) => ({ text: b.text.toUpperCase(), note: 'calm' }));
    const reader = createReadAloud({ engine: () => fake.engine, readOn: () => true, prepare, onChange: () => {} });
    const playing = reader.play(first, next);
    await vi.waitFor(() => expect(fake.prefetched).toEqual(['THIRD.']));
    await fake.finish();
    await fake.finish();
    await fake.finish();
    await playing;
    expect(fake.calls.map((c) => [c.text, c.opts.note])).toEqual([
      ['FIRST.', 'calm'],
      ['THIRD.', 'calm'],
      ['FOURTH.', 'calm'],
    ]);
    expect(prepare).toHaveBeenCalledTimes(3);
  });

  it('goes idle when its playback is cut short from outside', async () => {
    const t = setup();
    const playing = t.reader.play(first, next);
    await vi.waitFor(() => expect(t.open).toHaveLength(1));
    t.open[0]?.resolve('stopped');
    await playing;
    expect(t.calls).toHaveLength(1);
    expect(t.reader.state).toEqual({ status: 'idle' });
  });

  it('does not read a block prepared early once a different block comes next', async () => {
    const fake = fakeEngine({ prefetch: true });
    const list: ReadBlock[] = [
      { id: 'a', text: 'A.', lang: 'en' },
      { id: 'b', text: '', lang: 'en' },
      { id: 'c', text: 'C.', lang: 'en' },
    ];
    const after = (id: string) => list[list.findIndex((x) => x.id === id) + 1];
    const reader = createReadAloud({ engine: () => fake.engine, readOn: () => true, prepare: async (x) => ({ text: x.text }), onChange: () => {} });
    const playing = reader.play(list[0] as ReadBlock, after);
    await vi.waitFor(() => expect(fake.prefetched).toEqual(['C.']));
    // B's translation arrives while A plays.
    list[1] = { id: 'b', text: 'B.', lang: 'en' };
    await fake.finish();
    await fake.finish();
    await fake.finish();
    await playing;
    expect(fake.calls.map((c) => c.text)).toEqual(['A.', 'B.', 'C.']);
  });

  it('waits for a block still being translated, then reads it, and prefetches nothing past it', async () => {
    const fake = fakeEngine({ prefetch: true });
    const list: ReadBlock[] = [
      { id: 'a', text: 'A.', lang: 'en' },
      { id: 'b', text: '', lang: 'en', pending: true },
      { id: 'c', text: 'C.', lang: 'en' },
    ];
    const after = (id: string) => list[list.findIndex((x) => x.id === id) + 1];
    let tick!: () => void;
    const wait = vi.fn(() => new Promise<void>((r) => (tick = r)));
    const reader = createReadAloud({ engine: () => fake.engine, readOn: () => true, wait, onChange: () => {} });
    const playing = reader.play(list[0] as ReadBlock, after);
    await fake.finish();
    await vi.waitFor(() => expect(wait).toHaveBeenCalledTimes(1));
    expect(fake.prefetched).toEqual([]);
    list[1] = { id: 'b', text: 'B.', lang: 'en' };
    tick();
    await fake.finish();
    await fake.finish();
    await playing;
    expect(fake.calls.map((c) => c.text)).toEqual(['A.', 'B.', 'C.']);
  });

  it('stops waiting for a block when stopped', async () => {
    const fake = fakeEngine();
    const list: ReadBlock[] = [
      { id: 'a', text: 'A.', lang: 'en' },
      { id: 'b', text: '', lang: 'en', pending: true },
    ];
    const after = (id: string) => list[list.findIndex((x) => x.id === id) + 1];
    let tick!: () => void;
    const wait = vi.fn(() => new Promise<void>((r) => (tick = r)));
    const states: ReadState[] = [];
    const reader = createReadAloud({ engine: () => fake.engine, readOn: () => true, wait, onChange: (s) => states.push(s) });
    const playing = reader.play(list[0] as ReadBlock, after);
    await fake.finish();
    await vi.waitFor(() => expect(wait).toHaveBeenCalled());
    reader.stop();
    list[1] = { id: 'b', text: 'B.', lang: 'en' };
    tick();
    await playing;
    expect(fake.calls.map((c) => c.text)).toEqual(['A.']);
    expect(states.at(-1)).toEqual({ status: 'idle' });
  });
});

