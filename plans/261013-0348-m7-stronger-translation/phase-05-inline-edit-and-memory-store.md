---
title: "Phase 5: Inline edit and memory store"
status: todo
priority: P2
effort: "2d"
dependencies: [4]
---

# Phase 5: Inline edit and memory store

## Goal

Any translated block can be edited inline. The correction is saved locally as a (source, corrected target) entry,
shown again for the same source after a reload or on another page, and never silently overwritten by a retranslate
or a later revision. The entries can be exported, imported and cleared.

## Context links

- Source: `docs/plans/M7-stronger-translation.md` §2 row 5, §5 row 4, §6 M7-E4, §7 demo 5.
- Spec: `DESIGN.md` §7 (caching and storage), §8 (privacy).
- Scout: risks 5, 10, 11.

## Requirements

1. An Edit action on every final block opens an inline editor with the shown text, light markers included. Save
   (Ctrl/Cmd+Enter or the button) and Cancel (Esc). It is keyboard and screen-reader usable.
2. A saved edit replaces the block's text at once, marks it "edited", and is stored in the memory store.
3. The same source in the same target language shows the edit on any later run, before the cache and the engine,
   and it is never sent to the model.
4. Engine events for an edited block (a late final, a review revision, a failure) are ignored.
5. Retranslate page keeps the edited blocks. Retranslate on an edited block asks first and, when confirmed, deletes
   the entry and retranslates.
6. Options: the entry count, Export, Import and Clear translation memory.
<!-- Red Team: local-only corrections leak to cloud -->
7. Each entry records where it came from: the page `origin`, whether the run was under a local-only site rule
   (`localOnly`), and its provenance (`by: 'user' | 'import'`). Phase 6 filters on these before anything is sent.
<!-- Red Team: imported memory is untrusted -->
8. Imported entries are checked (`checkSegment(source, target)` must pass), marked `by: 'import'`, and act only as
   phase 6 examples, never as exact-source overrides, unless the user ticks "Also replace matching blocks" in the
   import preview. An override from an imported entry shows an "imported" marker, distinct from "edited".

## Decisions on scout risks

- **Risk 5 (IndexedDB upgrade).** A **separate database**, `translate-side-memory` at version 1, with an
  `entries` store. The cache DB stays at version 1 (`src/shared/cache.ts:149`). The reasons:
  1. The cache is disposable: LRU eviction (`cache.ts:13`) and "Clear cache" (`src/entrypoints/options/Options.tsx:560`). Edits are user data and must
     survive both.
  2. No version change on a DB that other open panels hold (`cache.ts:155-160` closes on `versionchange`).
  3. The M6 cache-reopen test stays valid.

  **Backup and migration note.** There is no migration, since the DB is new. Later schema changes bump this DB's own
  version in its `onupgradeneeded`. Backup is the export file. Uninstalling the extension deletes both databases.
- **Risk 11 (edits and cache).** Edits are an override layer, not cache writes: an edit applies across models,
  strategies and styles for the same source and target language, while a cache entry is scoped to all three
  (`cache.ts:87-89`). `fromCache` reads the overrides first, even on a fresh run (`run.fresh` returns early at
  `jobs.ts:1422` today, so the override read goes before that line).
- **Risk 10 (export size).** The memory has its **own export file** (format `translate-side-memory`, version 1),
  separate from the settings file, which keeps its 1 MB limit (`src/shared/portable.ts:57`). Exporting it is an
  explicit action, which satisfies "only if the user opts in" (§5 row 4). Caps: 5,000 entries
  (`MAX_MEMORY_ENTRIES`), 4,000 characters per side, 10 MB import (`MAX_MEMORY_IMPORT_BYTES`).
- **At the cap,** saving evicts the least recently updated entry, and Options shows "N of 5,000". This is stated in
  the UI, never silent.
<!-- Updated: Validation Session 1 - translation-memory split confirmed -->
- **Edits are free** (owner decision, Validation Session 1). Inline editing and the exact-source reuse of your own
  edits are not gated. Only retrieval of *similar* entries into prompts (phase 6) is the Pro `translation-memory`
  feature.
