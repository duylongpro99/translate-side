# S4 — Ollama from an extension → error classifier rule

Status: proposed (awaiting review) · Date: 2026-10-05 · Chrome 154.0.8037.93 (macOS), headless · Spike code: `spikes/s4/`

Model = gpt-oss:20b (Ollama cloud), user decision 2026-10-05; qwen3.5:9b unavailable on cloud (404).

**Scope by user decision: Ollama cloud only (`https://ollama.com`).** Local Ollama (`http://localhost:11434`) and
`OLLAMA_ORIGINS` were **not tested**, by user decision. Ollama was not installed. So the half of the question that is
about local Ollama's `Origin` check is still open (see Limits).

## Question

ROADMAP §2 S4: Ollama rejects requests whose `Origin` is not allowed with **403**, which DESIGN §4.3.5 classifies as
*auth* ("Fix key"). Does a granted host permission change anything? Is `OLLAMA_ORIGINS` still required? Output: the error
classifier rule. Plan §5 default: **"`403` + auth `none` + localhost → `cors` (ROADMAP §8 item 5)."**

For the cloud, the questions become:

1. Can an extension page and the worker call `https://ollama.com` at all, with and without a host permission (CORS)?
2. What do 401/403/404/429 look like for a valid, an invalid and a missing key, for an unknown model, and for a wrong
   path? Does any of them look like the local CORS 403?
3. Which rows does the classifier need for an Ollama cloud connection (`openai-chat` protocol, auth `bearer`)?

## Method

- `spikes/s4/ext/` is a minimal MV3 extension. `probes.js` is loaded both by `panel.html` (the side panel document)
  and by the worker (`importScripts`). It runs 17 fixed requests and records status, `Response.type`, selected headers
  and the first 240 chars of the body, or the thrown error's name and message.
- `spikes/s4/drive.mjs` starts an isolated headless Chrome (temporary profile, `--remote-debugging-pipe`), loads the
  extension with `Extensions.loadUnpacked`, opens `chrome-extension://<id>/panel.html` as a tab, and runs the probes
  from that page and from the worker through CDP `Runtime.evaluate`. The key goes over the CDP pipe into page memory only.
  All output is passed through `redact()`.
- Two variants of the same extension: **granted** has `host_permissions: ["https://ollama.com/*"]`, **none** has no
  host permission.
- The 17 requests:
  - `GET /api/tags` and `/v1/models` with no key and an invalid key.
  - `POST /v1/chat/completions` (streaming and non-streaming) and `POST /api/chat` with:
    - a valid, an invalid and a missing key, and `Basic` auth;
    - model `no-such-model:1b` and `qwen3.5:9b`;
    - a body that is not JSON, and a body with no messages.
  - A wrong base path, `/api/v1/chat/completions`.
- Node-side probes (no extension, same key reader `spikes/s4/key.mjs`):
  - `curl` preflight (`OPTIONS`) with `Origin: chrome-extension://…`.
  - `concurrency.mjs`: N simultaneous tiny chat calls, N = 1…6, then 8, 10, 12.
  - `plan-402.mjs`: models outside the free plan, on both endpoints, streaming and not.
  - `chat-once.mjs`: one chat call to a named model.
- The first extension run happened while the S2 runs were sending 8 concurrent requests on the same key. It is kept as
  `results/*-under-load.json`, because it captured the 429 shape. The clean run is `results/granted.json` and
  `results/none.json`.
- `spikes/s4/leak-check.mjs` scans every file in the worktree for the key (counts only) before each commit: 0 hits.

## Evidence

### 1. CORS: the host permission decides everything

`ollama.com` sends no CORS headers. A preflight `OPTIONS` with `Origin: chrome-extension://…` returns **405** and no
`Access-Control-Allow-*` headers. A plain `GET /api/tags` returns 200 without `Access-Control-Allow-Origin`.

| Variant | Panel page | Worker |
|---|---|---|
| **none** (no host permission) | all 17 requests: `TypeError: Failed to fetch`. No status or body is visible. | same, 17/17 |
| **granted** (`https://ollama.com/*`) | every request reaches the server; `Response.type` is `basic` (CORS bypassed) | identical statuses and bodies |

Without the host permission, nothing reaches JavaScript: not even a 401 for a bad key. The error is the same
`TypeError` that a network failure (offline, DNS) gives. So the cloud failure is the reverse of the local one: local
Ollama answers **403** (per the ROADMAP; not tested here), while the cloud gives **no response at all**.

Panel and worker behave the same. One side note, which confirms S1: when the panel probes ran first (more than 30 s),
the idle worker was suspended and its target was gone when the driver tried to attach (`No target with given id
found`). The driver now runs the worker probes first.

### 2. Status and body shapes (granted variant, clean run)

