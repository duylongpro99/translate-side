// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDiagnosticsLog, DIAG_SITES_KEY, type JobRecord } from '@/shared/diagnostics';
import { fakeDevice } from '@/shared/testing';
import { DiagnosticsSection } from './Diagnostics.tsx';

const flush = async () => {
  for (let i = 0; i < 20; i++) await act(() => new Promise((r) => setTimeout(r, 0)));
};
let root: HTMLElement;
const q = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = async (id: string) => {
  await act(() => q(id)?.click());
  await flush();
};

let downloaded: string[];
beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
  downloaded = [];
  URL.createObjectURL = ((b: Blob) => (b.text().then((t) => downloaded.push(t)), 'blob:x')) as never;
  URL.revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = () => undefined;
});

const record = (startedAt: number): JobRecord => ({
  id: `${startedAt}-abc`,
  startedAt,
  endedAt: startedAt + 2000,
  outcome: 'done',
  strategy: 'contextual',
  promptIds: ['translate@1'],
  model: 'mock-model',
  lazy: false,
  segments: 12,
  cached: 0,
  chunks: 2,
  calls: 3,
  tokens: { input: 900, cachedInput: 0, output: 600 },
  failed: 0,
  errors: [],
  origin: 'https://news.example.com',
});

describe('DiagnosticsSection', () => {
  it('shows the whole file before saving it, and leaves site names out when unticked', async () => {
    const t = fakeDevice({ local: { [DIAG_SITES_KEY]: true } });
    await createDiagnosticsLog(t.api).record(record(1000));
    render(<DiagnosticsSection api={t.api} now={() => 5000} />, root);
    await flush();
    expect(q('diag-count')?.textContent).toBe('1 entry.');
    expect((q('diag-sites') as HTMLInputElement).checked).toBe(true);

    await click('diag-review');
    expect(q('diag-export')?.textContent).toContain('Nothing is sent automatically. Share this file privately.');
    expect(q('diag-preview')?.textContent).toContain('"model": "mock-model"');
    expect(q('diag-preview')?.textContent).toContain('news.example.com');
    await act(() => q('diag-export-sites')?.click());
    await flush();
    expect(q('diag-preview')?.textContent).not.toContain('news.example.com');

    const shown = q('diag-preview')?.textContent;
    await click('diag-save');
    expect(downloaded).toEqual([shown]);
    expect(q('diag-note')?.textContent).toBe('Saved. Nothing was sent.');
  });

  it('turns site names on for new entries, and clears the log', async () => {
    const t = fakeDevice();
    await createDiagnosticsLog(t.api).record(record(1000));
    render(<DiagnosticsSection api={t.api} />, root);
    await flush();
    await act(() => q('diag-sites')?.click());
    await flush();
    expect(t.local.data.get(DIAG_SITES_KEY)).toBe(true);

    await click('diag-clear');
    expect([...t.local.data.keys()]).toEqual([DIAG_SITES_KEY]);
    expect(q('diag-count')?.textContent).toBe('0 entries.');
    expect((q('diag-review') as HTMLButtonElement).disabled).toBe(true);
  });
});
