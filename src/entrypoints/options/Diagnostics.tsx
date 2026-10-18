// The local diagnostics log (src/shared/diagnostics.ts) in Settings: how many entries there are, whether
// new ones keep the site's name, and an export that shows the whole file before it is saved. Nothing is
// sent anywhere: the user saves the file and decides who gets it (DESIGN.md §8).
import { useEffect, useState } from 'preact/hooks';
import type { browser } from 'wxt/browser';
import { Button } from '@/ui/Button';
import { i18n } from '#i18n';
import { clearDiagnostics, DIAG_PREFIX, DIAG_SITES_KEY, diagnosticsFile, MAX_ENTRIES, readDiagnostics, type DiagnosticEntry } from '@/shared/diagnostics';
import { download } from './Transfer.tsx';

type Browser = typeof browser;

const fileName = (now: number) => `translate-side-diagnostics-${new Date(now).toISOString().slice(0, 10)}.json`;

export function DiagnosticsSection({ api, now = Date.now }: { api: Browser; now?: () => number }) {
  const [entries, setEntries] = useState<DiagnosticEntry[] | undefined>();
  const [sites, setSites] = useState(false);
  /** The export being reviewed: the entries as read when it opened, and whether the file keeps their site names. */
  const [review, setReview] = useState<{ entries: DiagnosticEntry[]; sites: boolean } | undefined>();
  const [note, setNote] = useState<string | undefined>();

  useEffect(() => {
    const load = () => void readDiagnostics(api).then(setEntries, () => setEntries([]));
    load();
    void api.storage.local.get(DIAG_SITES_KEY).then((got) => setSites(got[DIAG_SITES_KEY] === true), () => {});
    // Live: a panel adds entries while this page is open.
    const onLocal = (changes: Record<string, unknown>) => {
      if (Object.keys(changes).some((k) => k.startsWith(DIAG_PREFIX))) load();
      if (DIAG_SITES_KEY in changes) setSites((changes[DIAG_SITES_KEY] as { newValue?: unknown }).newValue === true);
    };
    api.storage.local.onChanged.addListener(onLocal);
    return () => api.storage.local.onChanged.removeListener(onLocal);
  }, [api]);

  const withSites = (list: readonly DiagnosticEntry[]) => list.some((e) => e.type === 'page-job' && e.origin !== undefined);
  const file = review ? diagnosticsFile(review.entries, { sites: review.sites, exportedAt: now() }) : '';

  return (
    <section class="opt__section" id="diagnostics" aria-labelledby="diagnostics-h">
      <h2 id="diagnostics-h">{i18n.t('options.diagnostics.title')}</h2>
      <p class="opt__hint">
        {i18n.t('options.diagnostics.intro', [String(MAX_ENTRIES)])}
      </p>
      <label class="opt__check">
        <input
          type="checkbox"
          data-testid="diag-sites"
          checked={sites}
          onChange={(e) => {
            const on = (e.target as HTMLInputElement).checked;
            setSites(on);
            void api.storage.local.set({ [DIAG_SITES_KEY]: on });
          }}
        />{' '}
        {i18n.t('options.diagnostics.sites')}
      </label>
      <p class="opt__hint" data-testid="diag-count">
        {entries === undefined ? i18n.t('options.reading') : i18n.t('options.diagnostics.count', entries.length)}
      </p>
      <div class="opt__row">
        <Button
          data-testid="diag-review"
          disabled={!entries?.length}
          onClick={() => {
            setNote(undefined);
            if (entries) setReview({ entries, sites: withSites(entries) });
          }}
        >
          {i18n.t('options.diagnostics.review')}
        </Button>
        <Button
          data-testid="diag-clear"
          disabled={!entries?.length}
          onClick={() => {
            setReview(undefined);
            void clearDiagnostics(api).then(() => setNote(i18n.t('options.diagnostics.emptied')));
          }}
        >
          {i18n.t('options.diagnostics.clear')}
        </Button>
      </div>
      {review ? (
        <div data-testid="diag-export" role="group" aria-label={i18n.t('options.diagnostics.fileLabel')}>
          <p>{i18n.t('options.diagnostics.notSent')}</p>
          {withSites(review.entries) ? (
            <label class="opt__check">
              <input type="checkbox" data-testid="diag-export-sites" checked={review.sites} onChange={(e) => setReview({ ...review, sites: (e.target as HTMLInputElement).checked })} /> {i18n.t('options.diagnostics.keepSites')}
            </label>
          ) : null}
          <pre class="opt__preview" data-testid="diag-preview" tabIndex={0}>
            {file}
          </pre>
          <p>
            <Button
              data-testid="diag-save"
              onClick={() => {
                download(file, fileName(now()));
                setReview(undefined);
                setNote(i18n.t('options.diagnostics.saved'));
              }}
            >
              {i18n.t('options.diagnostics.save')}
            </Button>{' '}
            <Button data-testid="diag-cancel" onClick={() => setReview(undefined)}>
              {i18n.t('options.diagnostics.cancel')}
            </Button>
          </p>
        </div>
      ) : null}
      {note ? (
        <p class="opt__note" role="status" data-testid="diag-note">
          {note}
        </p>
      ) : null}
    </section>
  );
}