| Case | `/v1/chat/completions` (OpenAI-compatible) | `/api/chat` (native) |
|---|---|---|
| valid key, gpt-oss:20b | 200; streaming: `text/event-stream` | 200 JSON |
| invalid key | **401** `{"error":{"message":"Unauthorized","type":"api_error",…}}` | **401** `{"error":"Unauthorized"}` |
| missing key | **401**, same body | **401**, same body |
| `Basic` auth | **401**, same body | — |
| unknown model, valid key | **404** `{"error":{"message":"model \"no-such-model:1b\" not found","type":"not_found_error",…}}`, with **`content-type: text/html`** on a JSON body | **404** `{"error": "model 'no-such-model:1b' not found"}`, `text/plain` |
| `qwen3.5:9b`, valid key | **404**, same shape (`model "qwen3.5:9b" not found`) | 404 (`chat-once.mjs`) |
| unknown model, invalid key | **401** (auth is checked before the model) | — |
| body not JSON | **400** `invalid character 'n' looking for beginning of object key string (ref: …)` | — |
| no messages | **400** `[] is too short - 'messages' (ref: …)`, type `invalid_request_error` | — |
| wrong base path `/api/v1/chat/completions` | **404** `{"error":"path \"/api/v1/chat/completions\" not found"}` | — |
| `GET /v1/models`, `GET /api/tags`, no key or invalid key | **200**, full model list | **200** |

**No 403 appeared anywhere**: 0 of 34 requests in the clean run, 0 in the run under load, and 0 in the Node-side probes.

Model listing is public. `GET /v1/models` returns 200 with an invalid key, so it cannot test a key. Only a chat call
can.

### 3. Rate and plan limits (Node side, same key)

- **429 "too many concurrent requests".** `{"error":"too many concurrent requests"}` with `Retry-After` in seconds
  (11–20 seen). On `/v1/chat/completions` the body is a bare `{"error": "…"}`, not the OpenAI-style object.
  - It comes before any SSE, also for streaming requests.
  - In the run under load, 7 of the 17 panel probes and 7 of the 17 worker probes got 429. That was every request with a
    valid key except the three model listings, which are public, and the wrong path, which still got its 404. All 6
    invalid-key, missing-key and Basic-auth requests still got 401. So auth is checked before the concurrency limit,
    and the limit is checked before the model lookup.

  Concurrency sweep (`results/concurrency-*.json`):

  | Simultaneous requests | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 |
  |---|---|---|---|---|---|---|---|---|---|
  | 429s | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 4 | 6 |

  So this account is limited to about **6 concurrent requests**. The S2 runs use 4.
- **402 "not in the Free plan".** Models outside the key's plan (kimi-k3, glm-5.3, deepseek-v4-pro) return **402** on
  both endpoints, streaming or not, before any SSE:
  `This model is not in the Free plan. Pro is $20/month … https://ollama.com/upgrade (ref: …)`.
  These models are still listed by `/v1/models`, so the list does not tell you which models the key can use.
- **Not observed:** 5xx, any mid-stream error event, and the "5-hour or weekly caps" the 402 message mentions. The
  usage-cap response shape is unknown.

## Decision

1. **An Ollama cloud connection needs the `https://ollama.com/*` host permission, as an optional host permission
   requested when the connection is added.** Without it, every call fails as `TypeError`. That matches DESIGN §4.3.4
   ("Removing a connection … revokes the optional host permission"). The host permission is what makes cloud calls work.
   `OLLAMA_ORIGINS` is a local-server setting and plays no part for the cloud.
2. **Classifier rule (proposed; adapter level, before the pipeline sees anything):**

   | # | Observation | `LLMError.kind` | Retry / fallback | Panel / Test connection message |
   |---|---|---|---|---|
   | 1 | `fetch` throws `TypeError` **and** `chrome.permissions.contains({origins:[base]})` is false | `cors` | no retry; no silent fallback | "No access to {host}" + **[Grant access]**, which calls `permissions.request` from the click |
   | 2 | `fetch` throws `TypeError` and the permission is held | `network` | backoff, then the fallback profile (as §4.3.5) | "Can't reach {host}" |
   | 3 | `401` | `auth` | stop; no fallback (as §4.3.5) | "Key invalid or missing" + **Fix key** |
   | 4 | `402` | **new: `plan`** | stop for this model; no silent fallback (like `auth`) | the server's message (it has the upgrade link) + "pick another model" |
   | 5 | `404` and the message matches `/model .* not found/i` or `type: not_found_error` | `model_not_found` | stop | "Model {m} not found." For the cloud, offer the models list. Show `ollama pull` only for localhost. |
   | 6 | `404` otherwise | `bad_request` | stop | "Wrong base URL ({path} not found)" |
   | 7 | `429` | `rate_limit`, `retryAfterMs` = `Retry-After` × 1000 | backoff (honor `Retry-After`), then fallback (as §4.3.5) | backoff indicator |
   | 8 | `400` | `bad_request` | quirk flip and retry once, as §4.2.4 | the server's message |
   | 9 | `403` + auth `none` + localhost | `cors` | **plan default, kept; untested here** | CORS guide (§4.3.6) |
   | 10 | `403` otherwise | `auth` | as §4.3.5 | Fix key. **Never observed on the cloud**; kept from §4.3.5. |

   Matching runs on status first, then on the message text. **Never on `content-type`**: the 404 model-not-found body
   is JSON labelled `text/html`. The message is `error.message` when `error` is an object, else `error` when it is a
   string; both forms occur on `/v1`.
