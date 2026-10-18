---
title: "Phase 3: Best mode in the panel"
status: todo
priority: P2
effort: "2d"
dependencies: [1]
---

# Phase 3: Best mode in the panel

## Goal

The panel can run a page with `refine`: drafts appear as fast as in Balanced, then blocks are replaced by the
reviewed revision with a subtle "refined" marker, ahead of the screen first. A rejected review, a budget that runs
out or a review route that cannot run never blanks or fails a block. Refined text is cached under its own key.

## Context links

- Source: `docs/plans/M7-stronger-translation.md` §2 rows 2–3, §3 #3, #4, §5 rows 2–3, §7 demos 2–4, §8 row 2.
- Spec: `DESIGN.md` §5.2 (the panel replaces the text with a "refined" marker), §7 (cache key).
- Scout: risks 1 (the panel fold), 3, 4, 9 (e2e mock), 11 (the reload half; edits are phase 5).

## Requirements

<!-- Red Team: selections run refine -->
<!-- Updated: Validation Session 1 - feature access resolved once per job start -->
1. The strategy is chosen per run, not per `Jobs` instance. `JobDoc.strategy` is the *requested* strategy; the
   *effective* one is resolved once at `start()` and stored on the job (`job.strategy`). Precedence:
   `deps.strategy ?? doc.strategy ?? PANEL_STRATEGY`, so the snippet `Jobs`' `single-pass` seam
   (`translator.ts:113-115`) always wins. A requested `refine` runs `contextual` when
   `await deps.featureAvailable('best-mode')` is false, whatever asked for it (header mode, advanced override or an
   imported setting).
2. The `review` role resolves through routing (`Routing.review`, else the translate route).
3. Refined blocks carry a marker and keep their draft for a "Show draft" toggle during the session.
4. Under refine, cache hits below the review revision are shown at once as drafts and sent for review only; the
   Balanced cache serves as drafts on a Best miss.
<!-- Red Team: reviews hold up lazy rounds -->
5. Lazy pages: once a round's drafts are done, reaching the low-water mark (or leaving the window) drops the round's
   pending reviews, so the next round waits at most for the review calls already in flight (≤ `maxConcurrency`).
6. Optional "keep drafts on screen until I scroll": a refined revision for a block on screen waits until it leaves
   the screen. The setting's storage and UI are phase 4; this phase reads it from `JobDoc`.

## Decisions on scout risks

- **Risk 1 (panel fold).** `applySegmentEvent` (`jobs.ts:196-214`) is unchanged for failures; refine never sends
  `segment.failed` from review (phase 1). A test folds draft (rev 1) → revise (rev 2) → review (rev 3), and a
  rejected review (no event), and asserts the shown text each time.
- **Risk 3 (cache key).** `strategyKeyInfo` (`src/shared/cache.ts:66-72`) gets a `REFINE_CACHE_KEY` branch with its
  three prompt ids. Best and Balanced entries never share a key. `putMany` (`cache.ts:199`) already keeps the higher
  revision, so revision 3 replaces the draft entry.
<!-- Red Team: Best cache keyed by the review model -->
- **Review model in the key, not in the row's scope.** `keyScope` gains an optional `reviewModel`, hashed into the
  scope only for `refine` (`scopeHash`, `cache.ts:87-89`), so changing "Review with" invalidates Best entries.
  Review finals are written under the job's own key (`job.keys`), never through `keyFor(job, id, state.model)`
  (`jobs.ts:1465`, `:1482-1491`), so a reload's lookup with the translate model (`jobs.ts:1419`) finds them. The
  fallback badge (`jobs.ts:49-52`) stays for translate fallbacks only: a review final's `SegState.model` is the job's
  model, and the review model goes in `SegState.reviewModel` for the "Show draft" tooltip.
