// @vitest-environment jsdom
// Read aloud in the panel: the block toolbar's Read aloud and Stop, the reading block's state, the
// strip with Stop and Esc, the no-voice hint, and which text and language each side reads.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '@/engine/types';
import { fakeDevice } from '@/shared/testing';
import type { Playback, PlaybackEnd, SpeakOptions, TtsEngine } from '@/tts/types';
import { GEMINI_PROFILE } from '@/shared/settings';
import type { SpendDelta } from '@/shared/spend';
import { Jobs, type JobView, type SegState } from './jobs.ts';
import { blockText, nextBlock, readBlock, type Speech, useReadAloud, voicePrepVia } from './read-aloud.ts';
import { ReadStrip } from './ReadStrip.tsx';
import { SegmentList } from './SegmentList.tsx';

const spoken: { text: string; opts: SpeakOptions }[] = [];
const ends: ((e: PlaybackEnd) => void)[] = [];
const fakeEngine: TtsEngine = {
  id: 'system',
  voices: async () => [],
  speak(text, opts): Playback {
    spoken.push({ text, opts });
    let end!: (e: PlaybackEnd) => void;
    const done = new Promise<PlaybackEnd>((r) => (end = r));
    ends.push(end);
    return { done, stop: () => end('stopped') };
  },
};
const engineSettings: { engine: string }[] = [];
vi.mock('@/tts/engines', () => ({
  engineFor: async (_api: unknown, settings: { engine: string }) => {
    engineSettings.push(settings);
    // The cloud engine reads vi and en with the provider's voices; other languages with the system's.
    if (settings.engine !== 'cloud') return fakeEngine;
    return { ...fakeEngine, id: 'cloud', voices: async (lang: string) => (/^(vi|en)/.test(lang) ? [{ id: 'c1', name: 'C1', lang, engine: 'cloud', remote: true }] : []) };
  },
}));

const seg = (id: string, text: string, extra: Partial<Segment> = {}): Segment => ({ id, kind: 'p', text, inlineMarkup: text, domPath: `/p[${id}]`, translate: true, ...extra });
const SEGMENTS: Segment[] = [seg('a', 'Hello there.'), seg('b', 'const x = 1;', { kind: 'code', translate: false }), seg('c', 'Second block.'), seg('d', 'Not yet translated.')];
const final = (text: string): SegState => ({ status: 'final', text }) as SegState;
const JOB = { segments: SEGMENTS, targetLang: 'vi', sourceLang: 'en', segs: new Map([['a', final('Xin chào.')], ['c', final('Đoạn thứ hai.')]]) } as unknown as JobView;

