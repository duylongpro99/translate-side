# Brainstorm: zero-setup translation with Chrome built-in AI

Date: 2026-10-20. Status: accepted (direction C). Next: `ak:plan`, then `ak:cook`.

## Outcome

A fresh install translates a page in the side panel with no API key and no provider setup, using
Chrome's on-device AI. When the device can't run it, the panel says why and offers provider setup.

## Chosen direction: built-in "auto"

Gemini Nano (Prompt API, `LanguageModel`) when `availability()` says it can run; otherwise Chrome's
Translator API (the existing `basic` strategy); otherwise the setup offer. Configured BYOK routes are
unchanged and always win.

## Current evidence

- Nano adapter exists and is unit-tested only: `src/llm/chrome-builtin.ts`; disabled by the compile-time
  flag `CHROME_NANO = false` (`src/llm/client.ts:57`) and refused in `src/entrypoints/sidepanel/route.ts:63`.
- Translator MT port and `basic` strategy ship: `src/llm/chrome-translator.ts`, `src/engine/strategies/basic.ts`,
  but run only as the terminal fallback after a configured provider fails. A user with no key stops at
  "Add your API key" (`route.ts` `noKeyError`) and never reaches them.
- Onboarding's built-in card is disabled, labelled "Coming soon" (`src/entrypoints/onboarding/Onboarding.tsx:193`,
  `src/locales/en.yml` `pathBuiltinSub`).
- Spike S8 (availability states, download time, hardware gating) was never run (`docs/progress/progress-m4.md:298`,
  `progress-m5.md:168`). Chrome for Testing never settles a Translator `create()`, so S8 needs real Chrome.

## Constraints

- Desktop Chrome 138+. Nano needs about 22 GB free disk and a GPU with more than 4 GB VRAM or 16 GB RAM;
  Translator language packs are far lighter. Gate by `availability()`, not by version.
- A `downloadable` model needs a user gesture to create: download must be an explicit click (onboarding
  or a panel button) with progress, not something a job starts.
- Nano's context is small: chunk sizes, the brief and prompts must fit, and `QuotaExceededError` must
  degrade (smaller chunk or Translator), not fail the page.
- On-device: the privacy notice must say page text stays on the device for this path.
- Existing users' routing, fallback chains and settings stay as they are.

## Non-goals

Firefox (M9), Pro/licensing changes, tool calls for Nano, new cloud providers.

## Acceptance criteria

1. Clean profile with on-device AI available: opening the panel on a page translates it with no setup.
2. A `downloadable` model: one-click download with progress, then translation.
3. Device can't run either: a specific reason plus a "Set up a provider" path; never a silent failure.
4. Onboarding's built-in card is enabled and works end to end.
5. Users with a configured provider see no behaviour change.
6. S8 run on real Chrome; results recorded in `docs/decisions/`.
7. Blocks are labelled with the engine that produced them (Nano vs basic translation).

## Trade-offs (options compared)

| Option | Load-bearing assumption | Fails first when |
|---|---|---|
| A. Translator only | Literal, context-free translation is acceptable for free use | Idioms, glossary or context-dependent text |
| B. Nano only | Marker grammar and prompts survive a small model and context | Most hardware lacks Nano; long blocks hit quota |
| C. Auto (chosen) | Both, each checked at runtime | More states to test and explain |

## Better approaches

Chrome's dedicated Translator API is likely a better zero-setup engine than Nano for plain
translation (faster, purpose-built, far wider hardware), so it is the guaranteed floor and Nano the
upgrade. Direction C reflects this.

## Risks for the plan

- Nano may not follow the segment marker grammar (`src/engine/parsing`) reliably. Spike before
  committing: run the single-pass prompt on Nano against eval fixtures and measure parse failures and quality.
- Download UX: availability can change mid-session (`downloading` → `available`); the panel must re-check.
- Where the API lives: Translator is used from the panel window today; confirm `LanguageModel` works in
  the side panel context in the target Chrome version.

## Unresolved questions

1. Should the user be able to force Translator over Nano (speed vs quality), or is auto enough for v1?
2. Should zero-setup be the default route on update for existing users who never configured a key, or only for new installs?
