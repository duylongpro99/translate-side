import { browser } from 'wxt/browser';

// Placeholder panel (M0-E2). Segment rendering arrives in M0-E7.
export function App() {
  const openOptions = () => {
    void browser.runtime.openOptionsPage();
  };
  return (
    <main class="panel">
      <header class="panel__header">
        <h1>Translate Side</h1>
        <button type="button" class="panel__gear" title="Settings" aria-label="Settings" onClick={openOptions}>
          ⚙
        </button>
      </header>
      <p class="panel__empty" data-testid="panel-placeholder">
        The page's text will appear here.
      </p>
    </main>
  );
}
