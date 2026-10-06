# S1 — MV3 worker suspension during streaming → where the engine runs

Status: **decision approved by the user 2026-10-05** (engine host = side panel page; DESIGN §4/§4.1 edits approved, applied in the final Phase B step); record amended after review rounds 1–2 · Depends on: S5 record (commit 921fee0) · Date: 2026-10-05 · Chrome 154.0.8037.93 (macOS) · Spike code: `spikes/s1/`

## Question

ROADMAP §2 S1 asks five things. Does an open Port keep the service worker alive while it streams a long response? Do Port
messages reset the idle timer? Does a `chrome.runtime.getPlatformInfo()` ping? What happens to an in-flight stream when
the worker is suspended? And so: should the engine run in the worker or in the side panel page (plan §5 default:
**side panel page**, "choose the worker only if S1 shows keepalive is trivially reliable")?

## Method

- `spikes/s1/server.mjs` is a throttled mock LLM. It sends one SSE chunk per second for `dur` seconds, with an optional
  delay before the first byte (`ttfb`), so it can stand in for a slow local model. It logs when a stream completes and when
  the client aborts it.
- `spikes/s1/ext/` is a minimal MV3 extension. The worker `fetch`es the stream and reads the body. An extension page
  (`panel.html`) starts the job, either with `runtime.sendMessage` or over a Port, depending on the scenario.
- `spikes/s1/drive.mjs` launches an isolated headless Chrome (temporary profile, `--remote-debugging-pipe`) and loads the
  extension with `Extensions.loadUnpacked`. It watches the worker target appear and disappear through CDP target
  discovery **without attaching** (an attached debugger would keep the worker alive).
- Each scenario ran in its own Chrome instance; several scenarios ran in parallel. Scenario names:
  `noport` = started by one-off message, nothing else; `port-idle` = the panel holds an open Port with no traffic;
  `port-portmsgs` = the worker posts each chunk to the panel; `port-panelping` = the panel posts a ping every 10 s;
  `noport-platformping` = the worker calls `getPlatformInfo()` every 20 s; `noport-persist` = the worker writes job
  progress to `chrome.storage.session` on each chunk; `panelhost` = the panel page itself does the fetch;
  `idle` = no job (baseline); `-long` = 400 s stream; `-ttfb45` = 45 s before the first byte.

Re-run: `cd spikes/s1 && mkdir -p results && ./run.sh 1 "noport:90:130 port-idle:90:130"`, then `node summarize.mjs`.

## Evidence

Raw logs: `spikes/s1/results/*.jsonl`. Summary table (generated): `spikes/s1/results/summary.md`. "Worker down" is
seconds after the job started, from CDP target discovery.

| Scenario | Runs | Stream result | Worker down after job start |
|---|---|---|---|
| `idle` (baseline, no job) | 3 | – | 30.3 s, 30.3 s, 33.4 s |
| `noport` (no keepalive) | 7 | **aborted at 29–30 of 90 chunks in 6/7**; 1/7 completed | 30.0–30.3 s when killed |
| `port-idle` (open Port, no traffic) | 7 | **aborted at 29 of 90 chunks in 6/7**; 1/7 completed | 29.9–30.0 s when killed |
| `port-portmsgs` (worker → panel per chunk) | 3 | complete 90/90 in 3/3 | 30 s after the stream ended |
| `port-panelping` (panel → worker every 10 s) | 1 | complete 90/90 | alive at end |
| `noport-platformping` (`getPlatformInfo` every 20 s) | 3 | complete 90/90 in 3/3 | 30 s after the stream ended |
| `noport-persist` (`storage.session.set` per chunk) | 3 | complete 90/90 in 3/3 | 30 s after the stream ended |
| `noport-platformping-long` (400 s stream) | 1 | complete 400/400 | 30 s after the stream ended |
| `port-portmsgs-long` (400 s) | 1 | complete 400/400 | 30 s after the stream ended |
| `port-panelping-long` (400 s) | 1 | complete 400/400 | alive at end |
| `port-portmsgs-ttfb45` (chunk-driven keepalive, 45 s to first byte) | 2 | **aborted, 0 chunks**, in 2/2 | 30.0 s, 30.0 s |
| `noport-platformping-ttfb45` (timer keepalive, 45 s to first byte) | 2 | complete 60/60 in 2/2 | 30 s after the stream ended |
| `panelhost` (fetch in the extension page) | 3 | complete 90/90 in 3/3 | worker died at ~30 s; the stream didn't care |

Findings:

1. **An open Port does not keep the worker alive.** `port-idle` was killed at 30 s in most runs: 6 of 7 in mine, and 4 of 7 in the tester's re-run (**tester-reported**: those logs are not committed; aborted at 29 chunks; r1, r3, r5 survived). The panel received
   `onDisconnect` at the same moment, and the server saw the client abort the stream after 29 chunks.
