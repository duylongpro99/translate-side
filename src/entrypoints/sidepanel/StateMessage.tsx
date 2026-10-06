import type { PanelView } from './controller.ts';

// Loading, empty, error and access states (plan M0-E7; "can't read this page", criterion #4).
export function StateMessage({ view, onRetry }: { view: Exclude<PanelView, { kind: 'ready' }>; onRetry: () => void }) {
  switch (view.kind) {
    case 'loading':
      return (
        <p class="state" data-state="loading" role="status">
          Reading the page…
        </p>
      );
    case 'idle':
      return (
        <div class="state" data-state="idle">
          <p class="state__title">Nothing read yet</p>
          <p>Press Alt+T or click the toolbar icon to read this page.</p>
        </div>
      );
    case 'blocked':
      return (
        <div class="state" data-state="blocked" role="alert">
          <p class="state__title">Can't read this page</p>
          <p>
            {view.reason === 'denylisted'
              ? 'Translate Side never reads this site (mail and sign-in pages are on a built-in denylist).'
              : 'Chrome does not let extensions read this page (browser pages, the Web Store and similar).'}
          </p>
        </div>
      );
    case 'lost':
      return (
        <div class="state" data-state="lost" role="alert">
          <p class="state__title">Translate this page</p>
          <p>This page is new to Translate Side. Press Alt+T or click the toolbar icon to read it.</p>
        </div>
      );
    case 'empty':
      return (
        <div class="state" data-state="empty">
          <p class="state__title">Couldn't find the main text</p>
          <p>This page has no article or docs content that Translate Side can find.</p>
        </div>
      );
    case 'error':
      return (
        <div class="state" data-state="error" role="alert">
          <p class="state__title">Something went wrong</p>
          <p class="state__detail">{view.message}</p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      );
  }
}
