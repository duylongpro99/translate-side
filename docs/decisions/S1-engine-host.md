# S1 — MV3 worker suspension during streaming → where the engine runs

Status: proposed (awaiting review) · Date: 2026-10-05 · Chrome 154.0.8037.93 (macOS) · Spike code: `spikes/s1/`

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

1. **An open Port does not keep the worker alive.** `port-idle` was killed at 30 s in 6 of 7 runs. The panel received
   `onDisconnect` at the same moment, and the server saw the client abort the stream after 29 chunks.
2. **Reading a fetch body is not activity.** With no other activity the worker is usually killed at 30 s mid-stream.
   It was killed in 6 of 7 `noport` runs; `port-idle` likewise survived once. I found no cause for either survivor (logs
   `results/r2-noport.jsonl`, `results/r6-port-idle.jsonl`). Suspension is not deterministic, so "it worked in testing" isn't evidence of safety.
3. **On suspension the in-flight stream is lost.** The fetch is aborted with no callback in the worker. A new worker
   instance starts on the next event (here the panel reconnecting). It sees whatever `chrome.storage.session` held
   (`{"state":"running","n":0}`), so resuming is possible, but only by re-requesting, and only if the job state was
   persisted.
4. **Any extension API call, or Port message in either direction, resets the 30 s timer.** Worker→panel messages,
   panel→worker pings, `getPlatformInfo()` every 20 s and `storage.session.set` each kept a stream alive for 90 s in
   every run, and for 400 s in the long runs. The 5-minute limit did not apply to reading a fetch body.
5. **Keepalive tied to stream chunks fails before the first token.** With 45 s to the first byte (a realistic
   prompt-processing delay for a local 7–9B model on a long chunk), chunk-driven Port messages never fired. The worker
   was killed at 30 s in 2/2 runs. Only a timer-based heartbeat that doesn't depend on the stream (2/2 OK) covers this.
6. **A fetch in an extension page doesn't depend on the worker.** In `panelhost` the worker went idle and was killed at
   ~30 s while the panel page finished 90/90 chunks, in 3/3 runs.

Related S5 evidence (`spikes/s5/results/`): the default side panel (global `side_panel.default_path`) stays loaded across
same-origin, cross-origin and browser-initiated navigations, reloads, and switching to another tab and back (one
`panel-LOADED`, no `panel-UNLOAD`, for the whole 68 s scenario). It unloads only when the user closes it.

## Decision

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
- Provider requests come from the panel page (`chrome-extension://<id>` origin, same host-permission rules as the
  worker). S4 tests CORS from this context.
- If a future feature has to translate with the panel closed (e.g. a context-menu "translate selection" that shows the
  result elsewhere), the worker host would need a 20 s `getPlatformInfo()` heartbeat started before the request, plus
  persisted job state. Findings 4–5 are the evidence. Not needed for v1.
- S1 doesn't constrain `minimum_chrome_version`, because the panel host uses nothing version-specific. Only Chrome 154 was tested.

## Limits of this spike

- Headless Chrome on one macOS machine; a mock stream, not a real provider. The panel was an extension page opened as a
  tab, not the side panel container. S5 confirms the real side panel's lifetime separately.
- The two surviving no-keepalive runs (1/7 each) are unexplained. It doesn't change the decision, which doesn't rely on the timer's
  behavior.
