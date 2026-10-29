import { describe, expect, it, vi } from 'vitest';
import { isTtsError } from './errors';
import { type ChromeTtsPort, pickVoice, rankVoices, type SystemTtsEvent, type SystemVoice, systemEngine } from './system';

const VOICES: SystemVoice[] = [
  { voiceName: 'Google US English', lang: 'en-US', remote: true },
  { voiceName: 'Daniel', lang: 'en-GB', remote: false },
  { voiceName: 'Samantha', lang: 'en-US', remote: false },
  { voiceName: 'Linh', lang: 'vi-VN', remote: false },
  { voiceName: 'Thomas', lang: 'fr-FR', remote: false },
];

/** A chrome.tts fake: each utterance ends on the next tick unless `hold` keeps it playing. */
function fakeTts({ voices = VOICES, hold = false, fail }: { voices?: SystemVoice[]; hold?: boolean; fail?: string } = {}) {
  const spoken: { text: string; voiceName?: string; lang?: string; rate?: number }[] = [];
  let pending: ((e: SystemTtsEvent) => void) | undefined;
  const port: ChromeTtsPort = {
    getVoices: async () => voices,
    speak(text, options) {
      spoken.push({ text, voiceName: options.voiceName, lang: options.lang, rate: options.rate });
      pending = options.onEvent;
      if (fail) setTimeout(() => options.onEvent({ type: 'error', errorMessage: fail }), 0);
      else if (!hold) setTimeout(() => options.onEvent({ type: 'end' }), 0);
    },
    stop: vi.fn(() => pending?.({ type: 'interrupted' })),
  };
  return { port, spoken, finish: () => pending?.({ type: 'end' }) };
}

describe('rankVoices', () => {
  it('lists the language’s voices, local ones first and the home region first', () => {
    expect(rankVoices(VOICES, 'en').map((v) => v.id)).toEqual(['Samantha', 'Daniel', 'Google US English']);
    expect(rankVoices(VOICES, 'en-GB').map((v) => v.id)).toEqual(['Daniel', 'Samantha', 'Google US English']);
    expect(rankVoices(VOICES, 'vi')).toEqual([{ id: 'Linh', name: 'Linh', lang: 'vi-VN', engine: 'system', remote: false }]);
  });

  it('returns nothing for a language without voices or an empty tag', () => {
    expect(rankVoices(VOICES, 'ja')).toEqual([]);
    expect(rankVoices(VOICES, '')).toEqual([]);
  });
});

describe('pickVoice', () => {
  it('uses the named voice, else the best local voice, never a network voice on its own', () => {
    const en = rankVoices(VOICES, 'en');
    expect(pickVoice(en, 'Google US English')?.id).toBe('Google US English');
    expect(pickVoice(en, 'Linh')?.id).toBe('Samantha');
    expect(pickVoice(en)?.id).toBe('Samantha');
    expect(pickVoice(rankVoices([{ voiceName: 'Google Tiếng Việt', lang: 'vi-VN', remote: true }], 'vi'))).toBeUndefined();
  });
});

describe('systemEngine', () => {
  it('reads speakable text clause by clause with the language’s voice', async () => {
    const tts = fakeTts();
    const pb = systemEngine(tts.port).speak('Giá 50.000 đ. Rẻ quá!', { lang: 'vi' });
    const progress: number[] = [];
    pb.onProgress = (p) => progress.push(p.clause);
    await expect(pb.done).resolves.toBe('ended');
    expect(tts.spoken).toEqual([
      { text: 'Giá năm mươi nghìn đồng.', voiceName: 'Linh', lang: 'vi-VN', rate: 1 },
      { text: 'Rẻ quá!', voiceName: 'Linh', lang: 'vi-VN', rate: 1 },
    ]);
    expect(progress).toEqual([0, 1]);
  });

  it('rejects with no-voice when nothing reads the language, and never borrows another language’s voice', async () => {
    const tts = fakeTts();
    const done = systemEngine(tts.port).speak('こんにちは', { lang: 'ja' }).done;
    await expect(done).rejects.toSatisfy((e) => isTtsError(e) && e.kind === 'no-voice');
    expect(tts.spoken).toEqual([]);
  });

  it('stops at once, and stop is idempotent', async () => {
    const tts = fakeTts({ hold: true });
    const pb = systemEngine(tts.port).speak('One. Two. Three.', { lang: 'en' });
    await vi.waitFor(() => expect(tts.spoken).toHaveLength(1));
    pb.stop();
    pb.stop();
    await expect(pb.done).resolves.toBe('stopped');
    expect(tts.port.stop).toHaveBeenCalledTimes(1);
    expect(tts.spoken).toHaveLength(1);
  });

  it('stops before speaking when stop comes while voices load', async () => {
    const tts = fakeTts();
    const pb = systemEngine(tts.port).speak('One.', { lang: 'en' });
    pb.stop();
    await expect(pb.done).resolves.toBe('stopped');
    expect(tts.spoken).toEqual([]);
  });

  it('ends as stopped when another utterance interrupts it', async () => {
    const tts = fakeTts({ hold: true });
    const pb = systemEngine(tts.port).speak('One. Two.', { lang: 'en' });
    await vi.waitFor(() => expect(tts.spoken).toHaveLength(1));
    (tts.port.stop as () => void)();
    await expect(pb.done).resolves.toBe('stopped');
    expect(tts.spoken).toHaveLength(1);
  });

  it('rejects with the voice’s error', async () => {
    const tts = fakeTts({ fail: 'synthesis failed' });
    await expect(systemEngine(tts.port).speak('Hi.', { lang: 'en' }).done).rejects.toThrow('synthesis failed');
  });

  it('passes the rate and the picked voice', async () => {
    const tts = fakeTts();
    await systemEngine(tts.port).speak('Hi.', { lang: 'en', voice: 'Daniel', rate: 1.5 }).done;
    expect(tts.spoken[0]).toMatchObject({ voiceName: 'Daniel', lang: 'en-GB', rate: 1.5 });
  });

  it('ends at once on text with nothing to read', async () => {
    const tts = fakeTts();
    await expect(systemEngine(tts.port).speak(' — ', { lang: 'en' }).done).resolves.toBe('ended');
    expect(tts.spoken).toEqual([]);
  });
});
