// The translation memory in Options: how many corrections it holds (of its cap), Export, Import
// and Clear. The memory has its own file, apart from the settings file. An imported file is
// untrusted: its size is checked before it is read, every entry is validated, and the preview
// says how many entries can be imported and how many were skipped before anything is stored.
// Imported entries only guide translations unless the user ticks "Also replace matching blocks".
import { useEffect, useRef, useState } from 'preact/hooks';
import { i18n } from '#i18n';
import { MAX_MEMORY_ENTRIES, MAX_MEMORY_IMPORT_BYTES, memoryExportFileName, parseMemoryImport, type ImportEntry, type TranslationMemory } from '@/shared/memory';
import { download } from './Transfer.tsx';

type Note = { text: string; warn: boolean };

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const num = (n: number) => n.toLocaleString('en-US');
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function MemorySection({ memory }: { memory: TranslationMemory | undefined }) {
  const [count, setCount] = useState<number | undefined | null>();
  const [note, setNote] = useState<Note | undefined>();
  const [pending, setPending] = useState<{ entries: ImportEntry[]; skipped: number; fileName: string } | undefined>();
  const [override, setOverride] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const clearButton = useRef<HTMLButtonElement>(null);
  const clearCancel = useRef<HTMLButtonElement>(null);
  const previewBox = useRef<HTMLDivElement>(null);
  const wasClearing = useRef(false);
  const hadPreview = useRef(false);

  const load = () =>
    memory?.count().then(setCount, (err: unknown) => {
      setCount(null);
      setNote({ text: i18n.t('options.memory.unreadable', [errorText(err)]), warn: true });
    });
  useEffect(() => {
    void load();
    // Reads the memory once on mount, and again after each change made here.
  }, []);

  // Focus follows what opens: into the confirmation and the preview, and back when they close.
  useEffect(() => {
    if (clearing) clearCancel.current?.focus();
    else if (wasClearing.current) clearButton.current?.focus();
    wasClearing.current = clearing;
  }, [clearing]);
  const hasPreview = pending !== undefined;
  useEffect(() => {
    if (hasPreview) previewBox.current?.querySelector<HTMLElement>('input, button')?.focus();
    else if (hadPreview.current) fileInput.current?.focus();
    hadPreview.current = hasPreview;
  }, [hasPreview]);

  if (!memory) return null;

  const runExport = async () => {
    setBusy(true);
    try {
      const out = await memory.exportFile();
      download(out.json, memoryExportFileName());
      // A memory bigger than an import accepts is still exported (it is the user's backup), but the file cannot be read back whole.
      const tooBig = out.bytes > MAX_MEMORY_IMPORT_BYTES;
      const parts = [i18n.t('options.memory.exported', [num(out.count)])];
      if (tooBig) parts.push(i18n.t('options.memory.exportTooLarge', [mb(out.bytes), mb(MAX_MEMORY_IMPORT_BYTES)]));
      setNote({ text: parts.join(' '), warn: tooBig });
    } catch (err) {
      setNote({ text: i18n.t('options.memory.exportFailed', [errorText(err)]), warn: true });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    setPending(undefined);
    setOverride(false);
    setNote(undefined);
    if (!file) return;
    // The size is checked before the file is read.
    if (file.size > MAX_MEMORY_IMPORT_BYTES) {
      setNote({ text: i18n.t('options.memory.tooLarge'), warn: true });
      return;
    }
    try {
      const parsed = parseMemoryImport(await file.text());
      if (!parsed.ok) setNote({ text: parsed.error, warn: true });
      else setPending({ entries: parsed.entries, skipped: parsed.skipped, fileName: file.name });
    } catch (err) {
      setNote({ text: i18n.t('options.memory.importFailed', [errorText(err)]), warn: true });
    }
  };

  const runImport = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await memory.importMany(pending.entries, { override });
      const parts = [i18n.t('options.memory.imported', [num(result.stored)])];
      if (result.kept > 0) parts.push(i18n.t('options.memory.keptYours', [num(result.kept)]));
      if (result.full > 0) parts.push(i18n.t('options.memory.full', [num(result.full)]));
      setNote({ text: parts.join(' '), warn: result.full > 0 });
      setPending(undefined);
      await load();
    } catch (err) {
      setNote({ text: i18n.t('options.memory.importFailed', [errorText(err)]), warn: true });
    } finally {
      setBusy(false);
    }
  };

  const runClear = async () => {
    setClearing(false);
    setBusy(true);
    try {
      await memory.clear();
      setNote(undefined);
      await load();
    } catch (err) {
      setNote({ text: i18n.t('options.memory.clearFailed', [errorText(err)]), warn: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="opt__section" id="memory" aria-labelledby="memory-h">
      <h2 id="memory-h">{i18n.t('options.memory.title')}</h2>
      <p class="opt__hint" data-testid="memory-stats">
        {count === undefined ? i18n.t('options.reading') : count === null ? '' : i18n.t('options.memory.stats', [num(count), num(MAX_MEMORY_ENTRIES)])}
      </p>
      <p class="opt__hint">{i18n.t('options.memory.hint')}</p>
      <div class="opt__row">
        <button type="button" data-testid="memory-export" disabled={busy} onClick={() => void runExport()}>
          {i18n.t('options.memory.export')}
        </button>
        <button type="button" ref={clearButton} data-testid="memory-clear" disabled={busy || clearing || !count} onClick={() => setClearing(true)}>
          {i18n.t('options.memory.clear')}
        </button>
      </div>
      {clearing ? (
        <div class="opt__status opt__status--warn" role="alertdialog" aria-labelledby="memory-clear-q" data-testid="memory-clear-confirm">
          <p id="memory-clear-q">{i18n.t('options.memory.clearConfirm', [num(count ?? 0)])}</p>
          <button type="button" ref={clearCancel} data-testid="memory-clear-no" onClick={() => setClearing(false)}>
            {i18n.t('options.memory.cancel')}
          </button>{' '}
          <button type="button" data-testid="memory-clear-yes" onClick={() => void runClear()}>
            {i18n.t('options.memory.clearYes')}
          </button>
        </div>
      ) : null}
      <div class="opt__row">
        <label for="memory-file">{i18n.t('options.memory.file')}</label>
        <input id="memory-file" ref={fileInput} type="file" accept=".json,application/json" data-testid="memory-file" onChange={(e) => void onFile(e)} />
      </div>
      {pending ? (
        <div ref={previewBox} data-testid="memory-preview" role="group" aria-label={pending.fileName}>
          <p data-testid="memory-preview-counts">{i18n.t('options.memory.preview', [num(pending.entries.length), num(pending.skipped)])}</p>
          <label class="opt__check">
            <input type="checkbox" data-testid="memory-replace" checked={override} aria-describedby="memory-replace-hint" onChange={(e) => setOverride((e.target as HTMLInputElement).checked)} /> {i18n.t('options.memory.replaceMatching')}
          </label>
          <p class="opt__hint" id="memory-replace-hint">
            {i18n.t('options.memory.replaceHint')}
          </p>
          <p>
            <button type="button" data-testid="memory-import-apply" disabled={busy || pending.entries.length === 0} onClick={() => void runImport()}>
              {i18n.t('options.memory.apply')}
            </button>{' '}
            <button type="button" data-testid="memory-import-cancel" onClick={() => setPending(undefined)}>
              {i18n.t('options.memory.cancel')}
            </button>
          </p>
        </div>
      ) : null}
      {note ? (
        <p class={note.warn ? 'opt__status opt__status--warn' : 'opt__note'} role="status" data-testid="memory-note">
          {note.text}
        </p>
      ) : null}
    </section>
  );
}
