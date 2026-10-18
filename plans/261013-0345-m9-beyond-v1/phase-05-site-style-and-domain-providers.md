---
title: "Phase 5: Site style and domain providers"
status: todo
priority: P3
effort: "2.5d"
dependencies: []
tier: pro
feature_id: domain-packs
---

# Phase 5: Site style and domain providers

## Goal

Better tone and terminology for specific sites and domains (medical, legal, maritime…) through two new context
providers, per-site tone rules and importable domain term lists, with no stage changes and the user glossary still
first (M9 §2.4). Pro feature id `domain-packs` (covers per-site tone too, per the pricing table).

## Context links

- Spec: `docs/plans/M9-beyond-v1.md` §2.4; DESIGN §5.4 (context providers).
- Scout: `plans/reports/scout-261013-1036-m8-track-surfaces.md` §4.
- Provider contract: `src/engine/types.ts:296-320` (`ContextQuery`, `ContextProvider`; document-scoped snippets must
  not depend on the chunk, `:316-317`).
- Defaults and budget: `src/engine/context/budget.ts:13` (1500 tokens), `:33` (`DEFAULT_CONTEXT_PROVIDERS`), `:35-…`
  (`gatherContext`: in order, each gets what the earlier ones left, capped by its `maxTokens`); the only caller is
  `src/engine/strategies/single-pass.ts:315`; `EngineDeps.context` (`src/engine/engine.ts:42-43, 310`).
- Rendering: document snippets from providers other than brief and glossary are appended to the system prompt
  (`src/engine/context/assemble.ts:46-47`), so a new provider needs no prompt-template change.
- Glossary priority: `mergeGlossary` (`src/engine/context/glossary.ts:30-40`); `glossaryProvider` (`:226-241`).
- Site matching: `SiteRule`, `siteRuleFor` (`src/shared/providers.ts:110-116, 727`); sync quota helper
  `src/shared/sync-quota.ts:20-25`; glossary cleaning `cleanGlossary` (`src/shared/settings.ts:340`).
- Soft dependency: M7 phase 6 (translation-memory provider) proves the provider-from-shell-data pattern
  (`plans/261013-0348-m7-stronger-translation/phase-06-translation-memory-provider.md`). Not required.

## Requirements

- **`SiteStyleProvider`** (`id: 'site-style'`, document scope, `maxTokens` 100): the tone rule for `doc.url`'s host,
  e.g. "Formal, address the reader as quý vị". One rule per host pattern, tone text ≤ 200 characters.
- **`DomainProvider`** (`id: 'domain'`, document scope, `maxTokens` 300): terms from the packs active for this
  document (global "always on" packs plus packs named by the site rule), restricted to terms that occur anywhere in
  `q.segments` (document-scoped, so chunk-independent), minus every term in the personal glossary
  (`q.options.glossary`, case-insensitive as `mergeGlossary` keys them). Rendered as one block under a clear heading
  ("Domain terms: use these unless the user glossary says otherwise").
<!-- Red Team: provider list drops M7 memory; gate cannot sit in sync code -->
- Order: the entitled list is built from `DEFAULT_CONTEXT_PROVIDERS` with `site-style` and `domain` inserted right
  after `glossary` (document-scoped first, `budget.ts:32` comment), never hand-written. With M7 phase 6 landed that is
  `[brief, glossary, site-style, domain, context-tail, translation-memory]`; without it, the same list minus memory.
  Any provider a later plan adds to the defaults is kept automatically.
- No change to stages, strategies, prompt templates or `CONTEXT_BUDGET_TOKENS`. With no rules and no packs, every
  prompt is byte-identical to the prompts of the base commit, that is, as M7 left them when M7 has landed, else v1
  (test).
- Shares: site style and domain take at most 100 + 300 tokens before the context tail and translation memory. A test
  records the tail's and the memory's shares on a fixture with a full pack and a typical brief. If memory gets less
  than M7's own tests expect (M7 phase 6: what is left, up to 400 of 1,500), lower the domain cap until it does; the
  budget constant does not change.