<!-- Red Team: reviewed is a cache fact -->
- **"Reviewed" is a cache fact.** `CachedSegment` (`cache.ts:17-21`) gains an optional `refined?: true`; the row
  shape is schemaless, so no DB version change. From the chunk report (phase 1), `accepted` ids are written with
  revision 3 and `refined: true`; `unchanged` and `rejected` ids are written with revision 3 and the draft text. A
  refine-scope hit with revision ≥ 3 is final (refined only when `refined`), so a reviewed page reloads with zero
  calls even when the review changed nothing.
- **Risk 4 (budget scope), verified.** `doc.budgetTokens` becomes `options.budget.maxTokens` on every `start()`
  (`jobs.ts:921`), and each lazy round enters `start()` again through `resume()` (`jobs.ts:1036`) or
  `translateRest()` (`:1573`). So the budget is per run, which in lazy mode means per round. **Decision:** keep it
  per run, as it has been since M5, for both modes (accepted by the owner, Validation Session 1). Changing it would
  change Balanced too. <!-- Red Team: review budget reserve --> The review's reservation (phase 1) counts the
  review client's reasoning reserve and the calls in flight, so concurrent reviews cannot both pass the check. A
  call can still exceed its own estimate; the budget is a ceiling checked before calls, as it is for drafts. Phase 7
  states the per-run meaning in the settings hint.
- **Review route failure.** When the review route cannot run (no key, no access), the run goes on as `contextual`
  for that run, with its cache scope, and the job bar says "Review unavailable: <reason>". It never stops the run,
  because Best must never translate less than Balanced.

## Architecture and data flow

```
translator.docFor ─► JobDoc { …, strategy? (requested), keepDraftsOnScreen? }        (phase 4 fills both)
Jobs.start: requested = deps.strategy ?? doc.strategy ?? PANEL_STRATEGY
            job.strategy = requested === 'refine' && !(await deps.featureAvailable('best-mode')) ? contextual : requested
            (the one async read; every later sync read — engine, cache scope, diagnostics — uses job.strategy)
  translateClient({ analyze, review: strategy === 'refine' })  ─► route.ts reviewClient (like analyzeClient :96)
  analyze and review resolvers awaited together; review failed → strategy := contextual, notice
  fromCache (refine scope): rev ≥ 3 → final (refined) | rev < 3 → final (draft), into drafts | miss → contextual
           scope lookup → drafts
  engineJob { strategy, drafts, segments: todo ∪ drafted }
  onEvent: segment.final with producedBy.stage 'review' → SegState { refined: true, draft: previous text }
           held while on screen if keepDraftsOnScreen; released by setViewport when the block leaves the screen,
           or at finish()
  remember(): stored under the refine scope with job.keys (translate model), so the highest revision wins
  chunk event review → accepted: rev 3 + refined | unchanged, rejected: rev 3 + draft text (reviewed, not refined)
  lazy: stage 'drafts' done → job.draftsDone; low water or leave() while draftsDone → job.reviewWanted = false
```

## Related files

- **Modify:**
  - `src/entrypoints/sidepanel/jobs.ts`: `JobDoc` (`:507-530`); `SegState` (`:39`) gains `refined?` and `draft?`;
    `job.strategy` replacing `this.deps.strategy ?? PANEL_STRATEGY` at `:852`, `:916`, `:1419`, `:1489` and `:1604`;
    `JobsDeps.featureAvailable?` (default: always true; phase 4 wires `src/shared/features.ts`);
    `defaultEngine` (`:1311-1328`), which routes `review` and adds `refine`; `fromCache` (`:1411-1458`) and drafts;
    `onEvent`; `setViewport` (`:669`) for held revisions; `finish` (`:1520`); the diagnostics record (`:1595-1615`);
  - `src/entrypoints/sidepanel/route.ts` (`reviewClient`, and the `review` resolver in `translateClient` at `:112`);
  - `src/entrypoints/sidepanel/SegmentList.tsx`: the marker in `statusAttrs` (`:164`) and `Block` (`:254`, with
    `shouldComponentUpdate` at `:255` still comparing `state`); a "Show draft" toggle in `BlockActions` (`:97`);
  - `src/entrypoints/sidepanel/JobBar.tsx` (the review-unavailable note), `src/entrypoints/sidepanel/style.css`;
  - `src/shared/cache.ts:17-21` (`refined?`), `:66-72` (refine branch), `:79-89` (`reviewModel` in the scope); `src/shared/diagnostics.ts` (`JobRecord` at `:39` gains `review?: { accepted, unchanged, rejected, skipped }`);
  - `src/locales/en.yml` and `src/locales/vi.yml` (marker label, "Show draft", "Review unavailable");
  - `e2e/servers.ts`: `MockCall.kind` gains `'review'`; a user message that starts with `<review>` is answered with
    `rv:` plus the draft for even ids and nothing for odd ids, and `<none/>` for a one-segment chunk;
    `control.reviewWith(fn)` makes failing candidates; each call records its model;
    <!-- Red Team: reviewed is a cache fact -->
  - `e2e/flows.spec.ts` (Best flows).
