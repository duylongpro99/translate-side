---
title: "Phase 2: Passphrase lock for keys"
status: todo
priority: P3
effort: "2d"
dependencies: []
tier: free
---

# Phase 2: Passphrase lock for keys

## Goal

Users who want it can keep their API keys encrypted at rest. They unlock once per browser session, and a locked key
makes the panel ask for the passphrase instead of failing (M9 §2.3). Free.

## Context links

- Spec: `docs/plans/M9-beyond-v1.md` §2.3; DESIGN §4.3.4 (key storage), §8.
- Scout: `plans/reports/scout-261013-1036-m8-track-surfaces.md` §3.
- Key storage: `src/shared/settings.ts:182-199` (`secret:<id>` in `storage.local`, plain strings).
- Hot path: `resolveConnection` (`src/shared/settings.ts:220-241`, the read at `:226`), its one translation caller
  `src/entrypoints/sidepanel/route.ts:63`, the no-key error at `:64` (`noKeyError`, `:19`).

## Requirements

- Off by default. Turning it on encrypts every stored key; turning it off decrypts them back to plain strings.
- AES-GCM-256, key derived with PBKDF2-SHA-256 from the passphrase, a random 16-byte salt and an iteration count
  stored with it (600,000 to start; tester records unlock time on a mid-range machine). A fresh 12-byte IV per key.
  WebCrypto only, no dependency.
- While locked, `storage.local` holds only ciphertext envelopes `{ v: 1, iv, ct }` under `secret:<id>`, plus one
  record `keylock` `{ v: 1, salt, iterations, check }`, where `check` is the encryption of a fixed constant used to
  verify the passphrase. The passphrase is never stored.
- Unlocked state: the raw derived key bytes in `storage.session` only (the M9 spec), under one key. `storage.session`
  is readable by extension pages and not by content scripts at its default access level [UNVERIFIED: confirm the
  default in step 1; never call `setAccessLevel` to widen it]. A browser restart locks again. A "Lock now" button
  clears it.
- Translation with a locked key: `resolveConnection` reports "locked" (distinct from "no key"), `route.ts` turns it
  into an unlock prompt in the panel, and the job retries after unlock without a second click.
- Every other key path keeps working or asks for unlock deliberately:
  - presence checks see an envelope as "has a key" (`providers.ts:326, 547, 671`, `Providers.tsx:70`);
  - "Test connection" and model discovery (`Providers.tsx:592`) ask for unlock;
  - showing the masked key (`Providers.tsx:737`) shows "Locked";
  - export with keys (`portable.ts:171-176`) asks for unlock and exports plain keys, as today, because the user asked
    for them;
  - import with keys (`portable.ts:575-605`) and `saveApiKey` (`settings.ts:186`) encrypt when the lock is on, and
    ask for unlock first.
<!-- Red Team: lock disables the import redirect guard -->
  - **the import redirect guard must see envelopes.** The block that removes a stored key when an imported file
    points an existing connection at another address only counts plain strings as keys
    (`portable.ts:599-602`, `const hasKey = typeof saved === 'string' && saved !== ''`), and the replace count does the
    same (`:581-584`). With the lock on, an envelope would count as "no key", the guard would skip it, and the next
    unlock would send the key to the new address. Every `typeof … === 'string'` check on a `secret:*` value goes
    through `keyState(...) !== 'none'`: `portable.ts:581-584, 599-602`, `Providers.tsx:70`,
    `providers.ts:326, 547, 671`, and `readApiKey`'s callers that only test presence.
- Forgotten passphrase: "Remove lock and keys" deletes the envelopes and the record after a confirm. No recovery.
- Honest copy in the UI: the lock protects keys from someone reading the profile's files while the browser is closed
  or locked; it does not protect against someone using this browser while it is unlocked, or against malware.

## Architecture

