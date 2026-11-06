// The selection link's sentence map (DESIGN.md §3 "Selection link"): which sentences of a block's
// translation stand for the sentences of its original that the reader selected on the page. All
// local, no model call: both sides are cut into sentences with Intl.Segmenter. When the two have as
// many sentences, they pair up in order; when the translation joined or split some, a sentence
// pairs by where it sits in its block (its share of the text), which can be off by one sentence.

/** A sentence's place in its text: [start, end) in UTF-16 code units, trailing space excluded. */
export type Span = { start: number; end: number };

/**
 * The sentences the reader touched in one block's original, as the page reports them: the first
 * and last touched (0-based) of `count`, and where those run from and to as a share (0–1) of the
 * block's text, for when the translation has another number of sentences.
 */
export interface TouchedSentences {
  first: number;
  last: number;
  count: number;
  from: number;
  to: number;
}

type SegmenterCtor = new (lang?: string, opts?: { granularity: 'sentence' }) => { segment(text: string): Iterable<{ segment: string; index: number }> };

function segmenter(lang: string | undefined): { segment(text: string): Iterable<{ segment: string; index: number }> } | undefined {
  const Ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (!Ctor) return undefined;
  try {
    return new Ctor(lang || undefined, { granularity: 'sentence' });
  } catch {
    // An unknown language tag: the default rules.
    return new Ctor(undefined, { granularity: 'sentence' });
  }
}

/**
 * The sentences of `text`, without the space between them; a text with no sentence breaker is one
 * sentence. Every whitespace character counts as a space: the segmenter would end a sentence at a
 * line break, and a page's HTML wraps its paragraphs' source lines anywhere (same length, same offsets).
 */
export function sentenceSpans(text: string, lang?: string): Span[] {
  const seg = segmenter(lang);
  const flat = text.replace(/\s/g, ' ');
  const parts = seg ? [...seg.segment(flat)] : [{ segment: flat, index: 0 }];
  const spans: Span[] = [];
  for (const { segment, index } of parts) {
    const lead = segment.length - segment.trimStart().length;
    const body = segment.trim();
    if (body.length > 0) spans.push({ start: index + lead, end: index + lead + body.length });
  }
  return spans;
}

/**
 * The sentences of `text` that the range [start, end) reaches into, or undefined when it reaches
 * none (only space between sentences).
 */
export function touchedSentences(text: string, start: number, end: number, lang?: string): TouchedSentences | undefined {
  const spans = sentenceSpans(text, lang);
  const hit = spans.map((s, i) => (s.start < end && start < s.end ? i : -1)).filter((i) => i >= 0);
  if (hit.length === 0 || text.length === 0) return undefined;
  const first = hit[0] as number;
  const last = hit[hit.length - 1] as number;
  const share = (n: number) => Math.round((n / text.length) * 1000) / 1000;
  return { first, last, count: spans.length, from: share((spans[first] as Span).start), to: share((spans[last] as Span).end) };
}

/**
 * The spans of the translation `text` that stand for the touched sentences of its original: the
 * same sentences by number when both have `count`, else those covering the same share of the text.
 * A sentence of the translation counts when at least half of it lies in that share, or when it
 * holds at least half of that share; the one at the middle of the share always counts.
 */
export function matchSentences(text: string, touched: TouchedSentences, lang?: string): Span[] {
  const spans = sentenceSpans(text, lang);
  if (spans.length === 0) return [];
  if (spans.length === touched.count) return spans.slice(touched.first, touched.last + 1);
  const len = text.length;
  const from = touched.from * len;
  const to = touched.to * len;
  const middle = (from + to) / 2;
  return spans.filter((s, i) => {
    const overlap = Math.min(s.end, to) - Math.max(s.start, from);
    if (overlap > 0 && (overlap >= (s.end - s.start) / 2 || overlap >= (to - from) / 2)) return true;
    // The middle of the share: in this sentence, or in the space after it (before the first one counts as the first).
    const next = spans[i + 1];
    return (i === 0 || middle >= s.start) && (next === undefined || middle < next.start);
  });
}
