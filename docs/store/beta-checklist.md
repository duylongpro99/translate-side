# Closed beta checklist

For the owner and the handful of people who try Translate Side 1.0.0 before it is listed publicly. The automated
suites (unit tests, the end-to-end run in Chromium against a mock provider, the eval gate) cannot cover what needs a
real Chrome profile, a real keyboard, a screen reader or a Vietnamese reader. This page lists exactly those things.

How the beta runs: the extension is uploaded as **Unlisted** (steps in [submission.md](submission.md)); the owner
shares the store link with the testers; testers go through this page and send back what they found; when nothing
that blocks a release is open, the owner switches the listing to **Public**.

## For the owner

- [ ] Upload and submit the package as in [submission.md](submission.md), with visibility **Unlisted**. The privacy
      policy URL in the Privacy tab must open for anyone, which needs the branch that holds `docs/privacy.md` on
      `master` on GitHub first.
- [ ] After approval, send each tester the store link and a link to this page. Give them a way to send a file
      privately (email or a direct message); say that a public issue is **not** the place for a diagnostics file.
- [ ] Keep a list of what comes back: item, who or which file it came from, severity, status. The agent turns it
      into the "Beta fix list" in the project log.
- [ ] A page that failed for a tester becomes a new fixture for the engine tests (tell the agent which page type
      failed; the tester need not name the site).
- [ ] When no item that blocks a release is open, switch the listing to **Public** in the dashboard.

## For testers

### Install

1. Open the unlisted store link you were sent in Chrome (version 138 or later) and choose **Add to Chrome**.
2. A setup guide opens. Pick a provider and paste an API key you control (use a key with a small spend limit), or
   use a local model ([local-models.md](../local-models.md)).
3. Open an ordinary English article and press the toolbar icon or the shortcut (`Alt+T` by default; see below).
   Read and accept the first-run notice. The translation appears in the side panel next to the page.

If Chrome asks for access to a site when you press **Test connection** or add a site, that is expected: access is
asked per site, on a click.

### Try it on your own sites

Use it the way you would for real reading: documentation, blogs, forums, news, long articles, pages with code
blocks and tables, single-page apps. Switch the target language, style (Natural, Faithful, Simplified) and model
once. Note anything that looks wrong: missing parts of a page, untranslated pieces, code or numbers changed, a
spinner that never ends, a page that scrolls strangely, a cost that surprised you.

**If something fails, do not post it publicly.** In the extension's Settings open **Diagnostics**, choose
**Review and export…**, read the file, and save it. Send the file to the owner privately. The file holds counts,
timings, versions and error kinds, never page text, page addresses or the provider's answers. **Site names are off
by default** and are only in the file if you tick "Include site names" (or "Keep site names in this file" when you
save). Leave them off unless you are happy to share which sites failed; saying in your message what kind of page it
was ("a docs site with a left sidebar") is enough.

### Checks that need a person

Mark each as **ok**, **problem** (say what you saw) or **not tried**.

| # | Check | How | Why a person |
|---|---|---|---|
| 1 | Permission prompt, allowlisted site | In Settings › Site rules, add a site such as `https://example.com`. Chrome shows its own permission prompt for that site. Allow it, then open a page on that site with the panel open: it should translate by itself. Remove access in Chrome afterwards if you want | The prompt is Chrome's own and cannot be driven by the test browser |
| 2 | Permission prompt, custom endpoint | In Settings › Providers add a custom endpoint (any OpenAI-compatible address you use), press **Test connection**. Chrome asks for that address. Deny once: the extension should say access is missing and offer to ask again. Allow: the test should pass or give a clear error | Same |
| 3 | Rapid shortcut presses | Press the toggle shortcut five times quickly. Expected: the panel ends open or closed to match the last press, never stuck half-way and never two panels | A real keyboard and Chrome's gesture rules |
| 4 | Toolbar icon toggle | Click the toolbar icon twice: opens, then closes. Try it in a second window too | Same |
| 5 | The shortcut itself | The default is `Alt+T`. If another extension already uses it, Chrome leaves it unset or you set another: open `chrome://extensions/shortcuts`. The panel's `?` help and Settings › Keyboard shortcuts should show the key Chrome really assigned, or say where to choose one | Depends on your Chrome profile |
| 6 | Chrome 138–140 only | If you run Chrome 138, 139 or 140, press the toggle to close an open panel. Expected: it closes. These versions use a fallback that was never checked on a real browser. Skip this on Chrome 141 or later and say which version you have | Needs those exact Chrome versions |
| 7 | Screen reader (VoiceOver on macOS: Cmd+F5) | Open the panel on an article. The block list is a labelled list that is busy while translating. Tab reaches every action. The letter and arrow shortcuts (J/K, O/R/E/C) need **focus mode** (VoiceOver: forms/application mode) on; the `?` help says so. Listen for: block text read in the right language, buttons named, the progress or status announced, no focus trap, Esc leaving the shortcut list | Speech output cannot be tested automatically |
| 8 | Dark mode | Set the system or Chrome to dark. Look at the panel (every state: translating, done, error, the first-run notice) and Settings (every tab). Look for text that is hard to read, borders that vanish, a focus ring you cannot see | Contrast is judged by eye |
| 9 | The real docked panel | In the docked side panel (not a test window): hover a block in the panel and the matching text on the page is marked; hover on the page and the panel points at the block; scroll one side and the other follows when **Follow page scroll** is on; turn it off and it stops | The test browser cannot show Chrome's real side panel |
| 10 | Update in place | If you installed an earlier build, update to this one: your settings, glossary, key and cached pages should still be there. The first-run notice may appear once more because its text changed | Only a real update path shows this |

