# Chrome Web Store listing

Everything to paste into the Chrome Web Store developer dashboard, in English (the listing is English only; the
extension's own interface is English and Vietnamese). The upload steps are in [submission.md](submission.md). The
permission texts are in [permission-justifications.md](permission-justifications.md); the policy is
[../privacy.md](../privacy.md).

## Store listing tab

**Name:** Translate Side

**Short description** (107 of 132 characters):

> Read any page in your own language. A natural AI translation in the side panel, right next to the original.

**Category:** Productivity. **Language:** English.

**Detailed description:**

```
Translate Side opens a side panel next to the page you are reading and fills it with a natural translation, block for block, while the original page stays exactly as it is.

It uses an AI model that you choose and pay for yourself. You add your own API key (Anthropic, OpenAI, Google Gemini, OpenRouter and other OpenAI-compatible services), or run a model on your own computer with Ollama or LM Studio so the text never leaves your device. There is no Translate Side account or server.

WHAT IT DOES
• Side by side: press Alt+T or click the toolbar icon. The panel opens and translates; the same key closes it. On macOS rebind the shortcut at chrome://extensions/shortcuts if you prefer.
• Reads for meaning: before translating, the model writes a short brief of the page (genre, audience, tone, key terms) and uses it for every block, so tone and terms stay consistent.
• Streams as it goes and starts with what you are looking at; long pages are translated as you scroll.
• Styles: Natural, Faithful, or Simplified.
• Your glossary: say how a term is always rendered, or keep it as it is.
• Keeps code, URLs, numbers and product names unchanged, and checks every block for lost code, links and numbers.
• Hover a block in the panel to see where it is on the page, and the other way round. Select text and choose "Translate in side panel" to translate only that passage.
• Shows what a page cost in tokens, with an optional monthly spend limit.
• Works with the keyboard and screen readers. The interface is available in English and Vietnamese.

PRIVACY, PLAINLY
• Page text goes only to the provider you chose, directly from your browser, when you start a translation. On a site you add to your allowlist, each page you open there is translated automatically while the panel is open, which sends its text to your provider without a click.
• Mail and sign-in pages, browser pages and the Web Store are never read. Password fields and other form fields are never read.
• Your API keys stay on your device. The extension has no analytics and no telemetry, and sends nothing to its developer.
• Access to a provider address or a site (both its http and https addresses, and its subdomains if you enter *.site) is requested one at a time, only when you click, and given back when you remove the setting, unless another setting still uses it.

You need an API key from a provider (many have a free tier) or a local model. Translate Side does not include a translation service.

Source code and documentation: https://github.com/duylongpro99/translate-side
```

**Screenshots** (upload in this order; the files are in [assets/](assets/)):

| # | File | Caption |
|---|---|---|
| 1 | `01-page-and-panel.png` | The translation beside the original page |
| 2 | `02-hover-link.png` | Point at a block to see where it sits on the page |
| 3 | `03-options-providers.png` | Bring your own provider, or run a local model |
| 4 | `04-glossary-and-sites.png` | A personal glossary and rules for sites |
| 5 | `05-vietnamese-interface.png` | The interface in Vietnamese |

**Small promo tile (440×280):** `tile-440x280.png`. **Icon:** `store-icon-128.png` (128×128, artwork 96 px with a 16 px transparent margin, as the store
guidelines ask); the package keeps its own `public/icon/128.png`.

**Official URL / homepage:** https://github.com/duylongpro99/translate-side

**Support URL:** https://github.com/duylongpro99/translate-side/issues

## Privacy tab

**Single purpose:**

> Translate the web page the user is reading, in Chrome's side panel next to the original, with an AI provider the
> user chooses.

**Permission justifications:** paste each paragraph from [permission-justifications.md](permission-justifications.md):
`sidePanel`, `storage`, `activeTab`, `scripting`, `contextMenus`, and the optional host permissions `https://*/*`,
`http://*/*`, `http://localhost/*` and `http://127.0.0.1/*`. Chrome shows the optional hosts under the host
permission justification field; paste the three host sections there: `https://*/*`, `http://*/*`, and the one section that covers both `http://localhost/*` and `http://127.0.0.1/*`.

**Are you using remote code?** No.

**Data usage: what user data is collected?**

- **Website content**: yes. The text of the pages the user translates is sent to the AI provider the user chose.
- **Authentication information**: tick it as well. The user's API key is stored on the device and sent to the
  provider it belongs to, as the credential for each request (the extension itself never receives it anywhere but
  the user's own storage).
- Leave unticked: personally identifiable information, health, financial and payment information, personal
  communications, location, web history, user activity. (The extension keeps no browsing history; the page address
  is used only as a local cache key and is never sent to the provider. See the privacy policy.)

**Certify all three statements:**

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:**
https://github.com/duylongpro99/translate-side/blob/master/docs/privacy.md (it resolves once the branch holding
this file is on `master`).

## Distribution tab

**Visibility: Unlisted** for the first release (installable by link, reviewed like a public item), then Public after
a few days of use. **Regions:** all. **Pricing:** free.

## Test instructions for the reviewer

> The extension needs an AI provider to translate. Without an API key it opens, reads the page and shows the original
> text, and asks for a provider in Settings.
> 1. Install the extension, open any English article, and press Alt+T (or click the toolbar icon). The first-run
>    notice and setup guide ask for a provider and a key; paste the test key below, or use a local model
>    (docs/local-models.md).
> 2. After the notice is acknowledged the panel translates the page next to the original.
> 3. Settings (the gear in the panel) shows providers, glossary, site rules and the privacy controls. Site access is
>    requested only when you press Test connection or add a site.
>
> Test key: *(add a throw-away key with a small spend limit in the dashboard before submitting; never commit it).*

<!--
Reviewer-only: where each statement comes from (paths relative to the repository root).

- Name, description and the interface languages: src/locales/en.yml (extName, extDescription), src/locales/vi.yml;
  scripts/check-manifest.mjs checks both locales.
- Alt+T toggles; macOS rebinding: wxt.config.ts commands, src/shared/toggle-shortcut.ts, src/shared/shortcuts.ts.
- Brief, glossary, styles, validation of code/URLs/numbers: src/engine/stages/analyze.ts, src/shared/settings.ts
  (STYLES, glossary), src/engine/stages/check.ts (via the engine's check stage), README "How it works".
- Hover link and selection translation: src/extract/link.ts, src/entrypoints/sidepanel/follow.ts:187-206,
  src/shared/snippet.ts, src/shared/panel.ts:89-97.
- Cost readout and spend limit: src/shared/cost.ts, src/shared/spend.ts:183-240.
- Local models: src/shared/presets.ts:104-137, docs/local-models.md.
- Privacy claims: each line is cited in docs/privacy.md (reviewer comment at its end).
- Unlisted first: plans/261011-1206-m6-release-hardening/plan.md §8 risk and phase 6 "Risks".
- Data types: plans/reports/researcher-261011-1901-m6-extension-e2e-store-i18n.md §2 ("Website content"). The
  Authentication information box is a conservative addition, flagged to the supervisor as a decision for the user.
-->
