// The suppression window of scroll sync (plan M5 §5 decision: "source-tagged scroll events with a
// short suppression window"). A scroll one side makes because the other side asked for it is not
// the reader's own: for `windowMs` after it, scroll events on that side are tagged as echoes and
// not passed back. Each side keeps one guard for the scrolls it causes.

/** Longest a scroll event is expected to trail the scroll that caused it (one frame, plus a throttled report). */
export const SUPPRESS_MS = 250;

export interface Guard {
  /** A scroll was just made on this side's own initiative of the other side's request. */
  mark(): void;
  /** Is a scroll event now the echo of a marked scroll? */
  active(): boolean;
  /** Ms left of the window (0 when closed). */
  remaining(): number;
}

export function createGuard(now: () => number = Date.now, windowMs = SUPPRESS_MS): Guard {
  let until = -Infinity;
  return {
    mark: () => {
      until = now() + windowMs;
    },
    active: () => now() < until,
    remaining: () => Math.max(0, until - now()),
  };
}
