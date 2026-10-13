// @vitest-environment jsdom
// The inline editor of a block (the translation memory): keyboard and screen-reader use, the
// warning for lost code spans, links and numbers, the edited and imported markers, and the
// "Replace your edit?" step before an edited block's Retranslate.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment } from '@/engine/index';
import { JobBar, type JobActions } from './JobBar.tsx';
import type { JobView, SegState } from './jobs.ts';
import { lostInEdit, SegmentList } from './SegmentList.tsx';

const seg = (id: string, kind: Segment['kind'], text: string, inlineMarkup = text): Segment => ({ id, kind, text, inlineMarkup, domPath: `/x[${id}]`, translate: kind !== 'code' });
const segments: Segment[] = [seg('a', 'p', 'Run npm test on 3 files', 'Run `npm test` on 3 files'), seg('b', 'p', 'Second paragraph'), seg('c', 'code', 'let x = 1;'), seg('d', 'p', 'Still coming'), seg('e', 'p', 'Imported one')];
const base = (): Map<string, SegState> =>
  new Map<string, SegState>([
    ['a', { status: 'final', text: 'Chạy `npm test` trên 3 tệp', revision: 1 }],
    ['b', { status: 'final', text: 'Đoạn thứ hai', revision: 1, edited: 'user' }],
    ['d', { status: 'streaming', text: 'Đang' }],
    ['e', { status: 'final', text: 'Đã nhập', revision: 1, edited: 'import' }],
  ]);

let root: HTMLDivElement;
const actions = { retry: vi.fn(), retranslate: vi.fn(), explain: vi.fn(), edit: vi.fn(), discardEdit: vi.fn() };
const draw = async (states = base()) => {
  await act(() => render(<SegmentList segments={segments} states={states} actions={actions} targetLang="vi" sourceLang="en" />, root));
};
const block = (id: string) => root.querySelector<HTMLElement>(`[data-id="${id}"]`) as HTMLElement;
const within = (id: string, testId: string) => block(id).querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const key = async (el: Element, k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  await act(() => void el.dispatchEvent(e));
  return e;
};
const type = async (area: HTMLTextAreaElement, text: string) => {
  area.value = text;
  await act(() => void area.dispatchEvent(new Event('input', { bubbles: true })));
};
const open = async (id: string) => {
  await act(() => within(id, 'seg-edit')?.click());
  return within(id, 'seg-edit-text') as HTMLTextAreaElement;
};

beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
  Object.values(actions).forEach((f) => f.mockClear());
  Element.prototype.scrollIntoView = () => undefined;
  window.scrollBy = (() => undefined) as never;
});