let root: HTMLDivElement;
beforeEach(() => {
  spoken.length = 0;
  ends.length = 0;
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

describe('what each side reads', () => {
  const src = { segments: SEGMENTS, job: JOB, pageLang: 'en-GB' };

  it('reads the translation in the target language and the original in the source language', () => {
    expect(readBlock(src, 'a', 'translation')).toEqual({ id: 'a', text: 'Xin chào.', lang: 'vi' });
    expect(readBlock(src, 'a', 'original')).toEqual({ id: 'a', text: 'Hello there.', lang: 'en' });
    expect(readBlock(src, 'zzz', 'original')).toBeUndefined();
  });

  it('reads the translation, nothing for code or a block not translated yet', () => {
    expect(blockText(SEGMENTS[2] as Segment, 'translation', JOB)).toBe('Đoạn thứ hai.');
    expect(blockText(SEGMENTS[1] as Segment, 'original', JOB)).toBe('');
    expect(blockText(SEGMENTS[3] as Segment, 'translation', JOB)).toBe('');
  });

  it('takes the page language for the original when no job names one', () => {
    expect(readBlock({ segments: SEGMENTS, job: undefined, pageLang: 'en-GB' }, 'a', 'original')?.lang).toBe('en-GB');
  });

  it('marks a translation still on its way while the job runs, and not once it has ended', () => {
    const running = { ...JOB, status: 'running', segs: new Map([...JOB.segs, ['d', { status: 'streaming', text: 'Chưa' } as SegState]]) } as JobView;
    expect(readBlock({ ...src, job: running }, 'd', 'translation')).toEqual({ id: 'd', text: '', lang: 'vi', pending: true });
    expect(readBlock({ ...src, job: running }, 'b', 'translation')?.pending).toBeUndefined();
    expect(readBlock({ ...src, job: running }, 'd', 'original')?.pending).toBeUndefined();
    expect(readBlock({ ...src, job: { ...running, status: 'done' } as JobView }, 'd', 'translation')?.pending).toBeUndefined();
  });

  it('goes on to the next block in page order, on the same side', () => {
    expect(nextBlock(src, 'a', 'translation')).toEqual({ id: 'b', text: '', lang: 'vi' });
    expect(nextBlock(src, 'd', 'translation')).toBeUndefined();
  });
});

function speechOf(over: Partial<Speech> = {}): Speech {
  return { speaking: undefined, error: undefined, read: vi.fn(), stop: vi.fn(), ...over };
}

const q = (sel: string) => root.querySelector<HTMLElement>(sel);

describe('the block toolbar', () => {
  it('has Read aloud on a translated block, reading the translation', () => {
    const speech = speechOf();
    render(<SegmentList segments={SEGMENTS} states={JOB.segs} targetLang="vi" sourceLang="en" speech={speech} />, root);
    const button = q('[data-id="a"] [data-testid="seg-read"]');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(button?.getAttribute('aria-label')).toContain('Hello there.');
    act(() => button?.click());
    expect(speech.read).toHaveBeenCalledWith('a', 'translation');
  });

  it('reads the original of a block with no translation yet, and offers nothing on code', () => {
    const speech = speechOf();
    render(<SegmentList segments={SEGMENTS} states={JOB.segs} targetLang="vi" sourceLang="en" speech={speech} />, root);
    act(() => q('[data-id="d"] [data-testid="seg-read"]')?.click());
    expect(speech.read).toHaveBeenCalledWith('d', 'original');
    expect(q('[data-id="b"] [data-testid="seg-read"]')).toBeNull();
  });

  it('has Read original while the block shows its original', () => {
    const speech = speechOf();
    render(<SegmentList segments={SEGMENTS} states={JOB.segs} targetLang="vi" sourceLang="en" speech={speech} />, root);
    expect(q('[data-id="a"] [data-testid="seg-read-original"]')).toBeNull();
    act(() => q('[data-id="a"] [data-testid="seg-original"]')?.click());
    act(() => q('[data-id="a"] [data-testid="seg-read-original"]')?.click());
    expect(speech.read).toHaveBeenCalledWith('a', 'original');
  });

  it('marks the block being read, and its button becomes a pressed Stop', () => {
    const speech = speechOf({ speaking: { id: 'c', side: 'translation' } });
    render(<SegmentList segments={SEGMENTS} states={JOB.segs} targetLang="vi" sourceLang="en" speech={speech} />, root);
    const block = q('[data-id="c"]');
    expect(block?.classList.contains('seg--reading')).toBe(true);
    expect(block?.dataset.reading).toBe('translation');
    expect(q('[data-id="a"]')?.classList.contains('seg--reading')).toBe(false);
    const stop = q('[data-id="c"] [data-testid="seg-read-stop"]');
    expect(stop?.getAttribute('aria-pressed')).toBe('true');
    act(() => stop?.click());
    expect(speech.stop).toHaveBeenCalled();
  });

  it('has no Read aloud without a voice to offer', () => {
    render(<SegmentList segments={SEGMENTS} states={JOB.segs} targetLang="vi" />, root);
    expect(q('[data-testid="seg-read"]')).toBeNull();
  });
});

describe('the reading strip', () => {
  it('names the block being read, and Stop and Esc stop it', () => {
    const speech = speechOf({ speaking: { id: 'a', side: 'translation' } });
    act(() => render(<ReadStrip speech={speech} segments={SEGMENTS} onSettings={vi.fn()} />, root));
    expect(q('[data-testid="read-strip"]')?.textContent).toContain('Reading aloud: Hello there.');
    act(() => q('[data-testid="read-stop"]')?.click());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(speech.stop).toHaveBeenCalledTimes(2);
  });

  it('leaves an Esc that something else used', () => {
    const speech = speechOf({ speaking: { id: 'a', side: 'translation' } });
    act(() => render(<ReadStrip speech={speech} segments={SEGMENTS} onSettings={vi.fn()} />, root));
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    e.preventDefault();
    document.dispatchEvent(e);
    expect(speech.stop).not.toHaveBeenCalled();
  });

  it('says where to get a voice when none reads the language, and links to the settings', () => {
    const onSettings = vi.fn();
    render(<ReadStrip speech={speechOf({ error: { kind: 'no-voice', message: 'x', blockId: 'a' } })} segments={SEGMENTS} onSettings={onSettings} />, root);
    expect(q('[data-testid="read-error"]')?.textContent).toContain("Add a voice for it in your system's speech settings");
    act(() => q('[data-testid="read-settings"]')?.click());
    expect(onSettings).toHaveBeenCalled();
  });

  it('announces start and stop politely', () => {
    act(() => render(<ReadStrip speech={speechOf({ speaking: { id: 'a', side: 'translation' } })} segments={SEGMENTS} onSettings={vi.fn()} />, root));
    expect(q('[data-testid="read-status"]')?.textContent).toBe('Reading aloud');
    act(() => render(<ReadStrip speech={speechOf()} segments={SEGMENTS} onSettings={vi.fn()} />, root));
    expect(q('[data-testid="read-status"]')?.textContent).toBe('Stopped reading');
  });
});

describe('useReadAloud', () => {
  function Harness({ api, docId, out }: { api: ReturnType<typeof fakeDevice>['api']; docId: string; out: { speech?: Speech } }) {
    out.speech = useReadAloud(api, { segments: SEGMENTS, job: JOB, pageLang: 'en' }, docId);
    return null;
  }

  it('reads on through the translated blocks with the reader’s voice, then stops when the page changes', async () => {
    const d = fakeDevice({ sync: { tts: { engine: 'system', voices: { vi: 'Linh' }, readOn: true } } });
    const out: { speech?: Speech } = {};
    render(<Harness api={d.api} docId="d1" out={out} />, root);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
      out.speech?.read('a', 'translation');
    });
    await vi.waitFor(() => expect(spoken).toHaveLength(1));
    expect(spoken[0]).toEqual({ text: 'Xin chào.', opts: { lang: 'vi', voice: 'Linh', note: undefined } });
    expect(out.speech?.speaking).toEqual({ id: 'a', side: 'translation' });
    await act(async () => ends.shift()?.('ended'));
    await vi.waitFor(() => expect(spoken).toHaveLength(2));
    expect(spoken[1]?.text).toBe('Đoạn thứ hai.');
    await act(async () => render(<Harness api={d.api} docId="d2" out={out} />, root));
    expect(out.speech?.speaking).toBeUndefined();
    expect(spoken).toHaveLength(2);
  });
});

