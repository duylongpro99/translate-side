import { describe, expect, it, vi } from 'vitest';
import { isTtsError } from '../errors';
import { cleanTtsConnection, type TtsConnection } from '../settings';
import { cloudEngine, cloudReads, pieces, withSystemVoice } from './cloud-engine';
import { AudioCache, type AudioPort, LINK_RETRY_EVERY_MS, LINK_RETRY_MS, playAudio } from './player';
import type { CloudAdapter, SynthesisRequest } from './adapter';

/** An <audio> fake: it plays to its end on the next tick, or fails to load the first `failures` times for a link. */
function fakeAudio({ hold = false, failures = 0 } = {}) {
  const played: string[] = [];
  let left = failures;
  const port: AudioPort = {
    objectUrl: (blob) => `blob:${(blob as Blob & { tag?: string }).tag ?? 'x'}`,
    revoke: vi.fn(),
    create(src) {
      const el = new EventTarget() as HTMLAudioElement & EventTarget;
      Object.assign(el, {
        error: null,
        pause: vi.fn(),
        play: () => {
          played.push(src);
          if (left > 0 && !src.startsWith('blob:')) {
            left--;
            Object.assign(el, { error: { code: 4 } });
            setTimeout(() => el.dispatchEvent(new Event('error')), 0);
          } else if (!hold) setTimeout(() => el.dispatchEvent(new Event('ended')), 0);
          return Promise.resolve();
        },
      });
      return el;
    },
  };
  return { port, played };
}

const tagged = (tag: string) => Object.assign(new Blob(['a']), { tag });

function fakeAdapter({ fail }: { fail?: Error } = {}) {
  const requests: SynthesisRequest[] = [];
  const adapter: CloudAdapter = {
    voices: (lang) => (lang === 'vi' ? [{ id: 'v1', name: 'V1' }, { id: 'v2', name: 'V2' }] : [{ id: 'e1', name: 'E1' }]),
    async synthesize(req) {
      requests.push(req);
      if (fail) throw fail;
      return { blob: tagged(req.text) };
    },
  };
  return { adapter, requests };
}

const GEMINI = cleanTtsConnection({ presetId: 'gemini' }) as TtsConnection;
const api = {} as Parameters<typeof cloudEngine>[0];

describe('pieces', () => {
  it('joins clauses up to the limit and never splits inside one that fits', () => {
    expect(pieces('One. Two. Three is longer.', 12)).toEqual(['One. Two.', 'Three is', 'longer.']);
    expect(pieces('One. Two.', 100)).toEqual(['One. Two.']);
  });
});

