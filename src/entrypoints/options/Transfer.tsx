// Export and import of the settings as JSON (plan M5-E9, DESIGN §4.3.7). Keys stay out of the
// file unless the user ticks "include keys" and confirms; an imported file is shown as a summary
// of what it would change, and nothing is written until the user confirms that too (§8).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { browser } from 'wxt/browser';
import { i18n } from '#i18n';
import { slots } from '../sidepanel/slots.tsx';
import { applyImport, buildExport, exportFileName, MAX_IMPORT_BYTES, parseImport, previewImport, type ImportPlan, type ImportReport } from '@/shared/portable';

type Browser = typeof browser;

type Note = { text: string; warn: boolean };

/** What a connection's import would change, in words (portable.ts names the fields). */
const CHANGED_NAMES: Record<string, () => string> = {
  address: () => i18n.t('options.transfer.fieldAddress'),
  auth: () => i18n.t('options.transfer.fieldAuth'),
  headers: () => i18n.t('options.transfer.fieldHeaders'),
  'query parameters': () => i18n.t('options.transfer.fieldQueryParams'),
};
const changedNames = (changed: readonly string[]) => changed.map((c) => CHANGED_NAMES[c]?.() ?? c).join(', ');

/** The browser's download of `text` as a file (an anchor click: no `downloads` permission needed). */
export function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Summary({ report, keep, onKeep }: { report: ImportReport; keep: ReadonlySet<string>; onKeep: (id: string, on: boolean) => void }) {
  const lines: string[] = [];
  const { connections: c, profiles: p } = report;
  if (c.added + c.replaced > 0) lines.push(i18n.t('options.transfer.connections', [String(c.added), String(c.replaced)]));
  if (p.added + p.replaced > 0) lines.push(i18n.t('options.transfer.models', [String(p.added), String(p.replaced)]));
  if (report.routing === 'replaced') lines.push(i18n.t('options.transfer.routing'));
  if (report.siteRules > 0) lines.push(i18n.t('options.transfer.siteRules', report.siteRules));
  if (report.prefs) lines.push(i18n.t('options.transfer.prefs'));
  if (report.quality) lines.push(i18n.t('options.transfer.quality'));
  if (report.reading) lines.push(i18n.t('options.transfer.reading'));
  if (report.glossary !== null) lines.push(i18n.t('options.transfer.glossary', report.glossary));
  if (report.sites.allow + report.sites.never > 0) lines.push(i18n.t('options.transfer.sites', [String(report.sites.allow), String(report.sites.never)]));
  return (
    <>
      {lines.length > 0 ? (
        <ul data-testid="import-summary">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : (
        <p class="opt__status" data-testid="import-summary">
          {i18n.t('options.transfer.nothing')}
        </p>
      )}
      {report.redirects.length > 0 ? (
        <ul class="opt__status opt__status--warn" data-testid="import-redirects" aria-label={i18n.t('options.transfer.redirectsLabel')}>
          {report.redirects.map((r) => (
            <li key={r.id} data-testid="import-redirect">
              {r.changed.includes('address')
                ? slots(i18n.t('options.transfer.redirectAddress', { label: '{label}', changed: changedNames(r.changed), from: '{from}', to: '{to}' }), { label: <strong>{r.label}</strong>, from: <code>{r.from || i18n.t('options.transfer.none')}</code>, to: <code>{r.to || i18n.t('options.transfer.none')}</code> })
                : slots(i18n.t('options.transfer.redirect', { label: '{label}', changed: changedNames(r.changed) }), { label: <strong>{r.label}</strong> })}{' '}
              {r.keyAction === 'removed' ? i18n.t('options.transfer.keyRemoved') : null}
              {r.keyAction === 'replaced' ? i18n.t('options.transfer.keyReplaced') : null}
              {r.keyAction === 'kept' ? i18n.t('options.transfer.keyKept') : null}
              {r.keyAction === 'removed' || r.keyAction === 'kept' ? (
                <label class="opt__check">
                  <input type="checkbox" data-testid="import-keep-key" checked={keep.has(r.id)} onChange={(e) => onKeep(r.id, (e.target as HTMLInputElement).checked)} /> {i18n.t('options.transfer.keepKey', [r.label, r.to || i18n.t('options.transfer.newAddress')])}
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {report.endpoints.length > 0 ? (
        <p class="opt__hint" data-testid="import-endpoints">
          {i18n.t('options.transfer.endpoints', [report.endpoints.join(', ')])}
        </p>
      ) : null}
      {report.notes.length > 0 ? (
        <ul class="opt__status opt__status--warn" data-testid="import-notes" aria-label={i18n.t('options.transfer.notesLabel')}>
          {report.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function TransferSection({ api }: { api: Browser }) {
  const [withKeys, setWithKeys] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [exportNote, setExportNote] = useState<Note | undefined>();
  const [pending, setPending] = useState<{ plan: ImportPlan; report: ImportReport; fileName: string } | undefined>();
  const [importKeys, setImportKeys] = useState(false);
  const [keep, setKeep] = useState<ReadonlySet<string>>(() => new Set());
  const [importNote, setImportNote] = useState<Note | undefined>();
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const includeKeysBox = useRef<HTMLInputElement>(null);
  const confirmCancel = useRef<HTMLButtonElement>(null);
  const previewBox = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef(false);
  const hadPreview = useRef(false);

  // Focus follows what opens: into the confirmation and the preview, and back to where the user was when they close.
  useEffect(() => {
    if (confirming) confirmCancel.current?.focus();
    else if (wasConfirming.current) includeKeysBox.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  const hasPreview = pending !== undefined;
  useEffect(() => {
    if (hasPreview) previewBox.current?.querySelector<HTMLElement>('input, button')?.focus();
    else if (hadPreview.current) fileInput.current?.focus();
    hadPreview.current = hasPreview;
  }, [hasPreview]);
  // The preview follows the two choices that change what the import does.
  const plan = pending?.plan;
  useEffect(() => {
    if (!plan) return;
    let live = true;
    previewImport(api, plan, { withKeys: importKeys, keepKeys: keep }).then(
      (report) => live && setPending((p) => (p && p.plan === plan ? { ...p, report } : p)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [plan, importKeys, keep]);

  const runExport = async (includeKeys: boolean) => {
    setConfirming(false);
    setBusy(true);
    try {
      const out = await buildExport(api, { includeKeys });
      download(out.json, exportFileName());
      const parts = [includeKeys ? i18n.t('options.transfer.exportedKeys', out.keyCount) : i18n.t('options.transfer.exported')];
      if (out.omitted.length > 0) parts.push(i18n.t('options.transfer.omitted', [out.omitted.join('; ')]));
      if (!includeKeys) {
        parts.push(i18n.t('options.transfer.scope'));
        if (out.suspects.length > 0) parts.push(i18n.t('options.transfer.suspects', [out.suspects.join('; ')]));
      }
      setExportNote({ text: parts.join(' '), warn: includeKeys || out.omitted.length > 0 || out.suspects.length > 0 });
    } catch (e) {
      setExportNote({ text: i18n.t('options.transfer.exportFailed', [e instanceof Error ? e.message : String(e)]), warn: true });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    setPending(undefined);
    setImportNote(undefined);
    setImportKeys(false);
    setKeep(new Set());
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setImportNote({ text: i18n.t('options.transfer.tooLarge'), warn: true });
      return;
    }
    const parsed = parseImport(await file.text());
    if (!parsed.ok) {
      setImportNote({ text: parsed.error, warn: true });
      return;
    }
    try {
      setPending({ plan: parsed.plan, report: await previewImport(api, parsed.plan, { withKeys: false }), fileName: file.name });
    } catch (err) {
      setImportNote({ text: i18n.t('options.transfer.unreadable', [err instanceof Error ? err.message : String(err)]), warn: true });
    }
  };

  const keyCount = pending ? Object.keys(pending.plan.keys).length : 0;
  const runImport = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const report = await applyImport(api, pending.plan, { withKeys: importKeys, keepKeys: keep });
      const parts = [i18n.t('options.transfer.imported', [pending.fileName])];
      if (importKeys) parts.push(i18n.t('options.transfer.keysSaved', report.keys.written));
      else if (keyCount > 0) parts.push(i18n.t('options.transfer.keysSkipped'));
      if (report.keys.removed > 0) parts.push(i18n.t('options.transfer.keysRemoved', report.keys.removed));
      setImportNote({ text: parts.join(' '), warn: report.keys.removed > 0 });
      setPending(undefined);
    } catch (err) {
      setImportNote({ text: i18n.t('options.transfer.importFailed', [err instanceof Error ? err.message : String(err)]), warn: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="opt__section" id="transfer" aria-labelledby="transfer-h">
      <h2 id="transfer-h">{i18n.t('options.transfer.title')}</h2>
      <p class="opt__hint">
        {i18n.t('options.transfer.intro')}
      </p>
      <h3>{i18n.t('options.transfer.exportTitle')}</h3>
      <div class="opt__row">
        <label class="opt__check">
          <input
            type="checkbox"
            ref={includeKeysBox}
            data-testid="include-keys"
            checked={withKeys}
            onChange={(e) => {
              const on = (e.target as HTMLInputElement).checked;
              setWithKeys(on);
              setConfirming(on);
            }}
          />{' '}
          {i18n.t('options.transfer.includeKeys')}
        </label>
        <button type="button" data-testid="export" disabled={busy || confirming} onClick={() => void runExport(withKeys)}>
          {i18n.t('options.transfer.export')}
        </button>
      </div>
      {confirming ? (
        <div class="opt__status opt__status--warn" role="alertdialog" aria-labelledby="keys-confirm-h" data-testid="keys-confirm">
          <p id="keys-confirm-h">
            {slots(i18n.t('options.transfer.confirm', { warning: '{warning}' }), { warning: <strong>{i18n.t('options.transfer.confirmWarning')}</strong> })}
          </p>
          <button
            type="button"
            ref={confirmCancel}
            data-testid="keys-confirm-no"
            onClick={() => {
              setConfirming(false);
              setWithKeys(false);
            }}
          >
            {i18n.t('options.transfer.cancel')}
          </button>{' '}
          <button type="button" data-testid="keys-confirm-yes" onClick={() => setConfirming(false)}>
            {i18n.t('options.transfer.confirmYes')}
          </button>
        </div>
      ) : null}
      {exportNote ? (
        <p class={exportNote.warn ? 'opt__status opt__status--warn' : 'opt__note'} role="status" data-testid="export-note">
          {exportNote.text}
        </p>
      ) : null}
      <h3>{i18n.t('options.transfer.importTitle')}</h3>
      <div class="opt__row">
        <label for="import-file">{i18n.t('options.transfer.file')}</label>
        <input id="import-file" ref={fileInput} type="file" accept=".json,application/json" data-testid="import-file" onChange={(e) => void onFile(e)} />
      </div>
      {pending ? (
        <div ref={previewBox} data-testid="import-preview" role="group" aria-label={i18n.t('options.transfer.previewLabel', [pending.fileName])}>
          <p>
            {slots(i18n.t('options.transfer.wouldChange', { file: '{file}' }), { file: <strong>{pending.fileName}</strong> })}
          </p>
          <Summary
            report={pending.report}
            keep={keep}
            onKeep={(id, on) =>
              setKeep((cur) => {
                const next = new Set(cur);
                if (on) next.add(id);
                else next.delete(id);
                return next;
              })
            }
          />
          {keyCount > 0 ? (
            <label class="opt__check">
              <input type="checkbox" data-testid="import-keys" checked={importKeys} onChange={(e) => setImportKeys((e.target as HTMLInputElement).checked)} /> {i18n.t('options.transfer.alsoKeys', keyCount)}
              {pending.report.keys.wouldReplace > 0 ? ` ${i18n.t('options.transfer.alsoKeysReplace', pending.report.keys.wouldReplace)}` : ''}
            </label>
          ) : null}
          <p>
            <button type="button" data-testid="import-apply" disabled={busy} onClick={() => void runImport()}>
              {i18n.t('options.transfer.apply')}
            </button>{' '}
            <button type="button" data-testid="import-cancel" onClick={() => setPending(undefined)}>
              {i18n.t('options.transfer.cancel')}
            </button>
          </p>
        </div>
      ) : null}
      {importNote ? (
        <p class={importNote.warn ? 'opt__status opt__status--warn' : 'opt__note'} role="status" data-testid="import-note">
          {importNote.text}
        </p>
      ) : null}
    </section>
  );
}
