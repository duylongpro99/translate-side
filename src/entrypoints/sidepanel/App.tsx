import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { PanelController, PanelView } from './controller.ts';
import { DevView } from './DevView.tsx';
import { SegmentList } from './SegmentList.tsx';
import { StateMessage } from './StateMessage.tsx';

export function App({ controller }: { controller: PanelController }) {
  const [view, setView] = useState<PanelView>(controller.view);
  const [dev, setDev] = useState(false);
  useEffect(() => controller.subscribe(setView), [controller]);

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
          <p class="panel__meta" data-testid="panel-ready">
            Original text · {view.result.segments.length} blocks
          </p>
          <SegmentList segments={view.result.segments} />
        </>
      )}
    </main>
  );
}
