import { useEffect, useRef } from 'preact/hooks';
import { i18n } from '#i18n';
import { slots } from './slots.tsx';

// The first-run privacy notice (DESIGN.md §8, plan M3-E10). Shown until acknowledged; nothing is
// sent before that (privacy.ts).
/** `to`: where page text goes, the connection the translate route uses now (§4.3.5 Resolve). */
export function PrivacyNotice({ to, onAcknowledge }: { to?: { label: string; host: string; fallback?: { label: string; host: string }[] } | undefined; onAcknowledge: () => void }) {
  const ok = useRef<HTMLButtonElement>(null);
  // The panel waits on this notice: focus its button, so the keyboard lands where the choice is.
  useEffect(() => ok.current?.focus(), []);
  return (
    <section class="privacy" data-testid="privacy-notice" role="dialog" aria-modal="true" aria-labelledby="privacy-title" aria-describedby="privacy-text">
      <h2 id="privacy-title" class="privacy__title">
        {i18n.t('panel.privacy.title')}
      </h2>
      <p id="privacy-text">
        {slots(i18n.t('panel.privacy.text', { now: '{now}' }), {
          now: to ? (
            <>
              {' '}
              {slots(i18n.t('panel.privacy.now', { provider: '{provider}' }), { provider: <strong data-testid="privacy-provider">{to.label}</strong> })} {to.host ? `(${to.host})` : ''}
              {to.fallback?.length ? (
                <span data-testid="privacy-fallback">
                  {slots(i18n.t('panel.privacy.fallback', { list: '{list}' }), {
                    list: to.fallback.map((f, i) => (
                      <span key={i}>
                        {i > 0 ? `${i18n.t('panel.privacy.then')} ` : ''}
                        <strong>{f.label}</strong> {f.host ? `(${f.host})` : ''}
                      </span>
                    )),
                  })}
                </span>
              ) : null}
            </>
          ) : null,
        })}
      </p>
      <ul class="privacy__list">
        <li>{i18n.t('panel.privacy.never')}</li>
        <li data-testid="privacy-auto">{i18n.t('panel.privacy.auto')}</li>
        <li>{i18n.t('panel.privacy.fields')}</li>
        <li>{i18n.t('panel.privacy.local')}</li>
        <li data-testid="privacy-diagnostics">{i18n.t('panel.privacy.diagnostics')}</li>
      </ul>
      <button type="button" ref={ok} class="privacy__ok" data-testid="privacy-ok" onClick={onAcknowledge}>
        {i18n.t('panel.privacy.ok')}
      </button>
    </section>
  );
}