2. **Reading a fetch body is not activity.** With no other activity the worker is usually killed at 30 s mid-stream.
   It was killed in 6 of 7 `noport` runs; `port-idle` likewise survived once. I found no cause for either survivor (logs
   `results/r2-noport.jsonl`, `results/r6-port-idle.jsonl`). Suspension is not deterministic, so "it worked in testing" isn't evidence of safety.
3. **On suspension the in-flight stream is lost.** The fetch is aborted with no callback in the worker. A new worker
   instance starts on the next event (here the panel reconnecting). It sees whatever `chrome.storage.session` held
   (`{"state":"running","n":0}`), so resuming is possible, but only by re-requesting, and only if the job state was
   persisted.
4. **The two extension API calls tested, and Port messages in either direction, reset the 30 s timer.**
   - `getPlatformInfo()` every 20 s and `storage.session.set` per chunk each kept a 90 s stream alive in every run.
   - So did worker→panel messages and panel→worker pings.
   - Other APIs were not tested. Chrome's documentation says extension API calls in general reset the timer.
   - In the 400 s runs a heartbeat was always running. They show the 5-minute limit didn't cut a fetch body read **while
     the timer was being reset**. Nothing was shown about a 400 s read without a heartbeat.
5. **Keepalive tied to stream chunks fails before the first token.** With 45 s to the first byte (a realistic
   prompt-processing delay for a local 7–9B model on a long chunk), chunk-driven Port messages never fired. The worker
   was killed at 30 s in 2/2 runs. Only a timer-based heartbeat that doesn't depend on the stream (2/2 OK) covers this.
6. **A fetch in an extension page doesn't depend on the worker.** In `panelhost` the worker went idle and was killed at
   ~30 s while the panel page finished 90/90 chunks, in 3/3 runs.

Related S5 evidence (committed in 921fee0; `spikes/s5/results/onclicked-granted.jsonl` and
`onclicked-optional.jsonl`, the `panelTargetOpen` field and the `panel-LOADED`/`panel-UNLOAD` events). The decision's
premise that the real side panel container lives long enough rests on this, not on S1: the default side panel (global `side_panel.default_path`) stays loaded across
same-origin, cross-origin and browser-initiated navigations, reloads, and switching to another tab and back (one
`panel-LOADED`, no `panel-UNLOAD`, for the whole 68 s scenario). It unloads only when the user closes it.

## Decision

**User decision 2026-10-05: approved.** The DESIGN §4/§4.1 edits in "Proposed spec changes" are approved too. They
are applied in the final Phase B step, not in this record's commits.

**The engine runs in the side panel page.** This is the plan §5 default, unchanged. The worker only coordinates tabs,
injection and the context menu, and never awaits a model stream.

Why not the worker: keepalive is reliable, but not *trivially* reliable. It needs a timer heartbeat independent of the
stream (finding 5), started before the request and stopped only after the last job ends. Without one a worker can be
killed while waiting for the first byte. It also still needs persisted job state and re-request-on-restart for the cases
a heartbeat can't cover (extension update or reload, a worker crash, Chrome shutting the worker down for other reasons).
The suspension timer is also nondeterministic (finding 2), so heartbeat bugs would show up as rare, hard-to-reproduce
mid-page failures. The panel host removes that whole class of problem (finding 6).

## Consequences

- `entrypoints/sidepanel` owns the `TranslationEngine` instance and the per-tab jobs (keyed by `tabId`). `engine/` is
  unchanged (ROADMAP S1 note); only the shell wiring differs from DESIGN §4 diagram. Update DESIGN §4.1 item 2: the
  worker is the coordinator, and the "Port keeps the worker alive" sentence is wrong and should be removed (ROADMAP §8
  item 2).
- Closing the panel cancels in-flight translation. That matches M1's "cancel on panel close". Completed segments
  survive in the IndexedDB cache. The panel document lives per window, so two windows have two engines sharing one
  cache.
- No resume machinery and no `chrome.storage.session` job state in M1. Re-opening the panel re-extracts and serves
  finished segments from the cache.
- **M0-E2:** use the global `side_panel.default_path` (what S5 tested: it persists across navigations and tab switches).
  Do not give the panel a per-tab path with `sidePanel.setOptions({ tabId, path })`. Per-tab panels were not tested,
  and the review notes they unload on tab switch, which would cancel that tab's translation.
- **M0-E3:** the panel may call `chrome.scripting.executeScript` itself, because the `activeTab` grant belongs to the
  extension (S5: `panel-click-inject-OK` while the grant was alive). The worker still performs the gesture-time
  injection inside `action.onClicked`, and re-injects on `tabs.onUpdated`.
- **M0-E4:** the Port topology changes. Segments, viewport and hover events go content ⇄ panel directly
  (`chrome.tabs.connect(tabId)` from the panel), not through the worker. The worker keeps only action, context-menu,
  injection and tab-lifecycle messages. "Tab-scoped routing in the worker" (ROADMAP M0-E4) becomes tab-scoped routing in
  the panel. Not tested in S1.
