import { useEffect, useRef } from 'preact/hooks';

// The first-run privacy notice (DESIGN.md §8, plan M3-E10). Shown until acknowledged; nothing is
// sent before that (privacy.ts).
/** `to`: where page text goes, the connection the translate route uses now (§4.3.5 Resolve). */
export function PrivacyNotice({ to, onAcknowledge }: { to?: { label: string; host: string } | undefined; onAcknowledge: () => void }) {
  const ok = useRef<HTMLButtonElement>(null);
  // The panel waits on this notice: focus its button, so the keyboard lands where the choice is.
  useEffect(() => ok.current?.focus(), []);
  return (
    <section class="privacy" data-testid="privacy-notice" role="dialog" aria-modal="true" aria-labelledby="privacy-title" aria-describedby="privacy-text">
      <h2 id="privacy-title" class="privacy__title">
        Before you translate
      </h2>
      <p id="privacy-text">
        Translate Side sends the text of the pages you translate to the AI provider you chose
        {to ? (
          <>
            {' '}
            — now <strong data-testid="privacy-provider">{to.label}</strong> {to.host ? `(${to.host})` : ''}
          </>
        ) : null}
        . Only pages you open the panel on are sent, and only after you click below.
      </p>
      <ul class="privacy__list">
        <li>Mail and sign-in pages, browser pages and the Chrome Web Store are never read or sent.</li>
        <li>Password and other form fields, and anything you can type into, are never read. A page with a password field in use is skipped.</li>
        <li>
          For sensitive pages, don't translate them with a cloud provider. Local options that keep the text on this device (Ollama, Chrome's built-in model) are coming in a later version.
        </li>
      </ul>
      <button type="button" ref={ok} class="privacy__ok" data-testid="privacy-ok" onClick={onAcknowledge}>
        Got it, translate
      </button>
    </section>
  );
}
