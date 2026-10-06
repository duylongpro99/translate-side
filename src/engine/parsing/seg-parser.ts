// Streaming `<seg>` parser (DESIGN.md §5.7 Step 3, plan M1-E3). The grammar is fixed by decision S2
// (docs/decisions/S2-seg-parser-grammar.md, "Grammar"), ported from spikes/s2/parser.mjs:
//
//   OPEN   strict `<seg id="N">`; lenient `<` WS? `seg` (WS attrs)? `>` with id="N" | id='N' | id=N,
//          any case (fix open-form); tag-shaped with no digit id (fix bad-id).
//   CLOSE  `</seg>`, or `<` WS? `/` WS? `seg` WS? `>` (fix close-form). Every other `<` is text.
//   v1     (the default, option C) every CLOSE closes; an OPEN inside a segment closes it (implicit-close).
//   v2     close-by-lookahead, for chunks whose source holds literal tags: inside a segment a CLOSE
//          closes only when what follows (after whitespace) is an OPEN of any kind, another CLOSE,
//          the end of output, or at the very end a partial tag; otherwise it is text
//          (close-in-text). An OPEN inside a segment is text (open-in-text).
//   Both   text outside segments is stray; a partial tag left at the end is stray, never segment
//          text; dup id: first wins; unknown id: dropped; out of order: accepted (reorder); end
//          inside a segment: `cut` on max_tokens, else accepted (unclosed-end), except that a v2
//          segment with a close-in-text and no later close ends at that close (the rest is stray
//          and the close-in-text fix is withdrawn).
//
// The per-chunk nonce (S2 "Literal tags in the source", form settled here, M1-E3): v2 chunks are
// sent as `<seg id="N" n="NONCE">`. The first OPEN of the output decides whether the model copied
// it. If it did ("nonce mode"), the v2 lookahead counts as a following OPEN only one carrying the
// nonce, and a CLOSE followed by another CLOSE is text (the last close of a run is the real one).
// Literal tags in the text carry no nonce, so they stay text (cases L-adjacent and L-tail). If the
// first OPEN has no nonce, the output is parsed as plain v2 (fix nonce-missing): the parse never
// depends on the model copying the nonce.
//
// Segment text is kept as is (no trimming); the caller trims at `segment.final` (S2).

import type { StopReason } from '../../llm/types.ts';

export type Grammar = 'v1' | 'v2';

export type FixKind =
  | 'open-form'
  | 'close-form'
  | 'bad-id'
  | 'close-in-text'
  | 'open-in-text'
  | 'implicit-close'
  | 'stray'
  | 'unclosed-end'
  | 'cut'
  | 'dup'
  | 'unknown'
  | 'reorder'
  | 'orphan-close'
  | 'nonce-missing';

export interface Fix {
  kind: FixKind;
  /** The segment it concerns; `null` for a bad id. */
  id?: number | null;
  detail?: string;
}

export interface ParseResult {
  /** No fixes, nothing missing, no cut. About the tags only: an empty segment can be strict. */
  strict: boolean;
  /** Closed segments by id, in arrival order, text untrimmed. */
  segs: ReadonlyMap<number, string>;
  /** Expected ids with no segment (the cut one excluded), in chunk order. */
  missing: number[];
  /** The segment open when a `max_tokens` stop came, with its partial text. */
  cut: { id: number; text: string } | null;
  fixes: Fix[];
  /** Text outside segments. */
  stray: string;
  stopReason: StopReason;
}

export interface SegParserOptions {
  grammar?: Grammar;
  /** v2 only: the nonce the chunk was sent with (wire.ts). */
  nonce?: string;
  /** Text so far of an open segment (cumulative, untrimmed). Not called for unknown or already-final ids. */
  onPartial?: (id: number, text: string) => void;
  /** A segment accepted under an expected id (untrimmed). */
  onFinal?: (id: number, text: string) => void;
}

const OPEN_STRICT = /^<seg id="(\d+)">/;
const OPEN_STRICT_NONCE = /^<seg id="(\d+)" n="([^"<>]*)">/;
/** Tag-shaped open; the id is checked separately (`<segment>` is text). */
const OPEN_LENIENT = /^<\s*seg(\s[^<>]*)?>/i;
const CLOSE_STRICT = '</seg>';
const CLOSE_LENIENT = /^<\s*\/\s*seg\s*>/i;
const ID_ATTR = /\bid\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))/i;
const NONCE_ATTR = /\bn\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)'|([^\s"'<>]+))/i;
/** Longest lenient tag the parser waits for before treating `<` as text (S2 rule 1). */
export const MAX_TAG = 40;
/** Could still become a tag. */
const PARTIAL = /^<\s*\/?\s*(s|se|seg(\s[^<>]*)?)?$/i;
const LITERAL_TAG = /<\s*\/?\s*seg(\s[^<>]*)?>/gi;

