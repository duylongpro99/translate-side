---
phase: 2
title: "On-device route and engine choice"
status: done
priority: P1
effort: 3.5d
dependencies: [1]
---

# Phase 2: On-device route and engine choice

## Goal

When no provider can run because no key is set, a job runs on the device. It uses Gemini Nano when the setting, the
target language and `availability()` allow it, and Chrome Translator through the `basic` strategy otherwise. When the
engine first needs a click, the job stops with an `onDeviceSetup` reason instead of failing block by block.

<!-- Red team 2026-10-20: rewritten for findings 1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13. -->

## Key insights

- **The route entry.** `translateClient` (`src/entrypoints/sidepanel/route.ts:131-147`) has three callers: `Jobs.start`
  (`src/entrypoints/sidepanel/jobs.ts:1049`), explain (`:1481`) and redo (`:1541`). Onboarding wraps it at
  `src/entrypoints/onboarding/Onboarding.tsx:270`. All of them read `resolved.client` and `resolved.profile`
  (`jobs.ts:1086`, `:1498`, `:1563`), so every on-device result carries both.
- **The trigger.** `noKeyError` (`route.ts:20`, returned at `:65`) comes from whichever profile the route picked: a site
  rule, a tab override, or the default (`src/shared/providers.ts:776-778`). The fallback chain is built only after the
  primary succeeds (`route.ts:138-139`). "No usable provider" therefore needs its own check.
- **Translator pairs.** For privacy, Chrome reports a pair as `downloadable` until this extension creates it, even when
  the pack is installed (research §4 and §7). Translator `create()` consumes the user's activation. Today's lazy create
  inside a job (`src/llm/chrome-translator.ts:66-71`) can't succeed on a fresh pair.
- **Nano and activation.** Nano's `create()` accepts *sticky* activation (research §4). Any earlier click in the panel
  counts, so a job that calls `create()` on a `downloadable` model could start a download of about 4 GB.
- **The basic switch.** It takes over only retryable errors (`src/engine/engine.ts:187`, `src/engine/retry.ts:34,40`).
  Nano errors are `context_length`, `model_not_found` or `unknown` (`src/llm/chrome-builtin.ts:36-41`), and a marker
  parse failure is also `unknown` (`src/engine/parsing/translate-chunk.ts:278`). None of them are switched today.
- **The existing opt-out.** A user can remove `basic` from `Routing.fallback`, and `basicMigrated` keeps it removed
  (`providers.ts:239`, `:258-259`; `hasBasicFallback` `:799-800`).
- **No source language.** `availability('')` returns `available` (`chrome-translator.ts:104`). The source is detected per
  block (`:115`), so a mixed-language page needs several pairs.
- **Stored built-in connections.** With the `nanoOff` guard gone (`route.ts:63`), a stored or synced `chrome-builtin`
  connection reaches `hasHostPermission(api, conn.baseUrl)` (`route.ts:66-68`), and `originPattern('')` throws
  (`src/shared/settings.ts:207-213`).

## Architecture

```
translateClient(api, { tabId, url, sourceLang, targetLang, analyze?, review? })
  └─ resolveRoute → clientFor
       ├─ ok → unchanged (provider route, fallback chain, basic tail)
       └─ noKey
            ├─ route.source !== 'routing' (site rule / tab override) → noKey stop, as today
            ├─ a link in the fallback chain is usable → that link becomes the primary (the rest stay the chain)
            └─ otherwise → onDeviceRoute(api, langs, Routing.onDevice, hasBasicFallback)
                 └─ pickEngine(setting, sourceLang, targetLang, scope)
                      ├─ { engine: 'nano' }          → Nano client + NANO_PROFILE, onDevice: 'nano', basic per opt-out
                      ├─ { engine: 'translator' }    → MT-backed client + TRANSLATOR_PROFILE, onDevice: 'translator'
                      ├─ { needsSetup: engine, from, to } → ok:false, uiError(..., 'onDeviceSetup', [engine, from, to])
                      ├─ { unknownSource }           → ok:false, 'onDeviceNoSource' (the page language is not known)
                      └─ { unavailable: reason }     → ok:false, 'onDeviceUnavailable' (or noKey when basic was opted out)
```

- **`pickEngine` rules.**
  - It calls `availability()` only, never `create()`.
  - Nano is chosen when the setting is `auto` or `nano` and `LanguageModel.availability({ expectedInputs: [{type:'text',
    languages:[from]}], expectedOutputs: [{type:'text', languages:[to]}] })` returns `available`. If it returns
    `downloadable`, the result is `needsSetup: 'nano'` when the setting is `nano`, and Translator is tried when the setting is `auto`.
  - Translator is chosen when the setting is `auto` or `translator` and the pair is `available`; `downloadable` or
    `downloading` gives `needsSetup: 'translator'`.
  - An empty `from` returns `unknownSource`.
  - With `basic` removed from `Routing.fallback`, Translator is never chosen. If Nano can't run either, the result is the
    `noKey` stop, as today.