3. **Test connection for the cloud preset** (M4-E5) must validate the key with a minimal chat call (`max_tokens: 1`),
   not with `listModels`, which is public.
4. **Ollama cloud preset:** `maxConcurrency` ≤ 4 (account limit measured at about 6, shared with every other client on
   the key).

## Deviation from plan default

The default rule ("`403` + auth `none` + localhost → `cors`") is **kept unchanged**, as row 9. It is neither confirmed
nor refuted, because localhost was not tested (user decision).

Rows 1, 4 and 6 are **additions** that change DESIGN §4.3.5 / §4.2.1, so they are listed here for the user:

- **(d) Row 1, missing host permission → `cors`.** It is not a 403, so the plan's rule never fires for it. Without row 1,
  this case falls into `network`, and the panel would retry and fall back silently, when the fix is one click.
  Evidence: §1 above, 34 of 34 requests. Alternative: a separate kind `permission`. I chose `cors` because DESIGN already
  shows "CORS blocked — Fix…" for the same user-facing problem: the browser blocks the call, and the user fixes it
  outside the key field.
- **(e) Row 4, a new kind `plan` for 402.** DESIGN §4.2.1's `LLMError.kind` has no fitting value. `auth` would show "Fix
  key" for a valid key. `bad_request` would trigger the quirk-flip retry. `rate_limit` would back off and retry forever.
  Evidence: §3, 6 of 6 requests.
- **Row 6, 404 not about a model → `bad_request` "wrong base URL".** This only fills a gap: ROADMAP M4 already lists
  "wrong base URL" as a Test connection message.

## Consequences

- M4-E5 (probe and friendly errors) implements the table above. The classifier reads `status` and both message forms. How the `openai` SDK's
  `APIError` exposes a body whose `content-type` is not JSON (the 404 above) was not checked here. Check it in M1-E6 and
  fall back to the raw text if needed. Unit tests: one fixture per row,
  built from `spikes/s4/results/*.json`.
- M1-E6 (`LLMClient` contract and classifier): add `plan` to `LLMError.kind`. Row 1 needs the adapter to know whether
  the host permission is held. Either the shell passes a `hasHostPermission(base)` port into the engine (the engine stays
  free of `chrome.*`, §5.1), or the adapter returns `network` with a `maybePermission` flag and the shell refines it.
  **Proposed: the port**, because the classification then lives in one place.
- Connection setup UI: adding an Ollama cloud connection asks for the host permission inside the same click (a user
  gesture is required, as S5 found).
- The panel host decision (S1) is unaffected: panel and worker behave the same for every request here.
- S2 must honor 429 `Retry-After` and keep the chunk concurrency at or below the preset's limit.

## Limits of this spike

- **Local Ollama not tested (user decision).** These questions stay open: the local 403 body, whether a granted host
  permission for `http://localhost:11434/*` changes Ollama's `Origin` check (Chrome still sends
  `Origin: chrome-extension://…` on POST), whether `OLLAMA_ORIGINS` is still required, and the §4.3.6 guide text. Row 9
  is the plan default, carried over without evidence. Test it in M4 when local presets land.
- One account, free plan. The concurrency limit (about 6) and the 402 models are plan-specific. Usage-cap responses
  (5-hour, weekly) were not provoked.
- 5xx and mid-stream errors were not observed, so their shapes are unknown.
- "Panel" means `panel.html` opened as an extension tab: same `chrome-extension://` origin and permissions as the side
  panel document, but not the side panel container itself. S1 used the same setup.
- Response bodies and headers are as of 2026-10-05. The `ref:` ids differ per request. The model list changes over
  time.

## Proposed spec changes

1. **DESIGN §4.2.1** `LLMError.kind`:
   - old: `"auth" | "rate_limit" | "overloaded" | "context_length" | "bad_request" | "model_not_found" | "network" | "cors" | "unknown"`
   - new: the same plus `| "plan"`, with the comment `// 402: model or feature not in the account's plan`.
2. **DESIGN §4.3.5**, "Classify errors":
   - old: "`401/403` (auth): stop, mark the connection `error`, and show "Fix key" in the panel."
   - new: "`401`, and `403` unless the CORS rule applies (auth): stop … (unchanged). A `fetch` `TypeError` while the
     connection's host permission is not held → `cors`: show "No access to {host}" with a **Grant access** button. `402`
     (`plan`): stop for that model and show the server's message. `404` → `model_not_found` when the message names a
     model, else "wrong base URL". `429`: honor `Retry-After`. Match on status and message, never on `content-type`."
3. **DESIGN §4.3.2 presets table**: add a row "Ollama (cloud) | openai-chat | https://ollama.com/v1 | bearer | Needs the
   `https://ollama.com/*` host permission; `maxConcurrency` 4; Test connection uses a 1-token chat call (model listing
   is public)".
4. **ROADMAP §8 item 5**, append: "For Ollama cloud there is no 403: without the host permission every call fails as a
   `TypeError` (S4). Classify that as `cors` when the permission is missing. The local 403 rule is still untested."