/** Tag-shaped `<seg …>` / `</seg>` strings in a text: the pre-send check and the literal-tag mismatch check (S2). */
export function literalTagCount(text: string): number {
  return text.match(LITERAL_TAG)?.length ?? 0;
}

const firstGroup = (m: RegExpExecArray | null): string | undefined => (m === null ? undefined : m.slice(1).find((g) => g !== undefined));

interface OpenTag {
  tag: string;
  id: number | null;
  /** The exact form the chunk was sent with. */
  strict: boolean;
  nonce: string | undefined;
}

function matchOpen(b: string, nonce: string | undefined): OpenTag | null {
  if (nonce !== undefined) {
    const s = OPEN_STRICT_NONCE.exec(b);
    if (s !== null) return { tag: s[0], id: Number(s[1]), strict: s[2] === nonce, nonce: s[2] };
  }
  const s = OPEN_STRICT.exec(b);
  if (s !== null) return { tag: s[0], id: Number(s[1]), strict: nonce === undefined, nonce: undefined };
  const m = OPEN_LENIENT.exec(b);
  if (m === null) return null;
  const attrs = m[1] ?? '';
  const id = firstGroup(ID_ATTR.exec(attrs));
  return { tag: m[0], id: id === undefined ? null : Number(id), strict: false, nonce: firstGroup(NONCE_ATTR.exec(attrs)) };
}

function matchClose(b: string): { tag: string; strict: boolean } | null {
  if (b.startsWith(CLOSE_STRICT)) return { tag: CLOSE_STRICT, strict: true };
  const m = CLOSE_LENIENT.exec(b);
  return m === null ? null : { tag: m[0], strict: false };
}

const isPartialTag = (b: string): boolean => b.length < MAX_TAG && !b.includes('>') && PARTIAL.test(b);

interface OpenSegment {
  id: number | null;
  text: string;
  /** v2: the last close read as text (rule 5: the real close if no later one comes). */
  lastClose?: { at: number; len: number; fix: Fix };
}

export class SegParser {
  readonly #v2: boolean;
  readonly #nonce: string | undefined;
  #nonceMode: 'unknown' | 'on' | 'off' = 'unknown';
  readonly #expected: Set<number>;
  readonly #order: number[];
  #buf = '';
  #open: OpenSegment | null = null;
  readonly #done = new Map<number, string>();
  #fixes: Fix[] = [];
  #stray = '';
  #lastId = 0;
  #cut: { id: number; text: string } | null = null;
  #ended = false;
  readonly #onPartial: (id: number, text: string) => void;
  readonly #onFinal: (id: number, text: string) => void;

  constructor(expectedIds: readonly number[], options: SegParserOptions = {}) {
    this.#v2 = options.grammar === 'v2';
    this.#nonce = this.#v2 ? options.nonce : undefined;
    this.#expected = new Set(expectedIds);
    this.#order = [...expectedIds];
    this.#onPartial = options.onPartial ?? (() => {});
    this.#onFinal = options.onFinal ?? (() => {});
  }