describe('voice prep', () => {
  const okRoute = { ok: true as const, client: { model: 'gm', reasoningReserveTokens: () => 0, stream: async function* () {} }, profile: { ...GEMINI_PROFILE, pricing: { inPerM: 1, cachedInPerM: 1, outPerM: 2 } } };

  it('uses the translate route, and counts its spend as voice prep', async () => {
    const spent: SpendDelta[] = [];
    const jobs = new Jobs({ translateClient: async () => okRoute, onSpend: (d) => spent.push(d) });
    const route = await jobs.speechClient({ tabId: 1, url: 'https://a.example/' });
    expect(route?.client.model).toBe('gm');
    route?.spend({ input: 1_000_000, cachedInput: 0, output: 0 });
    expect(spent).toEqual([{ usage: { input: 1_000_000, cachedInput: 0, output: 0 }, usd: 1, profileId: 'voice-prep', model: 'gm' }]);
  });

  it('never waits: none while the privacy notice is unanswered, past the spend limit, or with only Chrome’s Translator', async () => {
    const unanswered = { acknowledged: () => false, whenAcknowledged: vi.fn(), forget: vi.fn() };
    expect(await new Jobs({ translateClient: async () => okRoute, privacy: unanswered }).speechClient({ tabId: 1, url: 'u' })).toBeUndefined();
    expect(unanswered.whenAcknowledged).not.toHaveBeenCalled();
    expect(await new Jobs({ translateClient: async () => ({ ...okRoute, onDevice: 'nano' as const }), privacy: unanswered }).speechClient({ tabId: 1, url: 'u' })).toBeDefined();
    expect(await new Jobs({ translateClient: async () => okRoute, spendLimit: async () => ({ monthUsd: 5, limitUsd: 5 }) }).speechClient({ tabId: 1, url: 'u' })).toBeUndefined();
    expect(await new Jobs({ translateClient: async () => ({ ...okRoute, onDevice: 'translator' as const }) }).speechClient({ tabId: 1, url: 'u' })).toBeUndefined();
    expect(await new Jobs({ translateClient: async () => ({ ok: false as const, error: { kind: 'auth' as const, message: 'x' } }) }).speechClient({ tabId: 1, url: 'u' })).toBeUndefined();
  });

  it('reads the block as it is when there is no route', async () => {
    const prep = voicePrepVia({ speechClient: async () => undefined }, { tabId: 1, url: 'u' });
    expect(await prep({ text: 'Hi.', lang: 'en' })).toEqual({ text: 'Hi.' });
  });

  it('prepares each block once per page, only for a cloud voice, with its neighbours', async () => {
    const prep = vi.fn(async (input: { text: string }) => ({ text: input.text.toUpperCase(), note: 'calm' }));
    const d = fakeDevice({ sync: { tts: { engine: 'cloud', connectionId: 'tts-gemini', readOn: false } } });
    const out: { speech?: Speech } = {};
    function Harness() {
      out.speech = useReadAloud(d.api, { segments: SEGMENTS, job: JOB, pageLang: 'en' }, 'd1', { voicePrep: prep });
      return null;
    }
    render(<Harness />, root);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
      out.speech?.read('c', 'translation');
    });
    await vi.waitFor(() => expect(spoken).toHaveLength(1));
    expect(spoken[0]).toMatchObject({ text: 'ĐOẠN THỨ HAI.', opts: { note: 'calm' } });
    expect(prep).toHaveBeenCalledWith({ text: 'Đoạn thứ hai.', lang: 'vi', ahead: false, before: '', after: '' });
    await act(async () => ends.shift()?.('ended'));
    await act(async () => {
      out.speech?.read('c', 'translation');
    });
    await vi.waitFor(() => expect(spoken).toHaveLength(2));
    expect(prep).toHaveBeenCalledTimes(1);
  });

  it('prepares nothing in a language the cloud voice leaves to the system voice', async () => {
    const prep = vi.fn(async (input: { text: string }) => ({ text: input.text.toUpperCase(), note: 'calm' }));
    const d = fakeDevice({ sync: { tts: { engine: 'cloud', connectionId: 'tts-gemini', readOn: false } } });
    const out: { speech?: Speech } = {};
    function Harness() {
      out.speech = useReadAloud(d.api, { segments: SEGMENTS, job: undefined, pageLang: 'fr' }, 'd1', { voicePrep: prep });
      return null;
    }
    render(<Harness />, root);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
      out.speech?.read('a', 'original');
    });
    await vi.waitFor(() => expect(spoken).toHaveLength(1));
    expect(spoken[0]?.text).toBe('Hello there.');
    expect(prep).not.toHaveBeenCalled();
  });

  it('reads with the system voice, and prepares nothing, where the page may not go to a cloud voice', async () => {
    engineSettings.length = 0;
    const prep = vi.fn(async (input: { text: string }) => ({ text: input.text, note: 'calm' }));
    const d = fakeDevice({ sync: { tts: { engine: 'cloud', connectionId: 'tts-gemini', readOn: false } } });
    const out: { speech?: Speech } = {};
    function Harness() {
      out.speech = useReadAloud(d.api, { segments: SEGMENTS, job: JOB, pageLang: 'en' }, 'd1', { voicePrep: prep, cloudAllowed: async () => false });
      return null;
    }
    render(<Harness />, root);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
      out.speech?.read('a', 'translation');
    });
    await vi.waitFor(() => expect(spoken).toHaveLength(1));
    expect(engineSettings.at(-1)?.engine).toBe('system');
    expect(prep).not.toHaveBeenCalled();
  });

  it('builds the engine again when a voice provider is saved again', async () => {
    engineSettings.length = 0;
    const d = fakeDevice({ sync: { tts: { engine: 'system', readOn: false } } });
    const out: { speech?: Speech } = {};
    function Harness() {
      out.speech = useReadAloud(d.api, { segments: SEGMENTS, job: JOB, pageLang: 'en' }, 'd1');
      return null;
    }
    render(<Harness />, root);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
      out.speech?.read('a', 'translation');
    });
    await vi.waitFor(() => expect(spoken).toHaveLength(1));
    await act(async () => ends.shift()?.('ended'));
    await d.sync.set({ 'ttsConn:tts-openai': { presetId: 'openai', baseUrl: 'https://new.example/v1' } });
    await act(async () => {
      out.speech?.read('a', 'translation');
    });
    await vi.waitFor(() => expect(spoken).toHaveLength(2));
    expect(engineSettings).toHaveLength(2);
  });
});

