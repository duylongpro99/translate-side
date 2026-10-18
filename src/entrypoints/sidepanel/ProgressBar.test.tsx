// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import type { JobView } from './jobs.ts';
import { ProgressBar } from './ProgressBar.tsx';

let root: HTMLDivElement;
const job = (status: JobView['status'], final: number, total: number) => ({ status, counts: { final, total, failed: 0 } }) as unknown as JobView;
const draw = (j: JobView | undefined) => act(() => render(<ProgressBar job={j} />, root));

beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

describe('ProgressBar', () => {
  it('is a labelled progressbar of done blocks while running', async () => {
    await draw(job('running', 3, 12));
    const bar = root.querySelector('[role=progressbar]') as HTMLElement;
    expect(bar.getAttribute('aria-label')).toBe('Translation progress');
    expect([bar.getAttribute('aria-valuemin'), bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')]).toEqual(['0', '3', '12']);
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('25%');
  });

  it('is gone at once when the job is not running, and for no job', async () => {
    for (const status of ['done', 'cancelled', 'stopped', 'skipped'] as const) {
      await draw(job(status, 12, 12));
      expect(root.innerHTML).toBe('');
    }
    await draw(undefined);
    expect(root.innerHTML).toBe('');
  });

  it('shows an empty bar for a job with nothing counted yet', async () => {
    await draw(job('running', 0, 0));
    expect((root.querySelector('.progress__fill') as HTMLElement).style.width).toBe('0%');
  });
});
