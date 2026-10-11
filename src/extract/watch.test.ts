// @vitest-environment jsdom
// The change watch (plan M5-E2, §8 risk "re-render storms"): debounced, blind to site chrome,
// slower under a storm.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { watchChanges, type ChangeWatch } from './watch.ts';

let w: ChangeWatch | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `
    <nav id="top"><a>Home</a></nav>
    <aside id="side"><a class="x">Intro</a></aside>
    <main id="main"><article><header><h1 id="title">Title</h1></header><p id="p">Text</p></article></main>
    <footer id="foot">©</footer>`;
});
afterEach(() => {
  w?.stop();
  vi.useRealTimers();
});

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const $ = (id: string) => document.getElementById(id) as HTMLElement;

describe('watchChanges', () => {
  it('reads again once the content has been quiet for the settle time, once per burst', async () => {
    const fired = vi.fn();
    w = watchChanges(window, fired, { settleMs: 100, maxWaitMs: 1000 });
    $('p').textContent = 'One';
    await tick(50);
    $('p').append(document.createElement('b'));
    await tick(50);
    $('main').append(document.createElement('p'));
    await tick(99);
    expect(fired).not.toHaveBeenCalled();
    await tick(1);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('a page that never stops changing is read at least every maxWait', async () => {
    const fired = vi.fn();
    w = watchChanges(window, fired, { settleMs: 100, maxWaitMs: 300 });
    for (let i = 0; i < 10; i++) {
      $('p').textContent = `t${i}`;
      await tick(50);
    }
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('ignores changes inside site chrome (nav, sidebar, footer), which extraction drops; not a header', async () => {
    const fired = vi.fn();
    w = watchChanges(window, fired, { settleMs: 100 });
    $('side').querySelector('a')?.classList.add('active');
    ($('side').querySelector('a') as HTMLElement).textContent = 'Intro (current)';
    $('top').append(document.createElement('span'));
    $('foot').textContent = '© 2026';
    await tick(500);
    expect(fired).not.toHaveBeenCalled();
    $('title').textContent = 'New title';
    await tick(150);
    expect(fired).toHaveBeenCalledTimes(1);
    // A page-level header is read by the walk (clean.ts keeps it), so it is watched too.
    document.body.prepend(Object.assign(document.createElement('header'), { textContent: 'Late banner' }));
    await tick(150);
    expect(fired).toHaveBeenCalledTimes(2);
  });

  it('a whole-layout swap (the content replaced along with the chrome) is seen', async () => {
    const fired = vi.fn();
    w = watchChanges(window, fired, { settleMs: 100 });
    document.body.innerHTML = '<main><p>Another page</p></main>';
    await tick(150);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('a URL change with no mutation (popstate, hashchange) is seen', async () => {
    const fired = vi.fn();
    w = watchChanges(window, fired, { settleMs: 100 });
    window.dispatchEvent(new PopStateEvent('popstate'));
    await tick(150);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('slows down while every read finds a change (a ticker), and recovers when they stop', async () => {
    const fired = vi.fn();
    w = watchChanges(window, () => (fired(), w?.reported(true)), { settleMs: 100, maxWaitMs: 100, maxSettleMs: 800, stormWindowMs: 5000 });
    const times: number[] = [];
    const start = Date.now();
    for (let i = 0; i < 40; i++) {
      const before = fired.mock.calls.length;
      $('p').textContent = `tick ${i}`;
      await tick(100);
      if (fired.mock.calls.length > before) times.push(Date.now() - start);
    }
    // 4 s of a change every 100 ms: far fewer reads than 40, the gaps grow to the cap.
    expect(fired.mock.calls.length).toBeLessThan(12);
    expect((times.at(-1) ?? 0) - (times.at(-2) ?? 0)).toBeGreaterThanOrEqual(800);
  });

  it('stop() ends it', async () => {
    const fired = vi.fn();
    w = watchChanges(window, fired, { settleMs: 100 });
    $('p').textContent = 'x';
    w.stop();
    await tick(500);
    expect(fired).not.toHaveBeenCalled();
  });
});
