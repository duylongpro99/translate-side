import type { PanelView } from './controller.ts';
import { i18n } from '#i18n';

// Loading, empty, error and access states (plan M0-E7; "can't read this page", criterion #4).
export function StateMessage({ view, onRetry }: { view: Exclude<PanelView, { kind: 'ready' }>; onRetry: () => void }) {
  switch (view.kind) {
    case 'loading':
      return (
        <p class="state" data-state="loading" role="status">
          {i18n.t('panel.state.loading')}
        </p>
      );
    case 'idle':
      return (
        <div class="state" data-state="idle">
          <p class="state__title">{i18n.t('panel.state.idleTitle')}</p>
          <p>{i18n.t('panel.state.idleText')}</p>
        </div>
      );
    case 'blocked':
      if (view.reason === 'password')
        return (
          <div class="state" data-state="blocked" data-reason="password" role="alert">
            <p class="state__title">{i18n.t('panel.state.passwordTitle')}</p>
            <p>{i18n.t('panel.state.password')}</p>
            <p class="state__hint">{i18n.t('panel.state.passwordHint')}</p>
          </div>
        );
      return (
        <div class="state" data-state="blocked" role="alert">
          <p class="state__title">{i18n.t('panel.state.blockedTitle')}</p>
          <p>
            {i18n.t(view.reason === 'denylisted' ? 'panel.state.denylisted' : view.reason === 'never' ? 'panel.state.never' : 'panel.state.browserPage')}
          </p>
        </div>
      );
    case 'lost':
      return (
        <div class="state" data-state="lost" role="alert">
          <p class="state__title">{i18n.t('panel.state.lostTitle')}</p>
          <p>{i18n.t('panel.state.lostText')}</p>
          <p class="state__hint">{i18n.t('panel.state.lostHint')}</p>
        </div>
      );
    case 'empty':
      return (
        <div class="state" data-state="empty">
          <p class="state__title">{i18n.t('panel.state.extractionHint')}</p>
          <p>{i18n.t('panel.state.emptyText')}</p>
          <p class="state__hint">{i18n.t('panel.state.emptyHint')}</p>
        </div>
      );
    case 'error':
      return (
        <div class="state" data-state="error" role="alert">
          <p class="state__title">{i18n.t('panel.state.errorTitle')}</p>
          <p class="state__detail">{view.message}</p>
          <p class="state__hint">{i18n.t('panel.state.extractionHint')}</p>
          <button type="button" onClick={onRetry}>
            {i18n.t('panel.state.retry')}
          </button>
        </div>
      );
  }
}
