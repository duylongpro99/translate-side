import { DENYLIST_MESSAGE, EXTRACTION_HINT, PASSWORD_MESSAGE } from '@/shared/snippet';
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
      if (view.reason === 'password')
        return (
          <div class="state" data-state="blocked" data-reason="password" role="alert">
            <p class="state__title">Not read: a password field is in use</p>
            <p>{PASSWORD_MESSAGE}</p>
            <p class="state__hint">Click outside the password field, then press Alt+T or click the toolbar icon again.</p>
          </div>
        );
      return (
        <div class="state" data-state="blocked" role="alert">
          <p class="state__title">Can't read this page</p>
          <p>
            {view.reason === 'denylisted'
              ? DENYLIST_MESSAGE
              : 'Chrome does not let extensions read this page (browser pages, the Web Store and similar).'}
          </p>
        </div>
      );
    case 'lost':
      return (
        <div class="state" data-state="lost" role="alert">
          <p class="state__title">Translate this page</p>
          <p>This page is new to Translate Side. Press Alt+T or click the toolbar icon to read it.</p>
          <p class="state__hint">Browser pages and the Chrome Web Store can't be read; Chrome doesn't let extensions see them.</p>
        </div>
      );
    case 'empty':
      return (
        <div class="state" data-state="empty">
          <p class="state__title">{EXTRACTION_HINT}</p>
          <p>This page has no article or docs content that Translate Side can find.</p>
          <p class="state__hint">Select the text, then right-click → Translate in side panel.</p>
        </div>
      );
    case 'error':
      return (
        <div class="state" data-state="error" role="alert">
          <p class="state__title">Something went wrong</p>
          <p class="state__detail">{view.message}</p>
          <p class="state__hint">{EXTRACTION_HINT}</p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      );
  }
}