```
Options "Lock keys" → keylock.enable(passphrase)
   derive(passphrase, salt) → AES key → encrypt each secret:<id> → write envelopes → write keylock record
Panel job → route.ts → resolveConnection → readApiKey
   plain string           → key
   envelope + session key → decrypt → key
   envelope, no session   → KeyLocked → route.ts returns uiError('auth', …, 'keysLocked') → panel unlock form
Panel unlock form → keylock.unlock(passphrase) → verify `check` → session key in storage.session
   → storage.session.onChanged (key KEYLOCK_SESSION_KEY) → translator retries stopped jobs
     <!-- Red Team: nothing retries after unlock -->
     (the existing retry listens only to local `secret:*` changes, translator.ts:578-580, and the session listener
     only to snippet keys, :570-576; both Options reload listeners filter on local `secret:*`, Providers.tsx:117,
     Options.tsx:72. Each gets an explicit branch for the session key, and for the `keylock` record in local)
```

`readApiKey` keeps its signature and keeps returning `undefined` for anything it cannot use, so callers that only
need a string are safe. A new `keyState(api, id): 'none' | 'plain' | 'locked' | 'unlocked'` serves presence checks
and the UI.

Crash safety of enable and disable: `readApiKey` accepts both shapes for every key, so a run interrupted halfway is
still readable. Enable writes the `keylock` record first, then the envelopes; on the next unlock, any plain string
left while the lock is on is encrypted (a sweep). Disable decrypts and writes plain strings first, then removes the
record. A cross-context lock (`navigator.locks`, as `migrate.ts:18-32` uses) serialises enable, disable, change and
the sweep.

## Related files

- **Create:** `src/shared/keylock.ts` and `src/shared/keylock.test.ts`; `src/entrypoints/sidepanel/UnlockPrompt.tsx`;
  `e2e/keylock.spec.ts`.
