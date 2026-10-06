import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { PanelController, PanelView } from './controller.ts';
import { StateMessage } from './StateMessage.tsx';

export function App({ controller }: { controller: PanelController }) {
  const [view, setView] = useState<PanelView>(controller.view);
  useEffect(() => controller.subscribe(setView), [controller]);

  const openOptions = () => {
    void browser.runtime.openOptionsPage();
  };
  return (
    <main class="panel">
      <header class="panel__header">
        <h1>Translate Side</h1>
        <button type="button" class="panel__icon" title="Settings" aria-label="Settings" onClick={openOptions}>
          ⚙
        </button>
      </header>
      {view.kind === 'ready' ? (
        <p class="panel__meta" data-testid="panel-ready">
          {view.result.segments.length} segments
        </p>
      ) : (
        <StateMessage view={view} onRetry={() => controller.retry()} />
      )}
    </main>
  );
}
