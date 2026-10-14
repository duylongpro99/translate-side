// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_MEMORY_ENTRIES, MAX_MEMORY_IMPORT_BYTES, MEMORY_FORMAT, memoryKey, openTranslationMemory, type MemoryEdit, type TranslationMemory } from '@/shared/memory';
import { fakeDevice } from '@/shared/testing';
import { MEMORY_ACROSS_SITES_KEY } from '@/shared/memory';
import { MemorySection } from './Memory.tsx';

const flush = async () => {
  for (let i = 0; i < 30; i++) await act(() => new Promise((r) => setTimeout(r, 0)));
};
let root: HTMLElement;
const q = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement;
const click = async (id: string) => {
  await act(() => q(id).click());
  await flush();
};
const pick = async (text: string, size?: number) => {
  const input = q('memory-file') as HTMLInputElement;
  const file = new File([text], 'memory.json', { type: 'application/json' });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(() => void input.dispatchEvent(new Event('change', { bubbles: true })));
  await flush();
};

let downloaded: string[];
let names: string[];
beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
  downloaded = [];
  names = [];
  URL.createObjectURL = ((b: Blob) => (b.text().then((t) => downloaded.push(t)), 'blob:x')) as never;
  URL.revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    names.push(this.download);
  };
});

const newMemory = () => openTranslationMemory({ factory: new IDBFactory() }) as TranslationMemory;
const edit = (over: Partial<MemoryEdit> = {}): MemoryEdit => ({ source: 'Sign in', target: 'Đăng nhập', sourceLang: 'en', targetLang: 'vi', origin: 'https://a.example', localOnly: false, ...over });
const file = (entries: unknown[]) => JSON.stringify({ format: MEMORY_FORMAT, formatVersion: 1, entries });

describe('MemorySection: use corrections from other sites', () => {
  it('is off by default, saved on the device when ticked, and shown ticked when it is on', async () => {
    const t = fakeDevice();
    render(<MemorySection memory={newMemory()} api={t.api} />, root);
    await flush();
    const box = q('memory-across-sites') as HTMLInputElement;
    expect(box.checked).toBe(false);
    await click('memory-across-sites');
    expect(t.local.data.get(MEMORY_ACROSS_SITES_KEY)).toBe(true);
    await click('memory-across-sites');
    expect(t.local.data.get(MEMORY_ACROSS_SITES_KEY)).toBe(false);

    const on = fakeDevice({ local: { [MEMORY_ACROSS_SITES_KEY]: true } });
    render(<MemorySection memory={newMemory()} api={on.api} />, root);
    await flush();
    expect((q('memory-across-sites') as HTMLInputElement).checked).toBe(true);
  });

  it('is not shown without a place to keep it', async () => {
    render(<MemorySection memory={newMemory()} />, root);
    await flush();
    expect(root.querySelector('[data-testid="memory-across-sites"]')).toBeNull();
  });
});