<!-- Red Team: local-only corrections leak to cloud -->
- **Provenance.** `origin` is `new URL(doc.url).origin`; `localOnly` is true when the run's route was local-only
  (`JobView.localOnly`, set at `jobs.ts:860` from `resolved.localOnly`, `:148`). An exact-source override is display only
  (nothing is sent), so it applies on every site; the sending rules are phase 6's. A later edit of the same key
  keeps `localOnly` true if either edit was local-only.
<!-- Red Team: imported memory is untrusted -->
- **Import trust.** Imported text is untrusted model input and untrusted display text. Validation: size cap before
  parsing, schema, lengths, control characters, `checkSegment` per entry (failures skipped and counted in the
  preview), and imported `origin`/`localOnly` fields ignored (imported entries are `by: 'import'`, origin
  `import`, `localOnly: false`). Tag neutralisation in phase 6 still applies; an injected instruction can only reach
  the model as a marked example, the same exposure as page text.

## Architecture and data flow

```
SegmentList Edit ─► actions.edit(id, text) ─► Jobs.edit(tabId, id, text)
  segs[id] = { status: final, text, edited: true, revision, attempt }; job.retrying abort for id
  deps.memory.put({ key: memoryKey(targetLang, source), source: normalizeForKey(inlineMarkup), target: text,
                    sourceLang, targetLang, origin, localOnly, by: 'user', override: true, created, updated })
Jobs.start ─► fromCache: overrides = memory.getMany(keys of all translatable)   (before the fresh early return)
  hit with override: true → segs final edited (or imported), removed from todo and from drafts
Import ─► parse, validate, checkSegment ─► preview { valid, skipped } ─► importMany(by: 'import', override: ticked)
applySegmentEvent(cur.edited) → cur (ignored)
Retranslate (block, edited) → confirm → memory.delete(key) → redoSegment
Options ─► memory.count / export / import (validated, capped) / clear
```

`memoryKey` reuses `normalizeForKey` (already exported, `src/shared/cache.ts:53-55`) and `hash53` from
`@/segment/hash` (as `cache.ts:9` does), so an override and a cache key normalise source text the same way.

## Related files

- **Create:** `src/shared/memory.ts` (`openTranslationMemory`, `memoryKey`, caps, export and import parsing) and
  `src/shared/memory.test.ts` (with `fake-indexeddb`); `src/entrypoints/options/Memory.tsx` and its test.
- **Modify:**
  - `src/entrypoints/sidepanel/jobs.ts` (`SegState.edited?`, `edit()`, `discardEdit()`, the overrides in
    `fromCache`, `applySegmentEvent` `:196`, `redoSegment` `:1147`, and Retranslate page keeping edits);
  - `src/entrypoints/sidepanel/SegmentList.tsx` (`SegmentActions` `:11` gains `edit` and `discardEdit`; the editor;
    an "edited" marker; the two-step Retranslate in `BlockActions` `:97`);
  - `src/entrypoints/sidepanel/App.tsx:363` (actions passed in); `src/entrypoints/sidepanel/translator.ts`
    (`Jobs` at `:112` gets `memory`; the snippet `Jobs` at `:115` does not; `editSegment` and `discardEdit` join
    the page actions wired at `:508-511`);
  - `src/entrypoints/sidepanel/blocks-nav.ts` (an `E` key for Edit, if the existing keys allow it);
  - `src/entrypoints/options/Options.tsx` (mounts `Memory.tsx` after `CacheSection`, `:543` and `:747`, with the
    memory store injectable like `cache` at `:730`);
  - `src/entrypoints/sidepanel/style.css`, `src/locales/en.yml`, `src/locales/vi.yml`.
- **e2e:** `e2e/flows.spec.ts` (edit and reload, Retranslate page keeps the edit, block Retranslate asks).

## Implementation steps

1. Write `memory.ts`: open with `onupgradeneeded` creating `entries` (keyPath `key`, indexes `targetLang` and
   `updated`), the same dead-handle handling as `cache.ts:155-165`, `put`, `getMany`, `delete`, `list(targetLang,
   limit)`, `count`, `clear`, `exportFile`, `parseMemoryImport` and `importMany`, and a `version()` counter bumped
   on every write (phase 6 reloads its snapshot on a change). Entries carry `origin`, `localOnly`, `by` and
   `override`. Unit test each, plus the cap, an oversize import, malformed JSON, wrong format or version, over-long
   fields, control characters, an entry failing `checkSegment`, and imported provenance fields being ignored.