- **Tests to update or add:** `jobs.test.ts`, `jobs.cache.test.ts`, `jobs.diagnostics.test.ts`, `lazy.test.tsx`,
  `blocks.test.tsx`, `a11y.test.tsx`, `src/shared/cache.test.ts`, `src/locales/locales.test.ts` (keys match).

## Implementation steps

1. Add `JobDoc.strategy?` and `keepDraftsOnScreen?`, `JobsDeps.featureAvailable?` and `job.strategy`, resolved once
   at the top of `start()` with the precedence above. Replace the five sites listed above with `job.strategy`.
   `defaultEngine`, the cache scope and the diagnostics never call the Promise. Tests: the snippet `Jobs` with a doc
   asking for `refine` runs `single-pass` with no analyze call; `featureAvailable` false with `refine` requested
   runs `contextual`. <!-- Red Team: selections run refine -->
2. `defaultEngine`: `strategies: [singlePass, contextual, refine, explain, basic]`. `llm('review')` returns the
   resolved review client, else the translate client. Fallback links are shared, as for analyze.
3. `route.ts`: `reviewClient(api, target, translateProfileId)` mirrors `analyzeClient` (`resolveRoute(api, 'review',
   target)`, which already falls back to translate at `src/shared/providers.ts:769-772`). `start()` awaits it in
   parallel with the analyze resolver, so the first request is not delayed by a second sequential storage read.
4. The fold: in `onEvent`, a final whose `producedBy.stage` is the review stage id sets `refined: true` and keeps
   the previous text as `draft`. A cache hit with `revision >= REVIEWED_REVISION` sets `refined: true` with no draft.
5. Cache: add the refine branch to `strategyKeyInfo` and `reviewModel` to the refine scope. In `fromCache`, under
   refine, split the hits as in the data flow; for misses, compute the contextual scope's keys and read them as
   drafts. The drafted segments stay in the engine job's segments, the draft map goes in `engineJob.drafts`, and the
   counts treat drafts as final. Write review outcomes with `job.keys` as in the decisions above. Tests: review and
   translate on different models, then reload → zero calls and no fallback badge; a review answering `<none/>` for
   every id, then reload → zero calls. <!-- Red Team: Best cache keyed by the review model -->
6. Lazy rounds (`reach` needs `status === 'done'`, `jobs.ts:1555`; `leave` returns while a screen block is in the
   window, `:1545-1547`): on the `drafts` stage event set `job.draftsDone`. Pass `reviewWanted: () =>
   job.reviewWanted` in the engine job. In `setViewport` (`:669-682`), while a lazy refine job runs with
   `draftsDone`, a screen that reaches `LAZY_LOW_WATER` of the round's end, or leaves its window, sets
   `job.reviewWanted = false`; the round then ends after the in-flight reviews and `reach` starts the next one.
   Dropped blocks stay as drafts (cached below revision 3, reviewed on a later visit). Tests: the reader scrolls
   inside the window during reviews and the next round starts before the round's remaining reviews would have run;
   the reader leaves the window, likewise. <!-- Red Team: reviews hold up lazy rounds -->
