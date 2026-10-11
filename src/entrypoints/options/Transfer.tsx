// Export and import of the settings as JSON (plan M5-E9, DESIGN §4.3.7). Keys stay out of the
// file unless the user ticks "include keys" and confirms; an imported file is shown as a summary
// of what it would change, and nothing is written until the user confirms that too (§8).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { browser } from 'wxt/browser';
import { applyImport, buildExport, exportFileName, MAX_IMPORT_BYTES, parseImport, previewImport, type ImportPlan, type ImportReport } from '@/shared/portable';

type Browser = typeof browser;

type Note = { text: string; warn: boolean };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The browser's download of `text` as a file (an anchor click: no `downloads` permission needed). */
function download(text: string, name: string) {
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
  if (c.added + c.replaced > 0) lines.push(`Connections: ${c.added} new, ${c.replaced} replaced.`);
  if (p.added + p.replaced > 0) lines.push(`Models: ${p.added} new, ${p.replaced} replaced.`);
  if (report.routing === 'replaced') lines.push('Routing: replaced by the file’s.');
  if (report.siteRules > 0) lines.push(`Per-site models: ${plural(report.siteRules, 'rule')} added or replaced.`);
  if (report.prefs) lines.push('Preferences: the ones in the file replace yours.');
  if (report.glossary !== null) lines.push(`Glossary: ${plural(report.glossary, 'entry', 'entries')} added or replaced; yours stay.`);
  if (report.sites.allow + report.sites.never > 0) lines.push(`Sites: ${report.sites.allow} always translate (each needs its permission granted again under Site rules), ${report.sites.never} never.`);
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
          Nothing in this file would change your settings.
        </p>
      )}
      {report.redirects.length > 0 ? (
        <ul class="opt__status opt__status--warn" data-testid="import-redirects" aria-label="Connections that would point somewhere else">
          {report.redirects.map((r) => (
            <li key={r.id} data-testid="import-redirect">
              <strong>{r.label}</strong> would change its {r.changed.join(', ')}
              {r.changed.includes('address') ? (
                <>
                  : <code>{r.from || '(none)'}</code> → <code>{r.to || '(none)'}</code>
                </>
              ) : null}
              .{' '}
              {r.keyAction === 'removed' ? 'Your saved key for it will be removed, so it is not sent to the new address.' : null}
              {r.keyAction === 'replaced' ? 'Its saved key is replaced by the key in the file.' : null}
              {r.keyAction === 'kept' ? 'Your saved key stays, and will be sent to the new address.' : null}
              {r.keyAction === 'removed' || r.keyAction === 'kept' ? (
                <label class="opt__check">
                  <input type="checkbox" data-testid="import-keep-key" checked={keep.has(r.id)} onChange={(e) => onKeep(r.id, (e.target as HTMLInputElement).checked)} /> Keep my saved key for {r.label} and send it to {r.to || 'the new address'}
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {report.endpoints.length > 0 ? (
        <p class="opt__hint" data-testid="import-endpoints">
          Page text will go to these servers when you translate with the imported connections: {report.endpoints.join(', ')}. Chrome asks for permission for each when you test it.
        </p>
      ) : null}
      {report.notes.length > 0 ? (
        <ul class="opt__status opt__status--warn" data-testid="import-notes" aria-label="Skipped or ignored">
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
      const parts = [includeKeys ? `Exported, with ${plural(out.keyCount, 'API key')} in the file. Keep it private.` : 'Exported. The file has no API keys.'];
      if (out.omitted.length > 0) parts.push(`Left out because they look like keys: ${out.omitted.join('; ')}.`);
      if (!includeKeys) {
        parts.push('Only headers and query parameters with key-like names, and credentials in a base URL, are removed; a key written anywhere else is not detected.');
        if (out.suspects.length > 0) parts.push(`Check these before you share the file, they look like a key: ${out.suspects.join('; ')}.`);
      }
      setExportNote({ text: parts.join(' '), warn: includeKeys || out.omitted.length > 0 || out.suspects.length > 0 });
    } catch (e) {
      setExportNote({ text: `The export failed: ${e instanceof Error ? e.message : String(e)}`, warn: true });
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
      setImportNote({ text: 'This file is too large to be a settings file.', warn: true });
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
      setImportNote({ text: `The file could not be read: ${err instanceof Error ? err.message : String(err)}`, warn: true });
    }
  };

  const keyCount = pending ? Object.keys(pending.plan.keys).length : 0;
  const runImport = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const report = await applyImport(api, pending.plan, { withKeys: importKeys, keepKeys: keep });
      const parts = [`Imported from ${pending.fileName}.`];
      if (importKeys) parts.push(`${plural(report.keys.written, 'API key')} saved.`);
      else if (keyCount > 0) parts.push('The keys in the file were not imported.');
      if (report.keys.removed > 0) parts.push(`${plural(report.keys.removed, 'saved key')} removed because the connection now points to another address.`);
      setImportNote({ text: parts.join(' '), warn: report.keys.removed > 0 });
      setPending(undefined);
    } catch (err) {
      setImportNote({ text: `Nothing was imported: ${err instanceof Error ? err.message : String(err)}`, warn: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="opt__section" id="transfer" aria-labelledby="transfer-h">
      <h2 id="transfer-h">Export and import settings</h2>
      <p class="opt__hint">
        Move your connections, models, routing, preferences, glossary and site lists to another browser, or share a setup that points at a company gateway. The usage log, the cache and your first-run choices stay on this device.
      </p>
      <h3>Export</h3>
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
          Include API keys
        </label>
        <button type="button" data-testid="export" disabled={busy || confirming} onClick={() => void runExport(withKeys)}>
          Export settings
        </button>
      </div>
      {confirming ? (
        <div class="opt__status opt__status--warn" role="alertdialog" aria-labelledby="keys-confirm-h" data-testid="keys-confirm">
          <p id="keys-confirm-h">
            <strong>The file will hold your API keys in plain text.</strong> Anyone who gets the file can use them and spend your money. Share it only with yourself, and delete it after you import it.
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
            Cancel
          </button>{' '}
          <button type="button" data-testid="keys-confirm-yes" onClick={() => setConfirming(false)}>
            Include keys
          </button>
        </div>
      ) : null}
      {exportNote ? (
        <p class={exportNote.warn ? 'opt__status opt__status--warn' : 'opt__note'} role="status" data-testid="export-note">
          {exportNote.text}
        </p>
      ) : null}
      <h3>Import</h3>
      <div class="opt__row">
        <label for="import-file">Settings file</label>
        <input id="import-file" ref={fileInput} type="file" accept=".json,application/json" data-testid="import-file" onChange={(e) => void onFile(e)} />
      </div>
      {pending ? (
        <div ref={previewBox} data-testid="import-preview" role="group" aria-label={`What importing ${pending.fileName} would change`}>
          <p>
            <strong>{pending.fileName}</strong> would change this:
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
              <input type="checkbox" data-testid="import-keys" checked={importKeys} onChange={(e) => setImportKeys((e.target as HTMLInputElement).checked)} /> Also import the {plural(keyCount, 'API key')} in this file{pending.report.keys.wouldReplace > 0 ? ` (${plural(pending.report.keys.wouldReplace, 'key')} replace${pending.report.keys.wouldReplace === 1 ? 's' : ''} one you have saved)` : ''}
            </label>
          ) : null}
          <p>
            <button type="button" data-testid="import-apply" disabled={busy} onClick={() => void runImport()}>
              Import
            </button>{' '}
            <button type="button" data-testid="import-cancel" onClick={() => setPending(undefined)}>
              Cancel
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
