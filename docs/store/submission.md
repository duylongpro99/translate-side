# Store submission: version 1.0.0

Everything the agent can prepare is here; **publishing is the owner's**. This page lists the package to upload, the
assets, and the steps in the Chrome Web Store developer dashboard.

## The package

| | |
|---|---|
| File | `.output/translate-side-1.0.0-chrome.zip` (made by `pnpm run zip`; `.output/` is not committed) |
| Size | ZIP_SIZE bytes |
| SHA-256 | `ZIP_SHA` |
| Built from | source at commit `ZIP_COMMIT` (version `1.0.0` from `package.json`) |

The zip is reproducible: building the same source again gives the same hash. To rebuild it, run
`pnpm install --frozen-lockfile && pnpm run zip` and compare the hash with the one above; if the source changed since
the commit above, the hash changes and this table needs updating.

**What was checked in the unpacked zip:**

- `scripts/check-manifest.mjs` passes on its `manifest.json`: Manifest V3; permissions exactly `sidePanel`, `storage`,
  `activeTab`, `scripting`, `contextMenus`; **no** `host_permissions`; **no** `content_scripts`; optional host
  permissions exactly `https://*/*`, `http://*/*`, `http://localhost/*`, `http://127.0.0.1/*`; minimum Chrome 138; the
  `Alt+T` command; English and Vietnamese messages for every `__MSG_*__` key.
- It is the production build: no source maps (`*.map`), no `.env` or dotfiles, no absolute home paths or user names in
  any file, no development-only host permission (the harness's `http://127.0.0.1/*` is added only to a temporary copy
  under `.output/e2e-ext`, never to the build).
- Version `1.0.0` in the manifest.

**Contents** (27 files, 313 KB):

| Path | What |
|---|---|
| `manifest.json` | The manifest |
| `background.js` | Service worker |
| `content-scripts/content.js` | The content script, injected on a user action |
| `sidepanel.html`, `options.html`, `onboarding.html` | The three pages |
| `chunks/*.js` (12 files), `assets/*.css` (3 files) | Their code and styles, including the Anthropic and OpenAI SDKs |
| `_locales/en/messages.json`, `_locales/vi/messages.json` | Interface strings |
| `icon/16.png`, `32.png`, `48.png`, `128.png` | Icons (the 128 px one is also the store icon) |

## Store assets

All in [assets/](assets/), made by `pnpm run store:screenshots` against the mock provider and a fixture article
written for the purpose (no real key, account or page).

| File | Size | Shows |
|---|---|---|
| `01-page-and-panel.png` | 1280×800 | The page with the translation beside it |
| `02-hover-link.png` | 1280×800 | A block marked on the page while pointing at it in the panel |
| `03-options-providers.png` | 1280×800 | Settings: connections, models, routing |
| `04-glossary-and-sites.png` | 1280×800 | Settings: glossary and site rules |
| `05-vietnamese-interface.png` | 1280×800 | Settings and panel with the Vietnamese interface |
| `tile-440x280.png` | 440×280 | The small promo tile |

The real side panel cannot be captured by the test browser, so each page-and-panel image is two screenshots of the
real interface (the page and the panel) placed side by side.

## Text to paste

- Listing, Privacy-tab answers, test instructions: [listing.md](listing.md)
- Permission justifications: [permission-justifications.md](permission-justifications.md)
- Privacy policy: [../privacy.md](../privacy.md)

## Upload checklist

1. **Before you start**
   - [ ] A Chrome Web Store developer account (one-time registration fee; two-step verification on the account).
   - [ ] The commit that holds `docs/privacy.md` is on `master` on GitHub, so the policy URL resolves:
     https://github.com/duylongpro99/translate-side/blob/master/docs/privacy.md . Open it in a private window.
   - [ ] Rebuild and check the zip: `pnpm install --frozen-lockfile && pnpm run zip`, then
     `shasum -a 256 .output/translate-side-1.0.0-chrome.zip` matches the table above.
   - [ ] A throw-away API key with a small spend limit for the reviewer's test instructions. Do not put it in the
     repository.
2. **Add the item.** Developer dashboard → **Add new item** → upload the zip. Fix anything the upload reports.
3. **Store listing tab.** Paste the name, short description and detailed description from [listing.md](listing.md).
   Upload the five screenshots in order and the tile. Category **Productivity**, language **English**. Set the official
   URL and support URL as listed.
4. **Privacy tab.** Paste the single purpose; paste each permission justification (the four optional host permissions
   share the host justification field: paste the three host paragraphs there); remote code **No**; tick the data types
   as listed (Website content, Authentication information); tick the three certifications; paste the privacy policy
   URL.
5. **Distribution tab.** Visibility **Unlisted** for the first release; all regions; free.
6. **Test instructions.** Paste the reviewer text from [listing.md](listing.md) with the throw-away key filled in.
7. **Submit for review.** Optionally untick "publish automatically" and publish yourself after approval (a deferred
   publish must happen within 30 days or the item reverts to draft).
8. **After approval.** Copy the item's store URL into the README's Install section (it currently says the link will be
   added). Use the item for a few days, then switch visibility to **Public** if you want a public listing.

If review comes back with a question about `http://*/*`, the answer is in
[permission-justifications.md](permission-justifications.md): plain-HTTP provider addresses are refused unless they are
this computer or the local network, and access is requested per origin on a click.

<!--
Reviewer-only: the package facts were taken from the unpacked zip and `scripts/check-manifest.mjs`; the contents table
is the unzipped file list. The 30-day deferred publish rule and the Unlisted-first plan are in
plans/reports/researcher-261011-1901-m6-extension-e2e-store-i18n.md §2 and plans/261011-1206-m6-release-hardening/plan.md §8.
-->