7. Held revisions: with `keepDraftsOnScreen`, a refined final for a block in `screenOf(tabId, docId)` is parked in
   `job.held` and applied when `setViewport` reports the block off screen, or when the job finishes.
8. The marker: a small "refined" dot after the block's text, with `aria-label`/`title` from the locale, and no
   motion when `prefers-reduced-motion` is set. "Show draft" appears only when `draft` is present.
9. Diagnostics: review counts and the run's actual strategy (after any downgrade).
10. The e2e mock and flows: Best on a fixture with markers appearing; `reviewWith` failing candidates keep the
    drafts with no failed block; a tiny budget (drafts fit, review does not, from the mock's deterministic usage)
    keeps the drafts with no failure; a reload shows refined blocks from the cache with zero mock calls, with the
    mock answering `<none/>` for part of the page and the review routed to a second mock model; the first visible
    draft time in Best is within 10% of Balanced on the same mock.

## Todo

- [ ] Effective strategy resolved once per `start()` (`job.strategy`, five sites); `deps.strategy` wins; Best gated by `featureAvailable`
- [ ] Snippet test: Best requested, selection runs single-pass with no analyze call
- [ ] Review role routed in `defaultEngine` and `route.ts`; failure → contextual with notice
- [ ] Fold test: rev 1 → 2 → 3, rejected review, review call failure
- [ ] Refine cache branch with `reviewModel`; review finals under `job.keys`; `refined` and reviewed-unchanged rows; drafts from a Best hit below rev 3 and from the Balanced scope
- [ ] Reload tests: different review model; all-`<none/>` review
- [ ] `drafts` event, `reviewWanted`, low-water drop; lazy tests inside and outside the window
- [ ] Held revisions with `keepDraftsOnScreen`
- [ ] Marker and "Show draft", en and vi keys, a11y test
- [ ] Diagnostics review counts
- [ ] e2e mock review shape and `reviewWith`; Best flows (markers, rejection, budget, reload, first-draft timing)

## Success criteria

- §3 #3 (mock): in e2e, Best's first visible draft is within 10% of Balanced's. The live measure is phase 7.
- §3 #4: the tiny-budget flow ends with every block final, no failed block and no refined marker.
- A reload of a refined page makes zero calls and shows the markers, also when the review changed nothing and when
  "Review with" is another model.
- On a lazy page, the next round never waits for more than the review calls in flight (lazy test).
- A selection never runs `refine` or analyze.
- No regression: every existing `jobs*.test.ts` and e2e flow passes unchanged, and Balanced requests are
  byte-identical (the e2e mock's captured prompts on a fixture are compared with a Balanced run before the change).

## Verification

- `pnpm vitest run --project shell src/entrypoints/sidepanel src/shared/cache.test.ts`
- `pnpm check`
- `pnpm run e2e`

## Risks

| Risk | L × I | Mitigation |
|---|---|---|
| Drafts from the cache count wrongly (counts, `owed`, the lazy `stalled` check at `:1527`) | M × M | Tests on counts with drafts; drafts are `final` in `segs`, so the existing rules see them as done. |
| Cross-scope draft lookup reads Balanced entries made under another glossary or style | L × M | The contextual scope key includes style, gloss and glossary (`cache.ts:87-89`), so only exact matches hit. |
| A held revision is lost when the panel closes | L × L | It is in the cache already (`remember` runs at the event); only the on-screen swap is deferred. |
| Review on a 100-screen lazy page delays the next round | M × M | Pending reviews are dropped at low water once drafts are done; at most the in-flight calls are waited for; lazy tests plus `perf.spec.ts` once in Best. |

**Rollback.** Without `JobDoc.strategy` set, every run is Balanced, as before. Reverting the phase leaves the
engine's `refine` unused. Refine cache entries are under their own keys, so they are never read by Balanced, and
they age out by LRU.

## Security

No new permission or host. Review requests go to the routed review profile, under the same local-only site rules
as translate: on a local-only site `resolveRoute` ignores `Routing.review` and uses the site rule's own model,
which must be local (`src/shared/providers.ts:760-770`).
Diagnostics hold only counts.