- Storage:
  - site style rules in `storage.sync` under one key `siteStyles` through the M6 sync-quota helper (overflow to this
    device's local storage as M6 designed), at most 100 rules;
  - packs in `storage.local`, one key per pack `domainPack:<id>` `{ id, name, domain, entries }`, at most 2,000 entries
    per pack and 20 packs; packs are not synced (size).
- Import a pack from JSON or CSV (`term,rendering,note`), reusing the glossary import cleaning; export a pack.
  Settings export includes site style rules; packs export as their own files (the settings export is capped at 1 MB,
  `src/shared/portable.ts:57`).
<!-- Updated: Validation Session 1 - gate resolved once and stored -->
- Gate: `defaultEngine` and `engineFor` are synchronous (`jobs.ts:1240, 1296, 1311`), so the gate cannot sit there.
  `featureAvailable('domain-packs')` is awaited once in the async job start (`Jobs.start`, before the `engineFor` call
  at `jobs.ts:899`), together with the snapshot reads (site style rule for the URL, active packs). The result and the
  snapshot are stored on the job; `engineFor`/`defaultEngine` read the stored values, and so do the explain and redo
  paths that reuse the job (`jobs.ts:1129, 1197`). Not available → no snapshot → `EngineDeps.context` absent → the
  defaults (with M7's memory provider when M7 has landed).

## Architecture

```
Options: Site styles (pattern, tone, packs[])  → storage.sync 'siteStyles' (sync-quota helper)
         Domain packs (import/export, always-on) → storage.local 'domainPack:<id>'
Panel job start (Jobs.start, async, before engineFor at jobs.ts:899):
  job.domainPacks = await featureAvailable('domain-packs')    ← the one gate call site, stored on the job
    ? { rule: siteStyleFor(url), packs: active packs }         (snapshot read once per job)
    : undefined
engineFor / defaultEngine (sync) read job.domainPacks:
  context = withSiteAndDomain(DEFAULT_CONTEXT_PROVIDERS, snapshot)   (inserted after glossary)
  or undefined (the defaults)
Engine: gatherContext → document snippets → system prompt (assemble.ts:46-47), byte-stable across chunks
```

Data enters the engine only through closures over a per-job snapshot (engine boundary, `check:engine`).

## Related files

- **Create:** `src/engine/context/site-style.ts`, `src/engine/context/domain.ts` and their tests;
  `src/shared/domain-packs.ts` (storage, import, export) and its test; `src/shared/site-styles.ts` and its test;
  `src/entrypoints/options/DomainPacks.tsx`, `src/entrypoints/options/SiteStyles.tsx`; `eval/passages/*` (domain
  passages with `category: medical|legal|maritime`, public-domain or CC sources with attribution); `eval/packs/*.json`
  (test packs).
- **Modify:** `src/engine/context/budget.ts` (export `withSiteAndDomain(defaults, snapshot)` and the provider
  factories next to the defaults; `DEFAULT_CONTEXT_PROVIDERS` itself unchanged), `src/engine/index.ts` (exports), `src/entrypoints/sidepanel/jobs.ts` (the gate in `Jobs.start` before `:899`, the stored snapshot on the job, the list in `defaultEngine`),
  `src/shared/portable.ts` (site style rules in the settings export), `src/shared/features.ts` (only if absent),
  `scripts/eval/run.ts` (`--pack <file>` and `--site-tone <text>`), `scripts/eval/report.ts` (pack-term hit rate),
  `eval/README.md`, `src/locales/en.yml`, `src/locales/vi.yml`, `scripts/bundle-budget.json`.

## Steps

1. Write `docs/plans/M9-site-style-and-domain.md` (M9 §3). Add `domain-packs` to `FeatureId` in `src/shared/features.ts` if missing.
2. Providers: `createSiteStyleProvider(snapshot)` and `createDomainProvider(snapshot)` in `src/engine/context/`,
   both pure, both escaping tags with `neutralizeContextTags` (`assemble.ts:64-68`) and fitting their `maxTokens`
   (longest-first cut for domain terms, personal terms removed first).
3. Tests: chunk independence (same snippet text for every chunk of a document); personal glossary wins on a
   conflicting term; no rules and no packs → prompts byte-identical to the base commit's for every eval fixture; the
   entitled list still contains every default provider, including `translation-memory` when M7 has landed; the
   context tail and memory shares with a full pack are recorded and memory's meets M7's expectation.
4. Storage modules and their caps; sync-quota path for `siteStyles` with the M6 overflow tests.
5. Options UI: Site styles list (pattern, tone, packs) and Domain packs (import, export, rename, delete, always on),
   shown disabled when locked, with `<ProLock>` (`pro.locked`) beside each locked control only; a pack choice in a
   shared select is a disabled option with a "(Pro)" suffix.
6. Gate in `Jobs.start` before `engineFor` (`jobs.ts:899`): await `featureAvailable('domain-packs')` once, read the
   snapshot once, store both on the job; `engineFor`/`defaultEngine` build the list from the stored snapshot.
<!-- Red Team: eval margin built for a different sample -->
7. Eval: add 9 domain passages (3 each for medical, legal, maritime) and one pack per domain; add `--pack` and a
   deterministic pack-term hit rate to the report (source occurrences of pack terms rendered with the pack's
   rendering). Run each arm (with and without packs) at least 3 times on the domain passages, judge every run, and
   record per-run and per-passage tables, the SD of the run means on this subset, and the passage-level win rate.
8. Run `pnpm run eval:gate` (shipped default, no packs) and record it.

## Todo

- [ ] One-page track plan; `domain-packs` in `FeatureId`
- [ ] Two providers with tests (chunk independence, glossary priority, byte-identity with the base commit, every default provider kept)
- [ ] Storage, caps, sync-quota path
- [ ] Options UI for site styles and packs
- [ ] Gate awaited once in `Jobs.start`, stored on the job; list built from the defaults in `defaultEngine`
- [ ] Domain passages, test packs, `--pack`, hit-rate metric
- [ ] With/without runs (≥ 3 per arm) judged; SD, win rate and hit rate recorded
- [ ] Eval gate recorded

## Success criteria

<!-- Red Team: eval margin built for a different sample -->
- M9 §2.4 done when: measurable terminology gain on domain passages added to the eval set. Read as, over at least 3
  runs per arm on the 9 domain passages: (a) the pack-term hit rate is higher with packs in every run; (b) the judge
  terminology mean with packs exceeds the mean without by more than max(2 × SD of the run means on this subset, 0.20);
  (c) with packs scores at least as well on terminology on at least 80% of the passages; and fidelity and naturalness
  do not drop by more than the same margin.
- With no rules and no packs, prompts are byte-identical to the base commit's (test), the entitled list keeps every
  default provider (test), and `pnpm run eval:gate` is green.

## Guarantee to keep

No stage changes; user glossary still takes priority (personal terms are removed from the domain block and stay first
in the glossary block via `mergeGlossary`).

## Verification

```
pnpm run test -- src/engine/context
pnpm check
pnpm run e2e
pnpm run eval -- --set eval --strategy contextual --chunk-tokens 400 --docs <domain slugs>
pnpm run eval -- --set eval --strategy contextual --chunk-tokens 400 --docs <domain slugs> --pack eval/packs/<domain>.json
pnpm run eval:judge && pnpm run eval:report
pnpm run eval:gate
```

## Risks

| Risk | L × I | Mitigation |
|---|---|---|
| A full glossary plus a pack starves the context tail or M7's translation memory | Medium × Medium | Domain cap 300 tokens; the list is built from the defaults so memory stays; step 3 records both shares; if the tail drops below 200 tokens or memory below M7's expectation, lower the domain cap rather than change the budget |
| Pro users lose M7's memory because the list was hand-written | Low (by design) × High | `withSiteAndDomain` inserts into `DEFAULT_CONTEXT_PROVIDERS`; a test asserts every default provider id is present |
| Gain is within judge noise | Medium × Medium | ≥ 3 runs per arm, a margin from this subset's SD, a passage win rate, and the deterministic hit rate |
| Sync quota pressure from site rules | Low × Medium | 100-rule cap, 200-char tone, M6 overflow helper |
| Imported pack text tries prompt injection | Medium × Low | Tags neutralised; the block is labelled as data; output is rendered as text only (DESIGN §8) |

## Security

Packs and tone rules are local user data; nothing new leaves the device except as part of the prompt to the user's
chosen provider. Imported files are parsed with the existing caps and cleaning, never evaluated.

## Rollback

Not available or reverted wiring → the default providers (the v1 three, plus M7's memory provider when present). Stored rules and packs stay inert.
