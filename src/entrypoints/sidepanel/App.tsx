import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { PanelController, PanelView } from './controller.ts';
import { AboutDocument } from './AboutDocument.tsx';
import { DevView } from './DevView.tsx';
import { JobBar, type JobActions } from './JobBar.tsx';
import type { Jobs, JobView } from './jobs.ts';
import { SegmentList } from './SegmentList.tsx';
import { StateMessage } from './StateMessage.tsx';

/** What the panel needs from the translation side (translator.ts). Absent: the original only (M0). */
export interface TranslatorProps {
  jobs: Jobs;
  actions(tabId: number): JobActions;
}

const nextFrame = (fn: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));

/**
 * The active tab's job, if it belongs to the document on screen. Updates are batched per frame:
 * a stream emits an event per text delta.
 */
function useJob(jobs: Jobs | undefined, tabId: number | undefined, docId: string | undefined): JobView | undefined {
  const read = () => (jobs && tabId !== undefined && docId !== undefined && jobs.docOf(tabId) === docId ? jobs.get(tabId) : undefined);
  const [job, setJob] = useState<JobView | undefined>(read);
  useEffect(() => {
    setJob(read());
    if (!jobs) return;
    let scheduled = false;
    const unsubscribe = jobs.subscribe((id) => {
      if (id !== tabId || scheduled) return;
      scheduled = true;
      nextFrame(() => {
        scheduled = false;
        setJob(read());
      });
    });
    return unsubscribe;
    // read() closes over exactly these three.
  }, [jobs, tabId, docId]);
  return job;
}

export function App({ controller, translator }: { controller: PanelController; translator?: TranslatorProps }) {
  const [view, setView] = useState<PanelView>(controller.view);
  const [tabId, setTabId] = useState<number | undefined>(controller.tabId);
  const [dev, setDev] = useState(false);
  useEffect(
    () =>
      controller.subscribe((v, t) => {
        setView(v);
        setTabId(t);
      }),
    [controller],
  );
  const job = useJob(translator?.jobs, tabId, view.kind === 'ready' ? view.docId : undefined);

  const openOptions = () => {
    void browser.runtime.openOptionsPage();
  };
  // Open-only toolbar/Alt+T in M0 (D11): the panel closes here. sidePanel.close is Chrome 141+.
  const closePanel = async () => {
    const win = await browser.windows.getCurrent();
    if (typeof browser.sidePanel.close === 'function' && win.id !== undefined) await browser.sidePanel.close({ windowId: win.id });
    else window.close();
  };
  return (
    <main class="panel">
      <header class="panel__header">
        <h1 title={view.kind === 'ready' ? view.result.title : undefined}>{view.kind === 'ready' ? view.result.title || 'Translate Side' : 'Translate Side'}</h1>
        {import.meta.env.DEV && view.kind === 'ready' ? (
          <button type="button" class="panel__icon panel__dev" aria-pressed={dev} title="Segment view (dev build only)" onClick={() => setDev(!dev)}>
            {'{ }'}
          </button>
        ) : null}
        <button type="button" class="panel__icon" title="Settings" aria-label="Settings" onClick={openOptions}>
          ⚙
        </button>
        <button type="button" class="panel__icon" title="Close" aria-label="Close panel" onClick={() => void closePanel()}>
          ✕
        </button>
      </header>
      {view.kind !== 'ready' ? (
        <StateMessage view={view} onRetry={() => controller.retry()} />
      ) : import.meta.env.DEV && dev ? (
        <DevView segments={view.result.segments} via={view.result.via} docId={view.docId} />
      ) : (
        <>
          {job && translator && tabId !== undefined ? (
            <JobBar job={job} actions={translator.actions(tabId)} />
          ) : (
            <p class="panel__meta" data-testid="panel-ready">
              Original text · {view.result.segments.length} blocks
            </p>
          )}
          {job?.brief ? <AboutDocument brief={job.brief} sourceLang={job.sourceLang} /> : null}
          <SegmentList segments={job?.segments ?? view.result.segments} states={job?.segs} />
        </>
      )}
    </main>
  );
}