describe('the Edit action', () => {
  it('is on finished translated blocks only, named after the block', async () => {
    await draw();
    expect(within('a', 'seg-edit')?.getAttribute('aria-label')).toBe('Edit: "Run npm test on 3 files"');
    expect(within('c', 'seg-edit')).toBeNull();
    expect(within('d', 'seg-edit')).toBeNull();
  });

  it('opens a labelled editor with the shown text, light markers included, and focuses it', async () => {
    await draw();
    const area = await open('a');
    expect(area.value).toBe('Chạy `npm test` trên 3 tệp');
    expect(area.getAttribute('aria-label')).toBe('Your translation of "Run npm test on 3 files"');
    expect(area.lang).toBe('vi');
    expect(document.activeElement).toBe(area);
    const hint = document.getElementById(area.getAttribute('aria-describedby')?.split(' ')[0] ?? '');
    expect(hint?.textContent).toContain('Esc cancels');
    // The block's other actions step aside while it is edited.
    expect(within('a', 'seg-retranslate')).toBeNull();
  });

  it('keeps the list keys out of the text field', async () => {
    await draw();
    const area = await open('a');
    for (const k of ['j', 'k', 'r', 'e', 'c', 'o', 'ArrowDown', 'Home']) expect((await key(area, k)).defaultPrevented).toBe(false);
    expect(actions.retranslate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(area);
  });

  it('Ctrl+Enter or Cmd+Enter saves; the editor closes and focus goes back to the block', async () => {
    await draw();
    let area = await open('a');
    await type(area, 'Chạy `npm test` với 3 tệp');
    await key(area, 'Enter', { ctrlKey: true });
    expect(actions.edit).toHaveBeenCalledWith('a', 'Chạy `npm test` với 3 tệp');
    expect(within('a', 'seg-editor')).toBeNull();
    expect(document.activeElement).toBe(block('a'));

    area = await open('a');
    await key(area, 'Enter', { metaKey: true });
    expect(actions.edit).toHaveBeenCalledTimes(2);
  });

  it('Esc or Cancel closes without saving, focus back on the block', async () => {
    await draw();
    const area = await open('a');
    await type(area, 'changed');
    const e = await key(area, 'Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(within('a', 'seg-editor')).toBeNull();
    expect(document.activeElement).toBe(block('a'));
    await open('a');
    await act(() => within('a', 'seg-edit-cancel')?.click());
    expect(within('a', 'seg-editor')).toBeNull();
    expect(actions.edit).not.toHaveBeenCalled();
  });

  it('warns when the text lost a code span or a number of the source, and still saves', async () => {
    await draw();
    const area = await open('a');
    expect(within('a', 'seg-edit-warning')?.textContent).toBe('');
    await type(area, 'Chạy kiểm thử trên vài tệp');
    const warning = within('a', 'seg-edit-warning') as HTMLElement;
    expect(warning.textContent).toBe('Your text may have lost something the original has: code spans, numbers. You can still save it.');
    expect(area.getAttribute('aria-describedby')).toContain(warning.id);
    await act(() => within('a', 'seg-edit-save')?.click());
    expect(actions.edit).toHaveBeenCalledWith('a', 'Chạy kiểm thử trên vài tệp');
  });

  it('cannot save an empty text', async () => {
    await draw();
    const area = await open('a');
    await type(area, '   ');
    expect((within('a', 'seg-edit-save') as HTMLButtonElement).disabled).toBe(true);
    await key(area, 'Enter', { ctrlKey: true });
    expect(actions.edit).not.toHaveBeenCalled();
  });
});

describe('edited blocks', () => {
  it('show an "edited" or a distinct "imported" marker', async () => {
    await draw();
    expect(within('b', 'seg-edited')?.textContent).toBe('Edited');
    expect(block('b').dataset.edited).toBe('user');
    expect(within('e', 'seg-imported')?.textContent).toBe('Imported');
    expect(within('e', 'seg-edited')).toBeNull();
    expect(block('e').dataset.edited).toBe('import');
    expect(block('a').dataset.edited).toBeUndefined();
  });

  it('say when the edit could not be saved for later', async () => {
    const states = base();
    states.set('b', { status: 'final', text: 'x', edited: 'user', editUnsaved: true });
    await draw(states);
    expect(within('b', 'seg-edit-unsaved')?.textContent).toContain('could not be saved');
  });

  it('Retranslate asks "Replace your edit?" first; Keep it leaves the edit, Replace discards it', async () => {
    await draw();
    await act(() => within('b', 'seg-retranslate')?.click());
    const dialog = within('b', 'seg-replace-confirm') as HTMLElement;
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Replace your edit?');
    expect(document.activeElement).toBe(within('b', 'seg-replace-no'));
    expect(actions.retranslate).not.toHaveBeenCalled();
    await act(() => within('b', 'seg-replace-no')?.click());
    expect(within('b', 'seg-replace-confirm')).toBeNull();
    expect(document.activeElement).toBe(block('b'));
    expect(actions.discardEdit).not.toHaveBeenCalled();

    // The R key opens it too; Esc keeps the edit.
    await act(() => block('b').focus());
    await key(block('b'), 'r');
    expect(within('b', 'seg-replace-confirm')).not.toBeNull();
    await key(within('b', 'seg-replace-no') as HTMLElement, 'Escape');
    expect(within('b', 'seg-replace-confirm')).toBeNull();

    await act(() => within('b', 'seg-retranslate')?.click());
    await act(() => within('b', 'seg-replace-yes')?.click());
    expect(actions.discardEdit).toHaveBeenCalledWith('b');
    expect(actions.retranslate).not.toHaveBeenCalled();
  });

  it('an imported one asks "Replace the imported translation?"', async () => {
    await draw();
    await act(() => within('e', 'seg-retranslate')?.click());
    expect(within('e', 'seg-replace-confirm')?.textContent).toContain('Replace the imported translation?');
  });

  it('a block that is not edited retranslates at once', async () => {
    await draw();
    await act(() => within('a', 'seg-retranslate')?.click());
    expect(actions.retranslate).toHaveBeenCalledWith('a');
    expect(within('a', 'seg-replace-confirm')).toBeNull();
  });
});

describe('lostInEdit', () => {
  it('names lost links, code spans, web addresses and numbers, not emphasis', () => {
    expect(lostInEdit('See [link]the docs[/link]', 'Xem tài liệu', 'vi')).toEqual(['links']);
    expect(lostInEdit('Run `x` now', 'Chạy ngay', 'vi')).toEqual(['code spans']);
    expect(lostInEdit('Go to https://a.example/x', 'Đi tới trang', 'vi')).toEqual(['web addresses']);
    expect(lostInEdit('It is *very* good', 'Nó rất tốt', 'vi')).toEqual([]);
    expect(lostInEdit('Pay 12 dollars', 'Trả 12 đô la', 'vi')).toEqual([]);
  });
});

describe('the job bar after Retranslate page', () => {
  it('says how many edited blocks it kept, while running and when done', async () => {
    const view: JobView = { status: 'running', paused: false, model: 'm', targetLang: 'vi', sourceLang: 'en', segments: [], segs: new Map(), counts: { total: 3, final: 2, failed: 0 }, usage: { input: 0, cachedInput: 0, output: 0 }, cost: undefined, unmetered: 0, startedAt: 0, editsKept: 2 };
    const noop = () => undefined;
    const bar: JobActions = { cancel: noop, resume: noop, translateRest: noop, openOptions: noop, retrySegment: noop, retranslateSegment: noop, explainSegment: noop, retranslatePage: noop, grantAccess: noop, continuePastLimit: noop };
    await act(() => render(<JobBar job={view} actions={bar} />, root));
    expect(root.querySelector('[data-testid="job-edits-kept"]')?.textContent).toBe('2 edited blocks kept');
    await act(() => render(<JobBar job={{ ...view, status: 'done', endedAt: 1, editsKept: 1 }} actions={bar} />, root));
    expect(root.querySelector('[data-testid="job-edits-kept"]')?.textContent).toBe('1 edited block kept');
  });
});