### Vietnamese interface: native reader review

The Vietnamese interface text in `src/locales/vi.yml` was written by the agent. It stays a draft, and the note at the
top of that file stays, until a native Vietnamese reader signs it off. To review it, set Chrome's language to
Vietnamese (or use a profile in Vietnamese), open the panel and every Settings tab, the first-run notice and the
setup guide. Decisions that need a native judgment:

- **Route and routing.** "Route" is `Tuyến` and "Routing" is `Định tuyến` (Settings › Providers › Định tuyến).
  Do these read naturally for choosing a model per site or per task? Is there a better word?
- **Block, site, page.** A translated "block" is `đoạn`; a "site" is `trang web`; a "page" is `trang`. Check that
  they are used the same way everywhere and that a site and a page are never confused (for example "never translate
  this site").
- **Technical words kept in English:** `API key` and `key` (mixed: "chưa có key", "Sửa key", "API key không hợp
  lệ"), `token`, Ollama, LM Studio, the shortcut `Alt+T`. Should any of them be Vietnamese, and should the
  spelling of "key" be one form?
- **Tone and length.** Is the tone right for a utility ("Bạn" or none)? Do any texts overflow buttons or wrap badly
  in the narrow panel?
- **Sentences built from parts.** A few messages are put together from pieces (the first-run notice, some job
  status lines). Look for any that read oddly or have the wrong word order.
- **Number and size formats.** File sizes show `KB`/`MB` with a dot as the decimal mark; Vietnamese uses a comma.
  Is that acceptable?
- **English that stays.** The target-language list shows English language names ("Vietnamese"), and saved provider
  labels keep their English preset names. Is that acceptable?

Send corrections as a list "key in `vi.yml` → better text", or edit the file and send it. When a native reader
approves, tell the owner so the draft note can come off.

## Reporting

- **Anything that failed on a real site:** export diagnostics as above and send the file **privately**.
- **Visual, keyboard or screen-reader problems:** send a short description with your Chrome version, operating
  system and the check number from the table. A screenshot is welcome if it shows no private page.
- **Do not** put a diagnostics file, a page address or an API key in a public issue.
- **Never send your API key to anyone.** If you pasted a key anywhere by mistake, delete it at the provider.

## Where each open item from the earlier milestone is covered

These are the open human items at the end of the reading-experience milestone (the FINAL STATE of
`docs/progress/progress-m5.md`) and the manual items from the end-to-end phase, with the check that covers them.

| Open item | Covered by |
|---|---|
| Manual Chrome permission-prompt check never reported | Checks 1 and 2 |
| `Alt+T` rapid presses not observed | Check 3 |
| Toolbar-icon toggle not observed | Check 4 |
| Chrome 138–140 `window.close()` fallback unverified | Check 6 |
| Shortcut taken by another extension (the owner had to rebind it) | Check 5 |
| Screen-reader speech not tested | Check 7 |
| Dark-mode contrast needs a human look | Check 8 |
| The real docked panel (hover and scroll sync) | Check 9 |
| Vietnamese UI text is an agent draft | Vietnamese review above |
| Real sites that fail | "Try it on your own sites" and the diagnostics file |