  push(delta: string): void {
    if (this.#ended) throw new Error('SegParser: push after end');
    this.#buf += delta;
    this.#drain(false);
  }

  end(stopReason: StopReason): ParseResult {
    if (this.#ended) throw new Error('SegParser: end called twice');
    this.#drain(true);
    this.#ended = true;
    const open = this.#open;
    if (open !== null) {
      this.#open = null;
      const lc = open.lastClose;
      if (stopReason === 'max_tokens') {
        if (open.id !== null) {
          this.#cut = { id: open.id, text: open.text };
          this.#fix('cut', { id: open.id });
        }
      } else if (lc !== undefined) {
        this.#stray += open.text.slice(lc.at + lc.len);
        this.#fixes = this.#fixes.filter((f) => f !== lc.fix);
        this.#final(open.id, open.text.slice(0, lc.at));
      } else {
        this.#fix('unclosed-end', { id: open.id });
        this.#final(open.id, open.text);
      }
    }
    if (this.#stray.trim() !== '') this.#fix('stray', { detail: this.#stray.trim().slice(0, 80) });
    const cutId = this.#cut?.id;
    const missing = this.#order.filter((id) => !this.#done.has(id) && id !== cutId);
    return {
      strict: this.#fixes.length === 0 && missing.length === 0 && this.#cut === null,
      segs: new Map(this.#done),
      missing,
      cut: this.#cut,
      fixes: this.#fixes,
      stray: this.#stray,
      stopReason,
    };
  }

  #fix(kind: FixKind, extra: Omit<Fix, 'kind'> = {}): Fix {
    const f = { kind, ...extra };
    this.#fixes.push(f);
    return f;
  }

  #final(id: number | null, text: string): void {
    if (id === null) return; // bad id: already flagged at the open, its text is dropped
    if (!this.#expected.has(id)) {
      this.#fix('unknown', { id });
      return;
    }
    if (this.#done.has(id)) {
      this.#fix('dup', { id });
      return;
    }
    if (id < this.#lastId) this.#fix('reorder', { id });
    this.#lastId = Math.max(this.#lastId, id);
    this.#done.set(id, text);
    this.#onFinal(id, text);
  }

  #text(s: string): void {
    if (s === '') return;
    const open = this.#open;
    if (open === null) {
      this.#stray += s;
      return;
    }
    open.text += s;
    if (open.id !== null && this.#expected.has(open.id) && !this.#done.has(open.id)) this.#onPartial(open.id, open.text);
  }

  #drain(final: boolean): void {
    for (;;) {
      const i = this.#buf.indexOf('<');
      if (i < 0) {
        this.#text(this.#buf);
        this.#buf = '';
        return;
      }
      this.#text(this.#buf.slice(0, i));
      const b = (this.#buf = this.#buf.slice(i));
      const close = matchClose(b);
      if (close !== null) {
        if (this.#v2 && this.#open !== null) {
          const verdict = this.#closeVerdict(b.slice(close.tag.length), final);
          if (verdict === 'wait') return;
          if (verdict === 'text') {
            const f = this.#fix('close-in-text', { id: this.#open.id });
            this.#open.lastClose = { at: this.#open.text.length, len: close.tag.length, fix: f };
            this.#text(close.tag);
            this.#buf = b.slice(close.tag.length);
            continue;
          }
        }
        if (!close.strict) this.#fix('close-form', { detail: close.tag });
        this.#close();
        this.#buf = b.slice(close.tag.length);
        continue;
      }
      const open = matchOpen(b, this.#nonce);
      if (open !== null) {
        this.#buf = b.slice(open.tag.length);
        if (this.#v2 && this.#open !== null) {
          // v2: an OPEN inside a segment is content; a missing close shows up as missing + merged.
          this.#fix('open-in-text', { id: this.#open.id });
          this.#text(open.tag);
          continue;
        }
        let strict = open.strict;
        if (this.#nonce !== undefined) {
          const copied = open.nonce === this.#nonce;
          if (this.#nonceMode === 'unknown') this.#nonceMode = copied ? 'on' : 'off';
          if (!copied && (this.#nonceMode === 'on' || !this.#fixes.some((f) => f.kind === 'nonce-missing'))) {
            this.#fix('nonce-missing', { detail: open.tag });
          }
          if (this.#nonceMode === 'off') strict = OPEN_STRICT.test(open.tag);
        }
        if (open.id === null) this.#fix('bad-id', { detail: open.tag });
        else if (!strict) this.#fix('open-form', { detail: open.tag });
        this.#startSegment(open.id);
        continue;
      }
      if (isPartialTag(b)) {
        if (!final) return;
        // A tag cut by the end of the stream (e.g. "</se"): stray, never segment text.
        this.#stray += b;
        this.#buf = '';
        return;
      }
      this.#text('<');
      this.#buf = b.slice(1);
    }
  }

  /** v2 rule 2: does a CLOSE inside a segment close it? */
  #closeVerdict(rest: string, final: boolean): 'close' | 'text' | 'wait' {
    const r = rest.replace(/^\s+/, '');
    if (r === '') return final ? 'close' : 'wait';
    if (!r.startsWith('<')) return 'text';
    const nonceOn = this.#nonceMode === 'on';
    // Any tag-shaped OPEN counts, also with an unknown, duplicate or bad id: those are flagged later
    // and make the chunk ambiguous (whole-chunk re-request), safer than merging them as text.
    // In nonce mode only an OPEN carrying the nonce counts.
    const open = matchOpen(r, this.#nonce);
    if (open !== null) return !nonceOn || open.nonce === this.#nonce ? 'close' : 'text';
    // "</seg></seg>": the first closes and the second is an orphan; in nonce mode the last one closes.
    if (matchClose(r) !== null) return nonceOn ? 'text' : 'close';
    // At the end (a max_tokens cut inside the next tag) it was a real close.
    if (isPartialTag(r)) return final ? 'close' : 'wait';
    return 'text';
  }

  #startSegment(id: number | null): void {
    if (this.#open !== null) {
      this.#fix('implicit-close', { id: this.#open.id });
      this.#final(this.#open.id, this.#open.text);
    }
    this.#open = { id, text: '' };
  }

  #close(): void {
    const open = this.#open;
    if (open === null) {
      this.#fix('orphan-close');
      return;
    }
    this.#open = null;
    this.#final(open.id, open.text);
  }
}

/** Parses a whole output at once, or in the given delta sizes (tests and replay). */
export function parseOutput(
  output: string,
  ids: readonly number[],
  stopReason: StopReason,
  options: Omit<SegParserOptions, 'onPartial' | 'onFinal'> & { deltas?: () => number } = {},
): ParseResult {
  const parser = new SegParser(ids, options);
  const next = options.deltas ?? (() => output.length || 1);
  for (let i = 0; i < output.length; ) {
    const n = Math.max(1, next());
    parser.push(output.slice(i, i + n));
    i += n;
  }
  return parser.end(stopReason);
}
