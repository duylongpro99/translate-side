// @vitest-environment jsdom
// The job bar on a long page in lazy mode (plan M5-E4): a Translate the rest button, in every state that has the rest waiting.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it } from 'vitest';
import { JobBar, type JobActions } from './JobBar.tsx';
import type { JobView } from './jobs.ts';

const view: JobView = { status: 'done', paused: false, model: 'm', targetLang: 'vi', sourceLang: 'en', segments: [], segs: new Map(), counts: { total: 900, final: 60, failed: 0 }, usage: { input: 0, cachedInput: 0, output: 0 }, cost: undefined, unmetered: 0, startedAt: 0, endedAt: 4000, lazy: { rest: 840 } };
const actions = (calls: string[]): JobActions => ({
  cancel: () => calls.push('cancel'),
  resume: () => calls.push('resume'),
  translateRest: () => calls.push('rest'),
  openOptions: () => calls.push('options'),
  retrySegment: () => calls.push('retry'),
  retranslateSegment: () => calls.push('retranslate'),
  explainSegment: () => calls.push('explain'),
  retranslatePage: () => calls.push('retranslate-page'),
  grantAccess: () => calls.push('grant'),
  continuePastLimit: () => calls.push('continue-limit'),
});

function bar(job: JobView, calls: string[]) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  act(() => render(<JobBar job={job} actions={actions(calls)} />, root));
  return root;
}

describe('the bar in lazy mode (M5-E4)', () => {
  it('done: says the rest comes as you read, and Translate the rest asks for all of it', () => {
    const calls: string[] = [];
    const root = bar(view, calls);
    expect(root.textContent).toContain('60 of 900 · the rest as you read');
    root.querySelector<HTMLButtonElement>('[data-testid=translate-rest]')?.click();
    expect(calls).toEqual(['rest']);
  });

  it('running: the button is there too', () => {
    const root = bar({ ...view, status: 'running' }, []);
    expect(root.querySelector('[data-testid=translate-rest]')).not.toBeNull();
  });

  it('cancelled: Translate the rest does all of it, not a lazy resume', () => {
    const calls: string[] = [];
    const root = bar({ ...view, status: 'cancelled' }, calls);
    root.querySelector<HTMLButtonElement>('[data-testid=translate-rest]')?.click();
    expect(calls).toEqual(['rest']);
  });

  it('a page with nothing waiting shows no button', () => {
    const whole: JobView = { ...view, counts: { total: 900, final: 900, failed: 0 } };
    delete whole.lazy;
    const root = bar(whole, []);
    expect(root.querySelector('[data-testid=translate-rest]')).toBeNull();
    expect(root.textContent).toContain('900 of 900 · 4.0 s');
  });
});
