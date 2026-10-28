// Read aloud in the panel: the block toolbar's Read aloud reads a
// block's translation or its original, and with read-on the blocks after it, on the same side. The
// controller (src/tts/controller.ts) keeps one playback; this hook feeds it the panel's blocks,
// reads the Voice settings, and stops when the page on screen changes. The engines (the system
// voice's text rules, the cloud adapters) load on the first Read aloud, not with the panel.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { browser } from 'wxt/browser';
import type { Segment } from '@/engine/types';
import { createReadAloud, type Prepared, type ReadBlock, type ReadState } from '@/tts/controller';
import type { PrepareInput } from '@/tts/prepare';
import { defaultTtsSettings, readTtsSettings, voiceFor, watchTtsConnections, watchTtsSettings, type TtsSettings } from '@/tts/settings';
import type { TtsEngine } from '@/tts/types';
import type { ClientTarget, Jobs, JobView } from './jobs.ts';
import { copyText } from './SegmentList.tsx';

type Browser = typeof browser;

export type ReadSide = 'translation' | 'original';

export interface Speech {
  /** The block being read and its side; undefined when nothing is. */
  speaking: { id: string; side: ReadSide } | undefined;
  error: ReadState['error'];
  read(id: string, side: ReadSide): void;
  stop(): void;
}

export interface ReadSource {
  segments: readonly Segment[];
  job: JobView | undefined;
  /** The page's `<html lang>`: the original's language when no job named one. */
  pageLang: string | undefined;
}

/** What a voice reads for a block on one side: '' when that side has nothing to read (code, a translation not in yet). */
export function blockText(seg: Segment, side: ReadSide, job: JobView | undefined): string {
  if (seg.kind === 'code') return '';
  if (side === 'original') return seg.text;
  const state = job?.segs.get(seg.id);
  return seg.translate && state?.status === 'final' && state.text !== undefined ? copyText(seg, state) : '';
}

/** The block's translation is on its way: the job still runs and has not finished or failed it. */
function translationComing(seg: Segment, side: ReadSide, job: JobView | undefined): boolean {
  if (side !== 'translation' || seg.kind === 'code' || !seg.translate || job?.status !== 'running') return false;
  const status = job.segs.get(seg.id)?.status;
  return status === undefined || status === 'pending' || status === 'streaming';
}

export function readBlock(src: ReadSource, id: string, side: ReadSide): ReadBlock | undefined {
  const seg = src.segments.find((s) => s.id === id);
  if (!seg) return undefined;
  const lang = side === 'translation' ? (src.job?.targetLang ?? '') : src.job?.sourceLang || src.pageLang || '';
  const text = blockText(seg, side, src.job);
  return { id, text, lang, ...(!text && translationComing(seg, side, src.job) ? { pending: true } : {}) };
}

/** The block after `id` in page order, on the same side. */
export function nextBlock(src: ReadSource, id: string, side: ReadSide): ReadBlock | undefined {
  const i = src.segments.findIndex((s) => s.id === id);
  const seg = i < 0 ? undefined : src.segments[i + 1];
  return seg ? readBlock(src, seg.id, side) : undefined;
}

/** Prepares a block for a cloud voice (src/tts/prepare.ts); absent: the text is read as it is. */
export type VoicePrep = (input: PrepareInput) => Promise<Prepared>;

/** Voice prep on the page's translation route (Jobs.speechClient), the LLM step loaded only when used. */
export function voicePrepVia(jobs: Pick<Jobs, 'speechClient'>, target: ClientTarget): VoicePrep {
  return async (input) => {
    const route = await jobs.speechClient(target);
    if (!route) return { text: input.text };
    const { prepare } = await import('@/tts/prepare');
    return prepare(route.client, input, { onUsage: route.spend });
  };
}

/** The block before `id` in page order, on the same side (context for voice prep). */
export function previousBlock(src: ReadSource, id: string, side: ReadSide): ReadBlock | undefined {
  const i = src.segments.findIndex((s) => s.id === id);
  const seg = i > 0 ? src.segments[i - 1] : undefined;
  return seg ? readBlock(src, seg.id, side) : undefined;
}

export interface ReadAloudOptions {
  /** Prepares blocks for a cloud voice; absent: they are read as they are. */
  voicePrep?: VoicePrep | undefined;
  /**
   * Whether this page's text may go to a cloud voice at all: not on a never-translate site, nor on
   * a local-only one. When it says no, the system voice reads instead. Absent: yes.
   */
  cloudAllowed?: (() => Promise<boolean>) | undefined;
}