- **No `create()` on a job path unless `availability()` returned `available`.** Phase 3's turn-on click is the only place that
  creates a `downloadable` model or pair. The MT client is changed to match: `translatorFor` refuses to create a pair whose
  state isn't `available`. Instead it returns a typed failure (`raw: { reason: 'needs-activation', from, to }`). The job turns
  that failure into `onDeviceSetup` for a second pair found mid-job, from a mixed-language page. This applies to every caller of the MT client, including the provider users' last fallback.
- **Clients and profiles.** Add `ON_DEVICE_CONNECTION` (`protocol: 'chrome-builtin'`, `auth: { style: 'none' }`, no
  `baseUrl`), `NANO_PROFILE` and `TRANSLATOR_PROFILE` (`model: CHROME_TRANSLATOR_MODEL`) to `src/shared/settings.ts`, with
  `chunkTokens` and `maxConcurrency: 1` from S8. They are not seeded into stored settings and never synced. The Translator route's
  `client` is a small `LLMClient` that yields one `error` event (`bad_request`, "Chrome Translator can't run prompts"), so
  any prompt-based strategy that reaches it fails visibly instead of crashing. The job never sends it a prompt, because the strategy is forced.
- **Order in `Jobs.start`.** It resolves the route first. Then it sets `job.strategy` (Nano: `single-pass`; Translator:
  `basic`), drops analyze, review, any kept brief and translation memory, and patches `model`. Only then does it call
  `fromCache` and the `refining` decision. Today these run before or alongside the route (`jobs.ts:924-926`, `:1049`,
  `:1056-1058`, `:1075`, `:1089`), so they move after it for the on-device case only. The route ignores the `analyze` and `review` flags when it returns `onDevice`.
- **Explain and redo.**
  - Redo on a Translator route forces `basic`.
  - Redo on a Nano route uses `single-pass`.
  - Explain on a Translator route stops with the reason "Explain needs a language model".
  - Explain on Nano runs the `explain` strategy, with the same chunk size.
- **Nano to Translator switch.** Add an `onDeviceSwitch` option to the engine job. When it is set (Nano primary only), the
  switch also takes `context_length`, `model_not_found` and `unknown` failures to `basicTranslate`. It does this through the
  existing `withBasicSwitch` (`engine.ts:160-200`), so provider users' stop semantics (`auth`, `quota`) don't change. Add an engine test for it.
- **The cache.** Today, `basic` finals are never stored (`jobs.ts:1918-1920`), so a keyless user would re-translate every page on
  reopen. On-device primary finals are cached. `remember` skips `basic` finals only when the job's primary is *not*
  on-device. Entries are already keyed by the producing model (`keyFor(job, id, state.model)`, `jobs.ts:1922`), so a
  provider configured later never reuses them. Basic finals from a provider job's last fallback stay uncached, as today.
  <!-- Updated: Validation Session 1 - cache on-device finals under their own model key -->
- **The Nano adapter** follows S8's output-format decision: markers, or `responseConstraint` with a JSON array of N strings
  and a parser path. It always passes language options, and uses `contextWindow` and `measureContextUsage`, falling back to `inputQuota` and `measureInputUsage`.
- **Remove the `CHROME_NANO` flag** (`src/llm/client.ts:51-67`) and `nanoOff`. Its consumers are: `route.ts:8`, `:63`;
  `src/llm/index.ts:8`; `src/entrypoints/sidepanel/status.ts:10` (the reason union); `src/llm/adapters.test.ts:776-777`;
  `src/shared/providers.test.ts:5`, `:482-485`; and `errors.nanoOff` in `en.yml:331` and `vi.yml:326`. A stored `chrome-builtin`
  connection skips the host-permission check, and it gets the same on-device limits: single-pass, no analyze or review, and the language probe.
- **Local-only rules.** `isLocalConnection` (`providers.ts:818-822`) changes to use the effective protocol
  (`protocolOf(connection, profile)`, `settings.ts:67-68`). Profile parsing (`providers.ts:214`) strips `protocolOverride` from
  profiles on a `chrome-builtin` connection, on sync and on import (`src/shared/portable.ts`).
- **The setting** is `Routing.onDevice?: 'auto' | 'nano' | 'translator'` (default `auto`), stored with routing in storage.sync.
  Add it to `ROUTING_FIELDS` (`providers.ts:490`). An unknown value reads as `auto` but is written back unchanged, so a newer
  build's value survives an older build's save. Export and import carry it. The UI for it is in phase 4.
- **There is no background proxy.** The service-worker exemption is undocumented, conflicts with decision S1
  (`src/entrypoints/background.ts:12-13`), and gets around Chrome's download consent. The turn-on click is the only path.

## Related code files