describe('Jobs.localOnly', () => {
  it('says whether the page’s route is local-only, and yes when it cannot tell', async () => {
    const route = { ok: true as const, client: { model: 'm', reasoningReserveTokens: () => 0, stream: async function* () {} }, profile: GEMINI_PROFILE };
    expect(await new Jobs({ translateClient: async () => ({ ...route, localOnly: 'bank.example' }) }).localOnly({ tabId: 1, url: 'u' })).toBe(true);
    expect(await new Jobs({ translateClient: async () => route }).localOnly({ tabId: 1, url: 'u' })).toBe(false);
    expect(
      await new Jobs({
        translateClient: async () => {
          throw new Error('x');
        },
      }).localOnly({ tabId: 1, url: 'u' }),
    ).toBe(true);
  });

  it('counts the site rule even when the route cannot be resolved, and a rule it cannot read', async () => {
    const noRoute = async () => ({ ok: false as const, error: { kind: 'auth' as const, message: 'no key' } });
    expect(await new Jobs({ translateClient: noRoute, siteLocalOnly: async () => true }).localOnly({ tabId: 1, url: 'https://bank.example/' })).toBe(true);
    expect(await new Jobs({ translateClient: noRoute, siteLocalOnly: async () => Promise.reject(new Error('x')) }).localOnly({ tabId: 1, url: 'u' })).toBe(true);
    expect(await new Jobs({ translateClient: noRoute, siteLocalOnly: async () => false }).localOnly({ tabId: 1, url: 'u' })).toBe(false);
  });
});
