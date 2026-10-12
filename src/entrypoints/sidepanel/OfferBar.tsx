import { useState } from 'preact/hooks';
import { i18n } from '#i18n';
import type { PageOffer } from './offers.ts';

// A page the panel read but does not translate on its own (plan M5-E3, DESIGN §8): after a
// navigation on a site that is not allowlisted, one click translates it, and another allowlists the
// site (the browser asks for its permission once). On a never-translate site it says why nothing is sent.
export function OfferBar({ offer, blocks, onTranslate, onAllow, onSettings }: { offer: PageOffer; blocks: number; onTranslate: () => void; onAllow: () => Promise<boolean>; onSettings: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  if (offer.reason === 'never')
    return (
      <section class="offer" data-testid="offer" data-reason="never" role="status">
        <p class="offer__text">
          {offer.site ? i18n.t('panel.offer.neverSite', blocks, [offer.site, String(blocks)]) : i18n.t('panel.offer.never', blocks)}
        </p>
        <button type="button" class="job__button" onClick={onSettings}>
          {i18n.t('panel.offer.siteRules')}
        </button>
      </section>
    );
  return (
    <section class="offer" data-testid="offer" data-reason="ask" role="status">
      <p class="offer__text">{i18n.t('panel.offer.ask', blocks)}</p>
      <div class="offer__actions">
        <button type="button" class="job__button job__button--primary" data-testid="translate-page" onClick={onTranslate}>
          {i18n.t('panel.offer.translate')}
        </button>
        {offer.site ? (
          <button
            type="button"
            class="job__button"
            data-testid="allow-site"
            title={i18n.t('panel.offer.allowTitle', [offer.site])}
            onClick={() => {
              setNote(null);
              // First call in the handler: the permission prompt needs the click (S5).
              onAllow().then(
                (granted) => setNote(granted ? null : i18n.t('panel.offer.notGranted', [offer.site as string])),
                (e: unknown) => setNote(e instanceof Error ? e.message : String(e)),
              );
            }}
          >
            {i18n.t('panel.offer.allow', [offer.site])}
          </button>
        ) : null}
      </div>
      {note ? <p class="state__hint">{note}</p> : null}
    </section>
  );
}