describe('MemorySection', () => {
  it('shows the count of the cap, and exports the memory to its own file', async () => {
    const memory = newMemory();
    await memory.put(edit());
    render(<MemorySection memory={memory} />, root);
    await flush();
    expect(q('memory-stats').textContent).toBe(`1 of ${MAX_MEMORY_ENTRIES.toLocaleString('en-US')} corrections.`);
    await click('memory-export');
    await flush();
    expect(names[0]).toMatch(/^translate-side-memory-\d{4}-\d{2}-\d{2}\.json$/);
    expect(JSON.parse(downloaded[0] as string)).toMatchObject({ format: MEMORY_FORMAT, formatVersion: 1, entries: [{ source: 'Sign in', target: 'Đăng nhập' }] });
    expect(q('memory-note').textContent).toBe('Corrections exported: 1.');
  });

  it('warns when the export is larger than an import accepts', async () => {
    const memory = { ...newMemory(), exportFile: () => Promise.resolve({ json: '{}', count: 5000, bytes: 12 * 1024 * 1024 }) };
    render(<MemorySection memory={memory} />, root);
    await flush();
    await click('memory-export');
    const note = q('memory-note');
    expect(note.textContent).toBe('Corrections exported: 5,000. The file is 12.0 MB, more than the 10.0 MB an import accepts, so it cannot be imported again as it is.');
    expect(note.className).toContain('warn');
  });

  it('previews an import with its valid and skipped counts, and imports examples only unless ticked', async () => {
    const memory = newMemory();
    render(<MemorySection memory={memory} />, root);
    await flush();
    await pick(file([{ source: 'Pay 120 dollars', target: 'Trả 120 đô la', targetLang: 'vi' }, { source: 'Pay 5 dollars', target: 'Trả đô la', targetLang: 'vi' }, { nope: true }]));
    expect(q('memory-preview-counts').textContent).toBe('Can be imported: 1. Skipped: 2 (malformed, too long, or they drop a number, code span or link of their source).');
    expect((q('memory-replace') as HTMLInputElement).checked).toBe(false);
    // Focus goes into the preview.
    expect(document.activeElement).toBe(q('memory-replace'));
    expect(await memory.count()).toBe(0);
    await click('memory-import-apply');
    expect(q('memory-note').textContent).toBe('Corrections imported: 1.');
    expect(q('memory-stats').textContent).toContain('1 of');
    expect([...(await memory.getMany([memoryKey('vi', 'Pay 120 dollars')])).values()][0]).toMatchObject({ by: 'import', override: false, origin: 'import', localOnly: false });

    await pick(file([{ source: 'Back', target: 'Quay lại', targetLang: 'vi' }]));
    await act(() => q('memory-replace').click());
    await click('memory-import-apply');
    expect([...(await memory.getMany([memoryKey('vi', 'Back')])).values()][0]).toMatchObject({ by: 'import', override: true });
  });

  it('says what an import left alone: the user’s own corrections, and what did not fit', async () => {
    const memory = openTranslationMemory({ factory: new IDBFactory(), maxEntries: 2 }) as TranslationMemory;
    await memory.put(edit());
    render(<MemorySection memory={memory} />, root);
    await flush();
    await pick(file([{ source: 'Sign in', target: 'Đăng nhập ngay', targetLang: 'vi' }, { source: 'Back', target: 'Quay lại', targetLang: 'vi' }, { source: 'Next', target: 'Tiếp', targetLang: 'vi' }]));
    await click('memory-import-apply');
    expect(q('memory-note').textContent).toBe('Corrections imported: 1. Left as you corrected them: 1. Not stored because the translation memory is full: 1.');
  });

  it('refuses a file over the size cap before reading it, and a file that is not a memory file', async () => {
    const memory = newMemory();
    render(<MemorySection memory={memory} />, root);
    await flush();
    await pick(file([]), MAX_MEMORY_IMPORT_BYTES + 1);
    expect(q('memory-note').textContent).toBe('This file is too large to be a translation memory file.');
    expect(q('memory-preview')).toBeNull();
    await pick(JSON.stringify({ format: 'translate-side-settings', formatVersion: 1, settings: {} }));
    expect(q('memory-note').textContent).toBe('This is not a Translate Side translation memory file.');
  });

  it('clears only after a confirmation, which can be cancelled', async () => {
    const memory = newMemory();
    await memory.put(edit());
    await memory.put(edit({ source: 'Back', target: 'Quay lại' }));
    render(<MemorySection memory={memory} />, root);
    await flush();
    await click('memory-clear');
    expect(q('memory-clear-confirm').textContent).toContain('Delete every correction (2)?');
    expect(document.activeElement).toBe(q('memory-clear-no'));
    await click('memory-clear-no');
    expect(q('memory-clear-confirm')).toBeNull();
    expect(document.activeElement).toBe(q('memory-clear'));
    expect(await memory.count()).toBe(2);
    await click('memory-clear');
    await click('memory-clear-yes');
    expect(await memory.count()).toBe(0);
    expect(q('memory-stats').textContent).toContain('0 of');
    expect((q('memory-clear') as HTMLButtonElement).disabled).toBe(true);
  });

  it('is not shown without a memory (no IndexedDB)', () => {
    render(<MemorySection memory={undefined} />, root);
    expect(root.textContent).toBe('');
  });
});
