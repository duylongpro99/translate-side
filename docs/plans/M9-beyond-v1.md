# M8 — Beyond v1

Size: unsized · Depends on: v1.0 (M6) and, for some items, M7

## 1. Goal

**Extend the extension's reach (more browsers, providers and content types) and strength
(harder texts) without weakening the privacy and safety guarantees v1 makes.**

M8 is not one release. It's a set of independent tracks, each with its own goal, picked up in
whatever order user demand suggests. They share one rule: each must fit the existing boundaries
(a new adapter, strategy, context provider or shell port) without changing the engine interface,
and each must pass the M6 regression gate.

## 2. Tracks

Each track below is a small plan of its own: goal, done when, and the guarantee it must keep.

### 2.1 `agentic` strategy

- **Goal:** the strongest translation for hard texts (law, research, dense docs), opt-in per
  document.
- **Shape:** an LLM loop with read-only tools: `lookup_glossary`, `search_translation_memory`,
  `get_surrounding_text`, `define_term` (web), `flag_ambiguity`. Uses the M7 revision UI.
- **Done when:** beats `refine` on a hard-text subset of the eval set, at a documented cost.
- **Guarantee to keep (ROADMAP §8 item 14):** `define_term` calls only fixed, allow-listed
  dictionary endpoints, the query is a single term, and it never receives raw page text. Tool
  outputs are untrusted. The DESIGN §8 claim "the model has no tools" is rescoped to
  non-agentic strategies.

### 2.2 Firefox build

- **Goal:** the same reading experience in Firefox.
- **Shape:** WXT target with `sidebar_action`; no Chrome built-in AI path; Firefox CI target.
- **Done when:** M6 e2e suite passes on Firefox for the article and docs fixtures.
- **Guarantee to keep:** same minimal permissions; re-run the S1 question (Firefox event pages
  behave differently from MV3 workers).

### 2.3 Passphrase lock for keys

- **Goal:** keys encrypted at rest for users who want it.
- **Shape:** AES-GCM with a PBKDF2-derived key (WebCrypto); unlock once per session; unlocked
  key in `chrome.storage.session` only.
- **Done when:** keys are unreadable in `chrome.storage.local` while locked; translation prompts
  for unlock instead of failing.
- **Guarantee to keep:** the UI stays honest that an extension can't fully hide secrets from
  someone with access to the browser profile.

### 2.4 `SiteStyleProvider` and `DomainProvider`

- **Goal:** better tone and terminology for specific sites and domains (medical, legal,
  maritime…).
- **Shape:** two new context providers; per-site tone rules; importable domain term lists.
- **Done when:** measurable terminology gain on domain passages added to the eval set.
- **Guarantee to keep:** no stage changes; user glossary still takes priority.

### 2.5 `gemini-native` adapter

- **Goal:** Gemini features that the OpenAI-compatible endpoint doesn't expose.
- **Shape:** a new `ProtocolAdapter` behind `LLMClient`, plus a preset.
- **Done when:** passes the provider matrix run (M4) and the regression gate.

### 2.6 Code-comment translation

- **Goal:** translate comments inside code blocks while leaving code byte-identical.
- **Shape:** comment extraction per language in the segmenter; behind a setting.
- **Done when:** code tokens are byte-identical on all code fixtures; comments translated.

### 2.7 PDF

- **Goal:** read PDFs side by side.
- **Shape:** a new extraction source producing `Segment[]`; everything downstream unchanged.
- **Done when:** text PDFs in the fixture set segment cleanly; scanned PDFs show a clear
  "not supported" state (OCR stays out of scope).

## 3. Picking the next track

Prefer, in order: what beta and store users ask for most; what reuses the most existing
pieces; what carries the least privacy risk. Write a one-page plan in this folder (same structure
as M0–M7) before starting any track.