describe('cloudEngine', () => {
  it('reads each piece in turn with the voice, language, note and key', async () => {
    const { adapter, requests } = fakeAdapter();
    const audio = fakeAudio();
    const engine = cloudEngine(api, GEMINI, { adapter, readKey: async () => 'k', audio: audio.port });
    await expect(engine.speak('Giá 5 đ.', { lang: 'vi-VN', voice: 'v2', note: 'calm' }).done).resolves.toBe('ended');
    expect(requests.map((r) => [r.text, r.voice, r.lang, r.note, r.key])).toEqual([['Giá năm đồng.', 'v2', 'vi', 'calm', 'k']]);
    expect(audio.played).toEqual(['blob:Giá năm đồng.']);
  });

  it('lists the provider’s voices as remote, and takes the first when none is picked', async () => {
    const { adapter, requests } = fakeAdapter();
    const engine = cloudEngine(api, GEMINI, { adapter, readKey: async () => 'k', audio: fakeAudio().port });
    expect(await engine.voices('en-US')).toEqual([{ id: 'e1', name: 'E1', lang: 'en-US', engine: 'cloud', remote: true }]);
    await engine.speak('Hi.', { lang: 'en', voice: 'nope' }).done;
    expect(requests[0]?.voice).toBe('e1');
  });

  it('sends no note to a provider that takes none', async () => {
    const { adapter, requests } = fakeAdapter();
    const azure = cleanTtsConnection({ presetId: 'azure', region: 'eastus' }) as TtsConnection;
    await cloudEngine(api, azure, { adapter, readKey: async () => 'k', audio: fakeAudio().port }).speak('Hi.', { lang: 'en', note: 'calm' }).done;
    expect(requests[0]?.note).toBeUndefined();
  });

  it('says no-voice for a language the provider does not read, and auth without a key', async () => {
    const vbee = cleanTtsConnection({ presetId: 'vbee' }) as TtsConnection;
    const { adapter, requests } = fakeAdapter();
    const noVoice = cloudEngine(api, vbee, { adapter, readKey: async () => 'k', audio: fakeAudio().port }).speak('Hello.', { lang: 'en' }).done;
    await expect(noVoice).rejects.toSatisfy((e) => isTtsError(e) && e.kind === 'no-voice');
    const noKey = cloudEngine(api, GEMINI, { adapter, readKey: async () => undefined, audio: fakeAudio().port }).speak('Hello.', { lang: 'en' }).done;
    await expect(noKey).rejects.toSatisfy((e) => isTtsError(e) && e.kind === 'auth');
    expect(requests).toEqual([]);
  });

  it('leaves a language the provider does not read to the system voice, without its voice or note', async () => {
    const vbee = cleanTtsConnection({ presetId: 'vbee' }) as TtsConnection;
    const { adapter, requests } = fakeAdapter();
    const system = { id: 'system' as const, voices: vi.fn(async () => []), speak: vi.fn(() => ({ done: Promise.resolve('ended' as const), stop: () => {} })) };
    const engine = withSystemVoice(cloudEngine(api, vbee, { adapter, readKey: async () => 'k', audio: fakeAudio().port }), vbee, system);
    await expect(engine.speak('Hello.', { lang: 'en-GB', voice: 'v1', note: 'calm' }).done).resolves.toBe('ended');
    expect(system.speak).toHaveBeenCalledWith('Hello.', { lang: 'en-GB' });
    engine.prefetch?.('Bonjour.', { lang: 'fr' });
    await engine.voices('fr');
    expect(system.voices).toHaveBeenCalledWith('fr');
    expect((await engine.voices('vi')).every((v) => v.engine === 'cloud')).toBe(true);
    await engine.speak('Xin chào.', { lang: 'vi' }).done;
    expect(requests.map((r) => r.text)).toEqual(['Xin chào.']);
    expect(cloudReads(vbee, 'vi-VN')).toBe(true);
    expect(cloudReads(GEMINI, 'en')).toBe(true);
    expect(cloudReads(GEMINI, 'fr')).toBe(false);
  });

  it('passes a provider error on', async () => {
    const { adapter } = fakeAdapter({ fail: Object.assign(new Error('quota'), {}) });
    await expect(cloudEngine(api, GEMINI, { adapter, readKey: async () => 'k', audio: fakeAudio().port }).speak('Hi.', { lang: 'en' }).done).rejects.toThrow('quota');
  });

  it('replays a block from its cache, and the prefetched block costs no second request', async () => {
    const { adapter, requests } = fakeAdapter();
    const engine = cloudEngine(api, GEMINI, { adapter, readKey: async () => 'k', audio: fakeAudio().port });
    await engine.speak('One.', { lang: 'en' }).done;
    await engine.speak('One.', { lang: 'en' }).done;
    engine.prefetch?.('Two.', { lang: 'en' });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    await engine.speak('Two.', { lang: 'en' }).done;
    expect(requests.map((r) => r.text)).toEqual(['One.', 'Two.']);
  });

  it('stops at once, cancelling its request', async () => {
    const { adapter, requests } = fakeAdapter();
    const audio = fakeAudio({ hold: true });
    const pb = cloudEngine(api, GEMINI, { adapter, readKey: async () => 'k', audio: audio.port }).speak('One.', { lang: 'en' });
    await vi.waitFor(() => expect(audio.played).toHaveLength(1));
    pb.stop();
    await expect(pb.done).resolves.toBe('stopped');
    expect(requests[0]?.signal.aborted).toBe(true);
  });
});

describe('playAudio', () => {
  it('loads a link again until the file is there, and gives up after the retry window', async () => {
    vi.useFakeTimers();
    try {
      const audio = fakeAudio({ failures: 2 });
      const done = playAudio({ url: 'https://f/a.mp3' }, new AbortController().signal, audio.port);
      await vi.advanceTimersByTimeAsync(LINK_RETRY_EVERY_MS * 3);
      await expect(done).resolves.toBe('ended');
      expect(audio.played).toHaveLength(3);

      const never = fakeAudio({ failures: 1000 });
      const late = playAudio({ url: 'https://f/b.mp3' }, new AbortController().signal, never.port);
      const check = expect(late).rejects.toSatisfy((e) => isTtsError(e) && e.kind === 'network');
      await vi.advanceTimersByTimeAsync(LINK_RETRY_MS + LINK_RETRY_EVERY_MS * 2);
      await check;
    } finally {
      vi.useRealTimers();
    }
  });

  it('frees a blob’s URL once played', async () => {
    const audio = fakeAudio();
    await playAudio({ blob: tagged('x') }, new AbortController().signal, audio.port);
    expect(audio.port.revoke).toHaveBeenCalledWith('blob:x');
  });
});

describe('AudioCache', () => {
  it('drops the least recently used entry over its size', () => {
    const c = new AudioCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect([c.get('a'), c.get('b'), c.get('c')]).toEqual([1, undefined, 3]);
  });
});
