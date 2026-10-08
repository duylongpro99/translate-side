import { DEFAULT_CONNECTION, DEFAULT_HOST } from '@/shared/settings';

// The first-run privacy notice (DESIGN.md §8, plan M3-E10). Shown until acknowledged; nothing is
// sent before that (privacy.ts).
export function PrivacyNotice({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <section class="privacy" data-testid="privacy-notice" role="dialog" aria-labelledby="privacy-title">
      <h2 id="privacy-title" class="privacy__title">
        Before you translate
      </h2>
      <p>
        Translate Side sends the text of the pages you translate to the AI provider you chose — now <strong>{DEFAULT_CONNECTION.label}</strong> ({DEFAULT_HOST}). Only pages you open the panel on are sent,
        and only after you click below.
      </p>
      <ul class="privacy__list">
        <li>Mail and sign-in pages, browser pages and the Chrome Web Store are never read or sent.</li>
        <li>Password and other form fields, and anything you can type into, are never read. A page with a password field in use is skipped.</li>
        <li>
          For sensitive pages, don't translate them with a cloud provider. Local options that keep the text on this device (Ollama, Chrome's built-in model) are coming in a later version.
        </li>
      </ul>
      <button type="button" class="privacy__ok" data-testid="privacy-ok" onClick={onAcknowledge}>
        Got it, translate
      </button>
    </section>
  );
}
