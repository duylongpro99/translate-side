// The copied-neighbour guard (M2 round 13): a segment whose translation is (nearly) the
// translation of another passage while its source is not that passage's source. Seen live: with
// the context tail in the user message, the model answered the chunk's only segment with a
// re-translation of the tail's <source> paragraph (rust-book-ownership at 400 tokens), and the
// parser accepted it, id and all. Such a segment is not accepted; the repair round re-requests it.
//
// Similarity is the Dice coefficient over word bigrams (markers and case ignored). Calibrated on
// every eval output so far (M1, M2): the one real copy scored 0.78 with sources at 0.03; repeated
// boilerplate (same source) and short headings ("Ví dụ") are excluded by the source test and the
// length floor.

/** At or above this, two translations say the same thing. */
export const COPY_SIMILARITY = 0.6;
/** Below this, the two sources are different passages (so the same translation is a copy). */
export const DIFFERENT_SOURCE_SIMILARITY = 0.3;
/** Shorter translations (headings, labels) may legitimately repeat. */
export const COPY_MIN_WORDS = 8;

const words = (text: string): string[] => text.replace(/\[\/?link\]|[*`]/g, ' ').toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];

function bigrams(text: string): Map<string, number> {
  const w = words(text);
  const out = new Map<string, number>();
  for (let i = 1; i < w.length; i++) {
    const k = `${w[i - 1]} ${w[i]}`;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** Dice similarity of the word bigrams of `a` and `b`, 0–1 (0 when either has fewer than two words). */
export function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  let na = 0;
  let nb = 0;
  let both = 0;
  for (const n of A.values()) na += n;
  for (const [k, n] of B) {
    nb += n;
    both += Math.min(n, A.get(k) ?? 0);
  }
  return na === 0 || nb === 0 ? 0 : (2 * both) / (na + nb);
}

/** A source with its translation: a neighbour the guard compares against. */
export interface Rendered {
  source: string;
  translation: string;
}

/** Whether `translation` of `source` copies one of `neighbours` (same text, different source). */
export function copiesNeighbour(source: string, translation: string, neighbours: Iterable<Rendered>): boolean {
  if (words(translation).length < COPY_MIN_WORDS) return false;
  for (const other of neighbours) {
    if (similarity(translation, other.translation) >= COPY_SIMILARITY && similarity(source, other.source) < DIFFERENT_SOURCE_SIMILARITY) return true;
  }
  return false;
}
