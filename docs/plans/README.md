# Milestone plans

One plan per milestone, written around the milestone's **goal**: the question the milestone
answers, what the user (or developer) can do at the end, how we know it's done, and what is
deliberately left out. Ticket-level task lists live in `ROADMAP.md` §3. These plans reference
those task IDs (`M1-E3`, `S2`, …) and don't repeat them in full.

Sources: `DESIGN.md` (draft v0.1) and `ROADMAP.md` (v0.1), both dated 2026-10-05. When a plan
applies a resolution from `ROADMAP.md` §8 (gaps and contradictions), it cites the item number.

| Plan | Goal in one sentence | Cut |
|---|---|---|
| [M0 — Skeleton and spikes](M0-skeleton-and-spikes.md) | Prove the extension shell can read a real page, and settle the architecture unknowns before building on them. | |
| [M1 — Translate end to end](M1-translate-end-to-end.md) | Prove a page can be translated and streamed into the panel by a portable engine that also runs in Node. | |
| [M2 — Contextual quality](M2-contextual-quality.md) | Make translations read as if a native writer wrote them, and prove it with an eval. | |
| [M3 — Reading UX core](M3-reading-ux-core.md) | Make the extension good enough to use every day instead of another translator. | **MVP** |
| [M4 — Providers](M4-providers.md) | Let any compatible endpoint, including local models, be used, and make switching models trivial and safe. | |
| [M5 — Reading UX complete and robustness](M5-reading-ux-complete.md) | Finish the side-by-side experience and survive real sites: SPAs, docs navigation, huge pages, tables. | |
| [M6 — Release hardening](M6-release-hardening.md) | Ship v1.0 on the Chrome Web Store with a gate that stops quality from silently regressing. | **v1.0** |
| [M7 — Stronger translation](M7-stronger-translation.md) | Offer a "Best" mode that measurably beats the default without making reading slower, and learn from user edits. | v1.1 |
| [M8 — Beyond v1](M8-beyond-v1.md) | Extend reach (Firefox, new providers, formats) and strength (agentic) without weakening privacy or safety guarantees. | later |

## How each plan is structured

1. **Goal**: the one outcome the milestone exists for, and why it comes at this point.
2. **Done looks like**: the user-visible or developer-visible result.
3. **Success criteria**: measurable checks. The milestone is not done until all pass.
4. **Out of scope**: things that look related but belong to a later milestone.
5. **Decisions to make**: choices this milestone must close, with the recommended default.
6. **Work plan**: tasks grouped by the sub-goal they serve, in the order to do them.
7. **Demo script**: the exact steps to show the goal is met.
8. **Risks**: what could stop the goal, and the mitigation.
9. **Handoff**: what the next milestone relies on from this one.

## Working assumptions (from ROADMAP §0)

- Chrome only for v1, built with WXT so a Firefox build stays possible.
- Default provider: Anthropic, Claude Haiku 4.5 (`claude-haiku-4-5`), thinking off.
- One target language, switchable globally.
- Term gloss: keep established English terms, add a short gloss on first occurrence only.

If any of these change, see `ROADMAP.md` §6 for the impact on each milestone.