2. `jobs.ts`: add `edited` to `SegState`, and make `applySegmentEvent` return `cur` for an edited state. Add
   `edit()` and `discardEdit()`, and read the overrides in `fromCache` before the fresh return. Edited blocks never
   go into the cache writes (`remember` skips them).
3. Retranslate page (`fresh`) leaves edited blocks out of `todo`, and the job bar notes "N edited blocks kept".
4. `SegmentList.tsx`: an Edit button on final blocks; a `<textarea>` labelled with the block name; Save and Cancel;
   focus returns to the block afterwards. If `checkSegment` from `@/engine/index` finds lost code spans, links or
   numbers, a warning is shown, but saving is allowed. An edited block shows a small "edited" marker, and Retranslate
   on it asks "Replace your edit?" before acting.
5. Options `Memory.tsx`: count, Export (download `translate-side-memory-<date>.json`), Import (preview the valid
   and skipped counts, the "Also replace matching blocks" checkbox, default off, then apply), and Clear with
   confirmation. The panel shows an "imported" marker for overrides from imported entries.
6. e2e flows, and a11y tests for the editor.

## Todo

- [ ] `memory.ts` with the separate DB, caps, export and import, tested
- [ ] `edited` state; events ignored for it; overrides read before the fresh return
- [ ] `edit` and `discardEdit`; `remember` skips edited blocks
- [ ] Retranslate page keeps edits; block Retranslate asks first
- [ ] Inline editor UI, marker warning, keyboard and a11y
- [ ] Entries carry `origin`, `localOnly`, `by`, `override`
- [ ] Import: `checkSegment`, provenance ignored, examples-only by default, "imported" marker
- [ ] Options memory section
- [ ] en and vi keys
- [ ] e2e: edit → reload → shown, with zero calls for that block

## Success criteria

- After an edit and a panel reload, the block shows the edit, and the mock received no request containing that
  block's source.
- A Best run in progress cannot overwrite an edit (a test with a revision 3 arriving after the edit).
- Retranslate page keeps the edit; block Retranslate replaces it only after confirmation.
- "Clear cache" leaves the memory intact; "Clear translation memory" leaves the cache intact.
- A memory export re-imports into a fresh profile with the same entries, as `by: 'import'` examples, not overrides
  unless ticked.
- An imported entry whose target drops the source's number or code span is skipped and counted.

## Verification

- `pnpm vitest run --project shell src/shared/memory.test.ts src/entrypoints`
- `pnpm check`
- `pnpm run e2e`

## Risks

| Risk | L × I | Mitigation |
|---|---|---|
| An edit made while the block streams | M × M | Edit is offered only on final blocks; `edit()` aborts the block's own retry, if any. |
| Light markers mangled in the textarea | M × L | The warning from `checkSegment`; rendering still goes through `parseMarkup` with the source's `markerKinds` (`markup.ts:34`), so stray characters stay text. |
| The override hides a better translation forever | L × M | The "edited" marker and the confirmed Retranslate remove it; Options can clear all. |
| An import floods the store | L × M | Caps and validation before any write; a preview first. |
| A shared memory file plants misleading text on other sites | M × M | Imported entries are examples only by default, checked, and marked when they do override. <!-- Red Team: imported memory is untrusted --> |

**Rollback.** Revert the phase: the memory DB is left unused and harmless; edits stop showing. No other store changed.

## Security

<!-- Red Team: local-only corrections leak to cloud -->
The entries hold page text and the user's corrections, possibly from other sites and from local-only sites. They
stay on the device and are never synced. They are sent only as phase 6 examples, under phase 6's rules: never an
entry made under a local-only rule to a non-local route, and never an entry from another origin unless the user
opted in. The import is untrusted input: size-capped before parsing, schema-validated, length-capped,
`checkSegment`-checked, provenance-stripped, and rendered as text only.