- Create:
  - `src/llm/on-device.ts`: `pickEngine` and the Translator `LLMClient` stub.
  - `src/llm/on-device.test.ts`.
- Modify:
  - Route and jobs: `src/entrypoints/sidepanel/route.ts`, `src/entrypoints/sidepanel/jobs.ts`.
  - LLM: `src/llm/client.ts`, `src/llm/chrome-builtin.ts`, `src/llm/chrome-translator.ts`, `src/llm/index.ts`.
  - Engine: `src/engine/engine.ts`, `src/engine/types.ts` (the `onDeviceSwitch` option).
  - Settings: `src/shared/settings.ts`, `src/shared/providers.ts`, `src/shared/portable.ts`.
  - Panel: `src/entrypoints/sidepanel/status.ts`.
  - Locales: `src/locales/en.yml`, `src/locales/vi.yml`.
- Tests:
  - `src/llm/adapters.test.ts`, `src/llm/chrome-builtin.test.ts`, `src/shared/providers.test.ts`.
  - `src/entrypoints/sidepanel/jobs.fallback.test.ts`, `src/entrypoints/sidepanel/translator.test.ts`.
  - A new `src/entrypoints/sidepanel/jobs.on-device.test.ts`.

## Implementation steps

1. Write the tests for `pickEngine` first, using fake `LanguageModel` and `Translator` scopes:
   - Nano is chosen for target `en` and Translator for `vi`.
   - `downloadable` gives `needsSetup`.
   - An empty source gives `unknownSource`.
   - With `basic` opted out and no Nano, the result is the noKey stop.
   - `create()` is never called.
2. Implement `src/llm/on-device.ts`, and change `translatorFor` so it never creates a pair that isn't `available`.
3. Extend the route target with `sourceLang` and `targetLang` at `jobs.ts:1049`, `:1481`, `:1541` and `Onboarding.tsx:270`. Add the
   `noKey` branch with the default-route and usable-fallback checks.
4. Reorder `Jobs.start` for on-device routes, and update explain and redo.
5. Add the `onDeviceSwitch` engine option with its test.
6. Remove `CHROME_NANO` and `nanoOff` from every listed consumer. Make the host-permission skip and the on-device limits apply to stored `chrome-builtin` connections.
7. Make `isLocalConnection` use the effective protocol, and strip `protocolOverride` on built-in connections.
8. Add the `Routing.onDevice` parsing, save, export and import.
9. Run `pnpm typecheck && pnpm lint && pnpm test`.

## Success criteria

- A keyless default route resolves as follows:
  - Target `vi`: Translator.
  - Target `en` with Nano available: Nano.
  - A fresh pair: `onDeviceSetup`.
  - An empty source: `onDeviceNoSource`.
  - Fakes count zero `create()` calls in all four cases.
- These cases keep today's behavior: a site rule or tab override with no key (`noKey`), a keyless primary with a usable
  fallback (the fallback runs), and a route with a key (unchanged). The existing `jobs.fallback`, `translator`, `switcher` and `providers` tests pass.
- Retry, Retranslate and Explain on a Translator route behave as specified. None of them crash.
- A Nano chunk that hits `QuotaExceededError` or a parse failure ends as a Translator block.
- `rg "CHROME_NANO|nanoOff|NANO_OFF" src` returns nothing.
- A connection with protocol `chrome-builtin` and a profile `protocolOverride` no longer counts as local.
- Reopening a page translated on the device reads from the cache. A later provider run translates it again under its own model key.

## Risks

- **Nano's marker reliability.** If S8 shows a high parse-failure rate and JSON doesn't fix it, `auto` uses Translator only,
  and Nano is selectable in settings and marked experimental.
- **The `translatorFor` change also affects provider users' last fallback.** A fresh pair there now fails at once with a
  clear reason, instead of after a 30 s stall. That is the honest answer, and it is covered by updating `jobs.fallback` tests.

## Security

The on-device route is local because its adapters make no network request. The Nano adapter and the MT client call only
Chrome APIs. Phase 4 enforces privacy acknowledgment on the resolved route. No background message endpoint is added.

## Todo

- [x] `pickEngine` and the Translator `LLMClient` stub, with tests (no `create()` on job paths)
- [x] `translatorFor` refuses non-`available` pairs, with a typed `needs-activation` failure
- [x] Route target carries languages; `noKey` branch with default-route and usable-fallback checks
- [x] `Jobs.start` order for on-device; explain and redo
- [x] `onDeviceSwitch` engine option and test
- [x] Cache on-device primary finals (model-keyed); provider fallback basics stay uncached
- [x] Remove `CHROME_NANO` and `nanoOff` (all consumers); stored built-in connections get the host skip and limits
- [x] `isLocalConnection` uses the effective protocol; strip `protocolOverride`
- [x] `Routing.onDevice` parse, save, export and import, keeping unknown values
