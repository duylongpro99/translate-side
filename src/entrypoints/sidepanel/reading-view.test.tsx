// @vitest-environment jsdom
// The reading view: block states, language and direction per block, and the reading settings on the region.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '@/engine/index';
import type { SegState } from './jobs.ts';
import { SegmentList } from './SegmentList.tsx';

const seg = (id: string, kind: Segment['kind'] = 'p'): Segment => ({ id, kind, text: `Source ${id}`, inlineMarkup: `Source ${id}`, domPath: `/p[${id}]`, translate: kind !== 'code' });
const segments = [seg('a'), seg('b'), seg('c'), seg('d')];
let root: HTMLDivElement;
const block = (id: string) => root.querySelector<HTMLElement>(`[data-id="${id}"]`) as HTMLElement;
const draw = (props: Partial<Parameters<typeof SegmentList>[0]>) =>
  act(() => render(<SegmentList segments={segments} targetLang="vi" sourceLang="en" actions={{ retry: vi.fn() }} {...props} />, root));

beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

describe('block states', () => {
  const states = new Map<string, SegState>([
    ['a', { status: 'final', text: 'Một', revision: 1 }],
    ['b', { status: 'streaming', text: 'Đang' }],
    ['c', { status: 'pending' }],
    ['d', { status: 'pending', text: 'Bản cũ' }],
  ]);

  it('a pending block shows its original in the source language; one keeping its old text shows it in the target language', async () => {
    await draw({ states });
    expect(block('c').getAttribute('data-status')).toBe('pending');
    expect(block('c').querySelector('[lang="en"]')?.textContent).toBe('Source c');
    expect(block('c').hasAttribute('lang')).toBe(false);
    expect(block('d').querySelector('[lang="vi"]')?.textContent).toBe('Bản cũ');
    expect(block('d').getAttribute('lang')).toBe('vi');
  });

  it('a streaming block ends in a still caret hidden from screen readers; a final one has none', async () => {
    await draw({ states });
    const caret = block('b').querySelector('.seg__caret');
    expect(caret?.getAttribute('aria-hidden')).toBe('true');
    expect(block('b').lastElementChild === caret || block('b').querySelector('.seg__caret + *') === null).toBe(true);
    expect(block('a').querySelector('.seg__caret')).toBeNull();
  });

  it('a failed block holds a danger notice with its Retry, as a note rather than an alert', async () => {
    await draw({ states: new Map([['a', { status: 'failed', error: { kind: 'rate_limit', message: '429' } }]]) });
    const notice = block('a').querySelector('.ui-notice--danger');
    expect(notice?.getAttribute('role')).toBe('note');
    expect(notice?.querySelector('[data-testid=segment-retry]')).not.toBeNull();
  });

  it('the refined marker is a word, not a dot', async () => {
    await draw({ states: new Map([['a', { status: 'final', text: 'Một', revision: 3, refined: true }]]) });
    expect(block('a').querySelector('[data-testid=seg-refined]')?.textContent).toBe('Refined');
  });

  it('the toolbar buttons are icons that keep their word for screen readers and tests', async () => {
    await draw({ states: new Map([['a', { status: 'final', text: 'Một', revision: 1 }]]), actions: { retry: vi.fn(), retranslate: vi.fn(), explain: vi.fn() } });
    const copy = block('a').querySelector('[data-testid=seg-copy]');
    expect(copy?.classList.contains('seg__action--icon')).toBe(true);
    // With no state the name is aria-label only; a state ("Copied") is said as hidden text too.
    expect(copy?.textContent).toBe('');
    expect(copy?.getAttribute('aria-label')).toBe('Copy: "Source a"');
    expect(copy?.getAttribute('title')).toBe('Copy');
    expect(block('a').querySelector('[data-testid=seg-retranslate]')?.classList.contains('seg__action--retranslate')).toBe(true);
  });
});

describe('language and direction', () => {
  const done = new Map<string, SegState>([
    ['a', { status: 'final', text: 'واحد', revision: 1 }],
    ['b', { status: 'pending' }],
  ]);

  it('an Arabic target runs the list right to left, and each translated block carries lang and dir itself', async () => {
    await draw({ states: done, targetLang: 'ar' });
    const region = root.querySelector('.segments') as HTMLElement;
    expect(region.getAttribute('dir')).toBe('rtl');
    expect(block('a').getAttribute('lang')).toBe('ar');
    expect(block('a').getAttribute('dir')).toBe('rtl');
    // The English original still waiting runs left to right inside it.
    expect(block('b').getAttribute('dir')).toBe('ltr');
  });

  it('a Hebrew target with a region subtag is right to left too; a Vietnamese one sets no direction', async () => {
    await draw({ states: done, targetLang: 'he-IL' });
    expect(root.querySelector('.segments')?.getAttribute('dir')).toBe('rtl');
    // A new target comes with a new job, so new block states.
    await draw({ states: new Map([...done].map(([k, v]) => [k, { ...v }])), targetLang: 'vi' });
    // No direction (Preact leaves an empty dir="" behind when it removes one, which means the same).
    expect(root.querySelector('.segments')?.getAttribute('dir') || null).toBeNull();
    expect(block('a').getAttribute('dir') || null).toBeNull();
  });

  it('an Arabic source shows its original right to left', async () => {
    await draw({ states: new Map([['a', { status: 'final', text: 'One', revision: 1 }]]), targetLang: 'en', sourceLang: 'ar' });
    await act(() => block('a').querySelector<HTMLButtonElement>('[data-testid=seg-original]')?.click());
    const original = block('a').querySelector('[data-testid=seg-original-text]');
    expect(original?.getAttribute('lang')).toBe('ar');
    expect(original?.getAttribute('dir')).toBe('rtl');
  });
});

describe('reading settings on the region', () => {
  it('sets the typeface, size, line width and the waiting label, defaulting to sans 16 medium', async () => {
    await draw({});
    const region = root.querySelector('.segments') as HTMLElement;
    expect(region.dataset.typeface).toBe('sans');
    expect(region.style.getPropertyValue('--reading-size')).toBe('16px');
    expect(region.style.getPropertyValue('--reading-measure')).toBe('40em');
    expect(region.style.getPropertyValue('--waiting-label')).toBe('"Waiting"');
    await draw({ reading: { theme: 'paper', typeface: 'serif', size: 20, width: 'full' } });
    expect(region.dataset.typeface).toBe('serif');
    expect(region.style.getPropertyValue('--reading-size')).toBe('20px');
    expect(region.style.getPropertyValue('--reading-measure')).toBe('none');
    await draw({ reading: { theme: 'paper', typeface: 'serif', size: 20, width: 'narrow' } });
    expect(region.style.getPropertyValue('--reading-measure')).toBe('34em');
  });
});