- **Concurrency is per window.** Each window's panel has its own engine, so a profile's `maxConcurrency` (e.g. the
  Ollama preset's 1, DESIGN §4.3.6) would multiply by the number of open panels. Proposed rule for M1: take a Web Lock
  per connection (`navigator.locks.request('conn:<id>:slot<k>')`). Locks are shared by all same-origin extension pages,
  so the limit holds across windows. Not tested.
- **Tab moved to another window.** The job belongs to the panel of the window it started in. Proposed rule for M1: on
  `tabs.onDetached` the old panel cancels that tab's job. On `tabs.onAttached` the new window's panel, if open,
  re-extracts and gets cache hits for finished segments. Not tested.
- Provider requests come from the panel page (`chrome-extension://<id>` origin, same host-permission rules as the
  worker). S4 tests CORS from this context.
- If a future feature has to translate with the panel closed (e.g. a context-menu "translate selection" that shows the
  result elsewhere), the worker host would need a 20 s `getPlatformInfo()` heartbeat started before the request, plus
  persisted job state. Findings 4–5 are the evidence, from Chrome 154 only. The timer rules have changed across Chrome
  versions (e.g. Chrome 110 made API calls reset the timer; 116 extended it for WebSockets). Re-check that recipe on
  the minimum version (138) before relying on it. Not needed for v1.
- S1 doesn't constrain `minimum_chrome_version`, because the panel host uses nothing version-specific. Only Chrome 154 was tested.

## Limits of this spike

- Headless Chrome on one macOS machine; a mock stream, not a real provider. The panel was an extension page opened as a
  tab, not the side panel container. S5 confirms the real side panel's lifetime separately.
- **Hidden or minimized window (untested risk for the panel host).** Chrome throttles timers in hidden pages: about
  1/s, and once per minute after 5 minutes hidden, under intensive throttling. The M1 retry/backoff timers
  (DESIGN §4.3.5) run in the panel. A stream already in flight keeps flowing, but a scheduled retry may be late. M1
  should test translation with the window minimized and keep retry logic tolerant of late timers.
- Only Chrome 154 was tested; the planned minimum is 138.
- Surviving no-keepalive runs are unexplained, and more frequent than my runs suggested. I saw 2 of 14 (`noport` 1/7,
  `port-idle` 1/7); the tester saw 4 of 14 (tester-reported, logs not committed). The worker is killed in most runs, not reliably. That doesn't change the
  decision, which doesn't rely on the timer either way: a keepalive-free design must assume it can be killed.
- The `results/r1-*` logs lack the `ttfb` field in `stream-open`. Round 1 was produced by an older `server.mjs` (before
  the `ttfb` option was added). Rounds 2+ use the committed one. The round-1 results are kept; their stream behavior is
  the same (`ttfb` = 0).

## Proposed spec changes

**Applied in b10a1c0** (user decision 2026-10-05). Exact edits for `DESIGN.md`:

1. **§4 diagram** (lines 88–101).
   - Old: the "Service worker (orchestrator)" box holds "job queue/priority, chunker, prompt builder, provider
     adapters, cache (IndexedDB)", with a long-lived Port to the side panel carrying the "stream of segment
     translations".
   - New: the "Side panel" box holds "render, settings, translation engine (§5: chunker, prompts, parsing), provider
     adapters, cache (IndexedDB), per-tab jobs". The "Service worker (coordinator)" box holds "action/`Alt+T`, context
     menu, injection, tab lifecycle". The content script talks to the side panel directly.
2. **§4.1 item 2.**
   - Old: "**Service worker (orchestrator)**: Holds one job per tab … Caches results (§7). MV3 workers can be suspended.
     Each job keeps its state in `chrome.storage.session` and can resume. A long-lived Port to the panel keeps the
     worker alive while a stream is active."
   - New: "**Service worker (coordinator)**: handles the toolbar action, `Alt+T` and the context menu, injects the
     content script, and tracks tab lifecycle. It holds no translation state and never awaits a model stream (decision
     S1: an open Port does not keep a worker alive)."
3. **§4.1 item 3.**
   - Old: "**Side panel**: renders segments, settings, and glossary, and sends hover and scroll events back to the
     content script through the worker."
   - New: "**Side panel** (engine host): owns one job per tab in its window, runs the translation engine and provider
     calls, caches results (§7), renders segments, settings and glossary, and exchanges segments, viewport, hover and
     scroll events with the content script directly (`tabs.connect`)."
4. **§4.1 item 1** (the first line).
   - Old: "injected only when you open the panel, using the `activeTab` and `scripting` permissions"
   - New: the same text, plus "; re-injected on navigation while the `activeTab` grant or a site permission holds
     (decision S5)".

Who and when: the supervisor puts these to the user together with the S3/S5 spec changes, after Phase B acceptance.
