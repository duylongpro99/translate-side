// Stable segment ids across re-reads of one document (plan M5-E2, §3 #5). A segment's id is a hash
// of its domPath and text (segmenter.ts), so an SPA that inserts a banner above the content, or
// re-renders a list, shifts the paths and would give unchanged blocks new ids. Re-reading keeps the
// id of the earlier block with the same kind and text (in page order) for each block whose own id
// is new: the panel keeps its rows, and the job's finals and the viewport stay attached. A block
// whose text changed gets a new id: it is a new block to translate.
import type { Segment } from '@/engine/types';

const contentKey = (s: Pick<Segment, 'kind' | 'text' | 'inlineMarkup'>) => `${s.kind}\n${s.inlineMarkup}\n${s.text}`;

/**
 * Renames, in place, the segments of `next` that match a block of `prev` by content but not by id.
 * Returns the renames (new id → kept id), so maps keyed by the fresh ids can follow.
 */
export function keepIds(prev: readonly Segment[], next: Segment[]): Map<string, string> {
  const renames = new Map<string, string>();
  if (prev.length === 0) return renames;
  const nextIds = new Set(next.map((s) => s.id));
  // Earlier blocks whose id is not in the new read, by content, in page order.
  const free = new Map<string, string[]>();
  for (const s of prev) {
    if (nextIds.has(s.id)) continue;
    const key = contentKey(s);
    const list = free.get(key);
    if (list) list.push(s.id);
    else free.set(key, [s.id]);
  }
  if (free.size === 0) return renames;
  const prevIds = new Set(prev.map((s) => s.id));
  for (const s of next) {
    if (prevIds.has(s.id)) continue;
    const kept = free.get(contentKey(s))?.shift();
    if (kept === undefined) continue;
    renames.set(s.id, kept);
    s.id = kept;
  }
  return renames;
}

/** What a read shows: its blocks, in order, and the page address without its hash. */
export function readSignature(url: string, segments: readonly Segment[]): string {
  return JSON.stringify([url.replace(/#.*$/, ''), segments.map((s) => [s.id, s.kind, s.inlineMarkup, s.translate])]);
}