export function useReadAloud(api: Browser, src: ReadSource, docId: string | undefined, { voicePrep, cloudAllowed }: ReadAloudOptions = {}): Speech {
  const [settings, setSettings] = useState<TtsSettings>(defaultTtsSettings);
  const [state, setState] = useState<ReadState>({ status: 'idle' });
  const [side, setSide] = useState<ReadSide>('translation');
  const sideOf = useRef<ReadSide>('translation');
  const latest = useRef({ src, settings, voicePrep, cloudAllowed });
  latest.current = { src, settings, voicePrep, cloudAllowed };
  // Bumped when a voice provider or a key changes, so the next block builds its engine again.
  const providers = useRef(0);
  // Prepared text per block for this page: a replay does not call the LLM again.
  const prepared = useRef(new Map<string, Promise<Prepared>>());

  useEffect(() => {
    let live = true;
    // The reader reads `latest` between renders: it takes new settings at once, not on the next render.
    const apply = (s: TtsSettings) => {
      latest.current.settings = s;
      setSettings(s);
    };
    void readTtsSettings(api).then((s) => live && apply(s));
    const unwatch = watchTtsSettings(api, apply);
    const unwatchProviders = watchTtsConnections(api, () => providers.current++);
    return () => {
      live = false;
      unwatch();
      unwatchProviders();
    };
  }, [api]);

  const reader = useMemo(() => {
    // One engine per settings value and provider version, so a cloud engine's audio cache lives as
    // long as both, and a provider saved again (a new address or key) is never read through the old one.
    let engine: { key: string; value: Promise<TtsEngine> } | undefined;
    /** The settings to read this page with: a cloud voice only where the page's text may go to one. */
    const effective = async (): Promise<TtsSettings> => {
      const { settings, cloudAllowed: allowed } = latest.current;
      if (settings.engine !== 'cloud' || !allowed) return settings;
      return (await allowed().catch(() => false)) ? settings : { ...settings, engine: 'system', voices: {} };
    };
    let cloudNow = false;
    return createReadAloud({
      engine: async () => {
        const settings = await effective();
        cloudNow = settings.engine === 'cloud';
        const key = JSON.stringify([settings, providers.current]);
        if (engine?.key !== key) {
          const value = import('@/tts/engines').then((m) => m.engineFor(api, settings));
          const mine = { key, value };
          engine = mine;
          // A failed load is not kept: the next play tries again.
          value.catch(() => {
            if (engine === mine) engine = undefined;
          });
        }
        return engine.value;
      },
      readOn: () => latest.current.settings.readOn,
      // Only cloud voices get the LLM step (the system voice reads the rule-based text), and only
      // in a language the provider reads (the system voice reads the others).
      prepare: async (block, ahead) => {
        const { voicePrep: prep } = latest.current;
        if (!cloudNow || !prep || !engine) return { text: block.text };
        const cloudReads = await engine.value.then((e) => e.voices(block.lang)).then((vs) => vs.some((v) => v.engine === 'cloud'), () => false);
        if (!cloudReads) return { text: block.text };
        const now = latest.current.src;
        const key = JSON.stringify([block.id, block.lang, block.text]);
        let p = prepared.current.get(key);
        if (!p) {
          const side = sideOf.current;
          // Preparing only helps: a failure reads the block as it is.
          p = prep({ text: block.text, lang: block.lang, ahead, before: previousBlock(now, block.id, side)?.text, after: nextBlock(now, block.id, side)?.text }).catch(() => ({ text: block.text }));
          prepared.current.set(key, p);
          // A block read as it is (no route, a timeout) may be prepared on a later play.
          const mine = p;
          const forget = () => prepared.current.get(key) === mine && prepared.current.delete(key);
          void p.then((r) => r.note === undefined && r.text === block.text && forget());
        }
        return p;
      },
      voiceFor: (lang) => voiceFor(latest.current.settings, lang),
      onChange: setState,
    });
  }, [api]);

  // A new page (or the panel closing) ends the reading and forgets the prepared text.
  useEffect(
    () => () => {
      reader.stop();
      prepared.current.clear();
    },
    [reader, docId],
  );

  return {
    speaking: state.status === 'reading' && state.blockId !== undefined ? { id: state.blockId, side } : undefined,
    error: state.error,
    read(id, s) {
      const first = readBlock(latest.current.src, id, s);
      if (!first) return;
      setSide(s);
      sideOf.current = s;
      void reader.play(first, (after) => nextBlock(latest.current.src, after, s));
    },
    stop: () => reader.stop(),
  };
}