- **Modify:** `src/shared/settings.ts` (`readApiKey`, `saveApiKey`, `resolveConnection` locked result),
  `src/entrypoints/sidepanel/route.ts` (`:63-64`, the locked error), `src/entrypoints/sidepanel/translator.ts`
  (retry on unlock, `:579`), the panel view that shows job errors, `src/shared/providers.ts` (`:326, 547, 671` presence
  checks), `src/entrypoints/options/Providers.tsx` (`:70, 592, 737`), `src/entrypoints/options/Options.tsx` (a "Key
  lock" section), `src/shared/portable.ts` (`:171-176`, `:575-605`), `src/locales/en.yml`, `src/locales/vi.yml`,
  `docs/privacy.md` (one paragraph), `scripts/bundle-budget.json`.

## Steps

1. Write `docs/plans/M9-passphrase-lock.md` (M9 §3). Confirm `storage.session`'s default access level in Chrome 138
   docs and record it there.
2. Write `src/shared/keylock.ts`: `derive`, `encryptKey`, `decryptKey`, `enable`, `disable`, `changePassphrase`,
   `unlock`, `lockNow`, `keyState`, `reset`, all behind one `navigator.locks` name. Pure crypto helpers take
   `crypto.subtle` so tests run in Node.
3. Change `readApiKey` to decrypt an envelope with the session key, and return `undefined` otherwise. Add a
   `KeyLockedError` path for `resolveConnection`: when the key is an envelope and no session key exists, return a
   distinct "locked" result instead of `null`. Keep the plain-HTTP refusal before the key read (`settings.ts:224`).
4. `route.ts`: map "locked" to `uiError('auth', i18n "Your keys are locked", 'keysLocked')`. The panel renders
   `UnlockPrompt` for that code (a password field, Unlock, a link to settings). Unlock success writes the session key
   under a named constant `KEYLOCK_SESSION_KEY`.
<!-- Red Team: nothing retries after unlock -->
4a. Listeners: in `translator.ts`, add a branch to `onSession` (`:570-576`) that calls `retryStopped()` when
   `KEYLOCK_SESSION_KEY` appears, and to `onLocal` (`:578-580`) for the `keylock` record. In
   `Providers.tsx:117` and `Options.tsx:72`, reload on the same two keys, so Options stops showing "Locked" after an
   unlock in the panel.
<!-- Red Team: lock disables the import redirect guard -->
5. Replace every string-only presence check on `secret:*` with `keyState(...) !== 'none'`: `providers.ts:326, 547,
   671`, `Providers.tsx:70`, and in `portable.ts` the replace count (`:581-584`) and the redirect guard (`:599-602`).
6. Options: a "Key lock" section with enable, change, disable, lock now, and "Remove lock and keys"; the honest copy;
   test connection and discovery show the unlock prompt when locked; the masked key shows "Locked".
7. Export with keys and import with keys: unlock first; encrypt on import while locked.
8. Tests (unit): round trip; wrong passphrase rejected via `check`; tampered ciphertext fails closed; no plaintext
   key in any `storage.local` value after enable (scan every value); interrupted enable and disable stay readable;
   sweep encrypts a stray plain key; two contexts enabling at once leave one consistent state; export and import
   while locked and unlocked; `readApiKey` on v1.0-shaped data is unchanged; **lock on, import a file that redirects a
   keyed connection to another address → the envelope is in `removeSecrets` and the redirect report says
   `removed`** (Red Team: lock disables the import redirect guard).
9. E2E (`e2e/keylock.spec.ts`, mock provider): enable lock, reload the panel with a cleared session, translate →
   unlock prompt, unlock → the job completes with no second click (no Retry press; Red Team: nothing retries after
   unlock); Options open beside it stops showing "Locked"; assert via the harness that `storage.local` contains no key
   string.
10. Add one paragraph to `docs/privacy.md` with the honest scope of the lock.

## Todo

- [ ] One-page track plan; `storage.session` access level confirmed
- [ ] `keylock.ts` with tests
- [ ] Locked result in `resolveConnection`, unlock prompt in the panel, retry on unlock
- [ ] Presence checks and the import redirect guard use `keyState`
- [ ] Session and local listeners retry and reload on unlock
- [ ] Options "Key lock" section with honest copy
- [ ] Export and import paths handle the lock
- [ ] Unit and e2e tests green
- [ ] `docs/privacy.md` paragraph

## Success criteria

- M9 §2.3 done when: keys are unreadable in `chrome.storage.local` while locked (a test scans every stored value for
  each key string and finds none); translation prompts for unlock instead of failing (the e2e above).
- With the lock off, behaviour and storage are byte-identical to v1 (existing tests unchanged and green).

## Guarantee to keep

The UI stays honest that an extension cannot fully hide secrets from someone with access to the browser profile:
the copy states what the lock does and does not protect, and no wording says "secure" without that scope.

## Verification

```
pnpm run test -- src/shared/keylock.test.ts src/shared/settings.test.ts src/shared/portable.test.ts
pnpm check
pnpm run e2e
```

No eval-gate run is needed: no engine, LLM or default changes.

## Risks

| Risk | L × I | Mitigation |
|---|---|---|
| A string-only check treats an envelope as "no key" and skips a safety rule (the import redirect guard) | High × High | Every `secret:*` check goes through `keyState`; the redirect test with the lock on (Red Team) |
| A half-finished enable leaves keys unreadable | Low × High | Both shapes readable; record-first ordering; sweep; cross-context lock; interrupted-run tests |
| User forgets the passphrase | Medium × Medium | Clear copy at enable time; "Remove lock and keys" reset; keys can be re-entered |
| Unlock prompt loops when the session key is stale after a passphrase change | Low × Medium | `check` verifies on unlock; change re-encrypts and rewrites the session key in one locked step |
| PBKDF2 at 600k iterations is slow on old hardware | Medium × Low | Measured by the tester; count stored per record, so it can change later without a migration |
| Downgrade to v1.0 with the lock on | Low × Medium | v1.0's `readApiKey` returns `undefined` for a non-string (`settings.ts:194`), so it shows "no key" rather than crashing; noted in the release notes |

## Security

What is protected: keys at rest in `storage.local`. Threat: someone copying the profile while the browser is closed.
Not protected: a running, unlocked browser; malware; a page (content scripts never see `storage.session` at the
default level, and decryption runs only in extension pages). The passphrase never leaves the page it was typed in and
is never stored or logged; diagnostics record neither it nor the lock state beyond "locked: yes/no".

## Rollback

Users with the lock on must disable it before a rollback build; a rollback build sees encrypted keys as missing
(safe, no crash). Code rollback is the phase's commits.
