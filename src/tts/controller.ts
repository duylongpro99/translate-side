// The read-aloud controller: one playback at a time, the "now reading" block, and read-on (when a
// block ends, the next one starts, unless the reader turned read-on off in Settings › Voice). It
// knows nothing about the panel: the caller hands it the first block and a way to find the next
// one, so blocks translated after playback started are read too. The panel calls stop() when its
// page changes.
import { isTtsError } from './errors.ts';
import type { Playback, SpeakOptions, TtsEngine, TtsErrorKind } from './types.ts';

export interface ReadBlock {
  id: string;
  text: string;
  /** BCP 47. */
  lang: string;
  /** Its text is not in yet but is on its way (a translation still running): read-on waits for it. */
  pending?: boolean;
}

export interface ReadState {
  status: 'idle' | 'reading';
  /** The block being read. */
  blockId?: string;
  /** Why the last playback failed, and on which block. */
  error?: { kind: TtsErrorKind; message: string; blockId: string };
}

/** What a voice reads for a block: the text, and a delivery note for voices that take one. */
export interface Prepared {
  text: string;
  note?: string;
}

export interface ReadAloudDeps {
  engine: () => TtsEngine | Promise<TtsEngine>;
  /** Read the following blocks when one ends (Settings › Voice, on by default). */
  readOn: () => boolean;
  /** The reader's voice for a language, if they picked one. */
  voiceFor?: (lang: string) => string | undefined;
  /** Prepares a block before a cloud voice reads it (prepare.ts); the text as it is when absent. `ahead`: while the block before it plays. */
  prepare?: (block: ReadBlock, ahead: boolean) => Promise<Prepared>;
  onChange: (state: ReadState) => void;
  /** Waits before read-on looks again at a block whose text is not in yet (default 250 ms). */
  wait?: () => Promise<void>;
}

export interface ReadAloud {
  /** Stops whatever is playing and reads `first`, then (with read-on) each block `next` returns. */
  play(first: ReadBlock, next: (afterId: string) => ReadBlock | undefined): Promise<void>;
  /** Idempotent. */
  stop(): void;
  readonly state: ReadState;
}

export function createReadAloud(deps: ReadAloudDeps): ReadAloud {
  let state: ReadState = { status: 'idle' };
  let run = 0;
  let current: Playback | undefined;

  const set = (next: ReadState) => {
    state = next;
    deps.onChange(state);
  };

  const prepare = (block: ReadBlock, ahead = false): Promise<Prepared> => (deps.prepare ? deps.prepare(block, ahead) : Promise.resolve({ text: block.text }));
  const optionsFor = (block: ReadBlock, prepared: Prepared): SpeakOptions => ({ lang: block.lang, voice: deps.voiceFor?.(block.lang), note: prepared.note });

  const wait = deps.wait ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 250)));

  /** The next block with something to read now, skipping empty ones; undefined at a block still on its way. */
  const ready = (from: ReadBlock, next: (id: string) => ReadBlock | undefined) => {
    let b = next(from.id);
    while (b && !b.pending && !b.text.trim()) b = next(b.id);
    return b?.pending ? undefined : b;
  };

  /** The next block with something to read, waiting for one still on its way, skipping empty ones (code, a failed block). */
  const following = async (from: ReadBlock, next: (id: string) => ReadBlock | undefined, mine: number) => {
    let prev = from.id;
    for (;;) {
      const b = next(prev);
      if (!b) return undefined;
      if (b.pending) {
        await wait();
        if (mine !== run) return undefined;
        continue;
      }
      if (b.text.trim()) return b;
      prev = b.id;
    }
  };

  return {
    get state() {
      return state;
    },

    stop() {
      run++;
      current?.stop();
      current = undefined;
      if (state.status !== 'idle') set({ status: 'idle' });
    },

    async play(first, next) {
      this.stop();
      const mine = ++run;
      let block: ReadBlock | undefined = first.text.trim() ? first : await following(first, next, mine);
      // The next block, prepared while this one plays; used only if it is still that block with that text.
      let ahead: { id: string; text: string; lang: string; prepared: Promise<Prepared> } | undefined;
      while (block) {
        set({ status: 'reading', blockId: block.id });
        try {
          const engine = await deps.engine();
          const b = block;
          const early = ahead && ahead.id === b.id && ahead.text === b.text && ahead.lang === b.lang ? ahead.prepared : undefined;
          ahead = undefined;
          const prepared = await (early ?? prepare(b));
          if (mine !== run) return;
          current = engine.speak(prepared.text, optionsFor(b, prepared));
          // Cloud voices fetch the next block's audio while this one plays (one already in).
          const upcoming = deps.readOn() ? ready(b, next) : undefined;
          if (upcoming && engine.prefetch) {
            const target = upcoming;
            const p = prepare(target, true);
            ahead = { id: target.id, text: target.text, lang: target.lang, prepared: p };
            p.then((r) => mine === run && engine.prefetch?.(r.text, optionsFor(target, r))).catch(() => {});
          }
          const end = await current.done;
          if (mine !== run) return;
          // Cut short from outside (another page or extension used Chrome's speech): reading is over.
          if (end === 'stopped') break;
        } catch (e) {
          if (mine !== run) return;
          current = undefined;
          set({ status: 'idle', error: { kind: isTtsError(e) ? e.kind : 'unknown', message: e instanceof Error ? e.message : String(e), blockId: block.id } });
          return;
        }
        if (!deps.readOn()) break;
        block = await following(block, next, mine);
      }
      if (mine === run) {
        current = undefined;
        set({ status: 'idle' });
      }
    },
  };
}
