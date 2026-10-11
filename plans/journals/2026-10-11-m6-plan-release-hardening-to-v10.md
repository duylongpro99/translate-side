---
title: "M6 plan: release hardening to v1.0"
date: 2026-10-11
summary: "Planned M6 in 7 phases; red team reshaped the sync-quota design, the eval gate and the e2e harness before any code."
---

# M6 plan: release hardening to v1.0

## What happened
- The M6 plan was written at `plans/261011-1206-m6-release-hardening/` from `docs/plans/M6-release-hardening.md`. It has 7 phases: the eval gate, the e2e harness, storage versioning, performance and diagnostics, i18n, the store package, and the beta.
- Two read-only scouts and one researcher fed the plan.
- Four red-team reviewers raised about 40 findings, which merged into 15. All were accepted; 4 sub-points were rejected.

## What the red team changed
- **Sync quota:** the first draft chunked the glossary and site rules and kept a "local-only" pointer in sync. That pointer would have reached every device, so other devices, including any still on M5, would see an empty list and could overwrite it. The new keys would also have broken the never-translate and glossary listeners. Redesign: the legacy single sync item is kept, and an oversized list overflows to that device's own local storage. One quota guard replaces the four that existed. Migration runs under a lock with compare-and-set writes.
- **Eval gate:** at chunk 1500 all 23 passages are a single chunk, so the analyze, brief and revise steps never ran. The gate also tested the harness model rather than the shipped default. It now reads `DEFAULT_PROFILE` and `PANEL_STRATEGY`, runs at chunk 400 and compares against the M2 c400 baseline. It uses 5 baseline runs and a 60-minute timeout, fails when the secret is missing, and keeps the secret at step level.
- **E2E:** the production `?tabId=` hook and the separate e2e build mode were dropped. The harness reuses the `ext-run.mjs` pattern: a copied manifest, and the panel in a background tab of the same window, since it follows the active tab of its own window.
- **Diagnostics:** only app-owned fields are stored, one key per entry, written through an injected `onJobEnd`. Site names are left out unless the user opts in. Provider error bodies are never stored.

## Decisions (user)
- **Plain-HTTP endpoints:** the manifest keeps `http://*/*`. The code allows a plain-HTTP provider endpoint only on loopback or a private network, with a warning.
- **Bundle budget:** measured gzip size plus 10%.
- **Panel `patch()`:** fixed in M6 if it is the long task.
- **Execution:** a supervisor loop as in M5, logged in `docs/progress/progress-m6.md`.

## Next steps
- Start the supervisor loop on a branch `m6`.
- The user adds the `AIBOX_API_KEY` Actions secret, and makes sure the OpenRouter account has credit for the Haiku cost run.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
