import { useState } from 'preact/hooks';
import type { PageOffer } from './offers.ts';

// A page the panel read but does not translate on its own (plan M5-E3, DESIGN §8): after a
// navigation on a site that is not allowlisted, one click translates it, and another allowlists the
// site (the browser asks for its permission once). On a never-translate site it says why nothing is sent.
export function OfferBar({ offer, blocks, onTranslate, onAllow, onSettings }: { offer: PageOffer; blocks: number; onTranslate: () => void; onAllow: () => Promise<boolean>; onSettings: () => void }) {
  const [refused, setRefused] = useState(false);
  if (offer.reason === 'never')
    return (
      <section class="offer" data-testid="offer" data-reason="never" role="status">
        <p class="offer__text">
          You chose never to translate {offer.site ?? 'this site'}. Nothing is sent. · {blocks} blocks
        </p>
        <button type="button" class="job__button" onClick={onSettings}>
          Site rules
        </button>
      </section>
    );
  return (
    <section class="offer" data-testid="offer" data-reason="ask" role="status">
      <p class="offer__text">Original text · {blocks} blocks. Nothing has been sent.</p>
      <div class="offer__actions">
        <button type="button" class="job__button job__button--primary" data-testid="translate-page" onClick={onTranslate}>
          Translate this page
        </button>
        {offer.site ? (
          <button
            type="button"
            class="job__button"
            data-testid="allow-site"
            title={`Translate each page of ${offer.site} by itself while the panel is open. The browser asks for access to the site once.`}
            onClick={() => {
              setRefused(false);
              // First call in the handler: the permission prompt needs the click (S5).
              onAllow().then(
                (granted) => setRefused(!granted),
                () => setRefused(true),
              );
            }}
          >
            Always translate {offer.site}
          </button>
        ) : null}
      </div>
      {refused ? <p class="state__hint">Access to {offer.site} was not granted, so pages there still wait for this click.</p> : null}
    </section>
  );
}
