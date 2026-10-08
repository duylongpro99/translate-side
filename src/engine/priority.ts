// Viewport first (DESIGN.md §3, plan M3-E1): which pending chunk starts next.
//
// The order, worked out again each time a slot frees, from the priority ids as they are now:
// 1. chunks holding a priority id, by their best rank in the priority list (on screen, top first);
// 2. then the chunks after the last chunk holding one, in page order (reading on from the screen);
// 3. then the chunks before it, in page order.
// With no priority id among the chunks this is page order, as before M3. Only chunks not started
// yet are ordered: a chunk in flight is never aborted (decision M3-D3).

/**
 * Picks the next item to start. `items[i]` lists the segment ids item i carries; `pending` are the
 * indices not started yet (non-empty). Returns one of `pending`.
 */
export function pickByPriority(items: readonly (readonly string[])[], pending: readonly number[], priority: readonly string[]): number {
  const first = pending[0];
  if (first === undefined) throw new Error('pickByPriority: nothing pending');
  if (priority.length === 0) return Math.min(...pending);
  const rank = new Map<string, number>();
  priority.forEach((id, r) => {
    if (!rank.has(id)) rank.set(id, r);
  });
  const bestRank = (i: number): number => {
    let best = Infinity;
    for (const id of items[i] ?? []) best = Math.min(best, rank.get(id) ?? Infinity);
    return best;
  };
  // The last item (started or not) holding a priority id: the reading position.
  let anchor = -1;
  for (let i = 0; i < items.length; i++) if (bestRank(i) < Infinity) anchor = i;
  let pick = first;
  let key: [number, number, number] = [Infinity, Infinity, Infinity];
  for (const i of pending) {
    const r = bestRank(i);
    const k: [number, number, number] = r < Infinity ? [0, r, i] : i > anchor ? [1, i, 0] : [2, i, 0];
    if (k[0] < key[0] || (k[0] === key[0] && (k[1] < key[1] || (k[1] === key[1] && k[2] < key[2])))) {
      key = k;
      pick = i;
    }
  }
  return pick;
}
