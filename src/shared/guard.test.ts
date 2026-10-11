import { describe, expect, it } from 'vitest';
import { createGuard, SUPPRESS_MS } from './guard.ts';

describe('the suppression window', () => {
  it('is closed until a scroll is marked, open for the window after it, then closed again', () => {
    let t = 1000;
    const guard = createGuard(() => t);
    expect(guard.active()).toBe(false);
    guard.mark();
    expect(guard.active()).toBe(true);
    t += SUPPRESS_MS - 1;
    expect(guard.active()).toBe(true);
    t += 1;
    expect(guard.active()).toBe(false);
  });

  it('a new mark extends the window from then on', () => {
    let t = 0;
    const guard = createGuard(() => t, 100);
    guard.mark();
    t = 90;
    guard.mark();
    t = 180;
    expect(guard.active()).toBe(true);
    t = 190;
    expect(guard.active()).toBe(false);
  });
});
