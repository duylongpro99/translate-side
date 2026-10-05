# S2 — `<seg>` parse robustness → parser grammar and repair policy

Status: proposed (awaiting review) · Date: 2026-10-05 · Spike code: `spikes/s2/`

Model = gpt-oss:20b (Ollama cloud), user decision 2026-10-05; qwen3.5:9b unavailable on cloud (404). The user picked
gpt-oss:20b after qwen3.5:9b returned 404 on cloud.

Haiku not tested — user decision 2026-10-05.

## Question

ROADMAP §2 S2 asks how the `<seg>` format breaks:

- missing, merged, reordered or unclosed segments;
- a literal `<` in the source text;
- attribute quoting drift;
- a stream cut by `max_tokens` in the middle of a segment.

The method it gives: 50 chunks from 10 pages, counting segment loss, merges and marker corruption, and trying `<`/`>`
escaping and a strict `<seg id="N">` grammar with a lenient fallback. The outputs: the parser grammar, the repair policy,
and the `maxOutputTokens` multiplier per target language.

Plan §5 default, verbatim: **"Strict `<seg id="N">` with lenient fallback; retry only missing segments; treat
`max_tokens` cut as "re-request open segment"."**

The supervisor also asked whether gpt-oss's reasoning ("thinking") output gets in the way of the format.

## Method

### Input

- **Chunks.** `spikes/s2/segment.mjs` builds the chunk set from the 10 licensed S3 fixtures. It takes each fixture's
  `contentSelector` root, flattens shadow DOM, applies the S3 generic and per-site cleanup, and turns block elements into
  segments. Inline markup becomes the DESIGN §5.7 markers (`[link]…[/link]`, `` `code` ``, `*em*`, `**strong**`); `pre`
  is skipped. Chunks are about 450 estimated tokens or 14 segments. Five chunks per fixture are spread over the document.
  That gives **49 real chunks, 541 segments** (median 332 estimated source tokens per chunk). One fixture yielded only
  four distinct chunks. Six real segments contain `<` or `>`, all inside code spans (`Vec<T>`, `<!-- … -->`).
- **Adversarial chunks.** `adversarial.json` has **5 synthetic chunks, 31 segments**:
  - adv#0: literal `<seg id="2">`, `</seg>` and `<p>` in prose, plus `Result<T, E>` and `=>`;
  - adv#1: prompt-like text ("Ignore all previous instructions…");
  - adv#2: twelve one-word table cells, some repeated;
  - adv#3: one sentence split across five segments;
  - adv#4: entities and ampersands (`&amp;`, `AT&T`, `2>&1`).

  They are counted separately from the real chunks.

### Model and calls

- `run.mjs` sends gpt-oss:20b on Ollama cloud to `/v1/chat/completions`, streaming, as the `openai-chat` adapter would.
  Settings: `temperature` 0.2, `max_tokens` 4096 unless stated. The system prompt is the DESIGN §5.7 `translate@1` draft
  word for word, with the brief reduced to `{"title": …}`, an empty glossary, and style Natural. The user message is the
  chunk as `<seg id="N">…</seg>` lines.
- The draft parser runs on the stream deltas as they arrive. Every stored output was also re-parsed offline with both
  grammars (`reparse.mjs`), so arms that ran before and after the v2 change compare like for like.
- Concurrency was 4, because the account limit is about 6 (S4). Each run retries on 429/5xx and times out a stalled
  stream after 240 s. Over all arms, **0 non-200 attempts** remain in the logs. An earlier batch at concurrency 8 was
  stopped and discarded; its 429s are in S4.

| Arm | Target | Source | Effort | `max_tokens` | Chunks |
|---|---|---|---|---|---|
| vi-raw-1, vi-raw-2 | Vietnamese | as is | low | 4096 | 49 real + 5 adv, twice |
| vi-esc | Vietnamese | `&`, `<`, `>` escaped as entities, with one extra prompt rule to keep them | low | 4096 | 49 + 5 |
| vi-esc-adv-2, -3 | Vietnamese | escaped | low | 4096 | 5 adv, twice more |
| de-raw | German | as is | low | 4096 | 49 + 5 |
| ja-raw | Japanese | as is | low | 4096 | 49 + 5 |
| vi-raw-medium | Vietnamese | as is | **medium** | 4096 | 49 + 5 |
| cut-1.0 | Vietnamese | as is | low | **1.0 ×** est. source tokens | 49 real |
| cut-2.0 | Vietnamese | as is | low | **2.0 ×** est. source tokens | 49 real |

In total: **10 arms, 432 first-pass calls, 4,576 segments**, plus **58 repair calls** (below). Estimated source tokens
are source chars ÷ 4, the cheap estimate an engine without a tokenizer would use.

### Parser and checks

- `parser.mjs` is the grammar draft: `SegParser` (streaming), `plan()` (the repair plan), and `esc`/`unesc`.
- `corpus.test.mjs` is the malformed-output corpus: **22 cases, each fed in 200 random delta splits** so that tag
  boundaries land mid-delta. All pass, and every result is the same under every split. The cases cover:
  - quoting and case drift, a missing segment, a merged pair, a missing close, fences and preambles;
  - reordered, duplicate and unknown ids;
  - a `max_tokens` cut inside a segment and inside a tag, an end without a close;
  - an orphan close, an empty segment, prose only;
  - the literal-tag cases seen in the runs, under both v1 and v2.
- `checks.mjs` holds the post-parse checks:
  - markers: `[link]` counts, backtick spans byte-identical as a multiset, `**` counts;
  - HTML tags that appear in the output but not in the source;
  - "untranslated" (output identical to the source).
- `repair.mjs` applies the plan: one follow-up call per chunk, with only the re-request ids, `max_tokens` 4096, then a
  merge.
- `analyze.mjs` writes `results.md` with every table below and a per-chunk list of everything flagged.

## Evidence

### 1. Format compliance on real chunks (low effort): almost perfect

Re-parsed with v2. On all 392 real-chunk outputs (every arm, cut arms included), v1 and v2 give identical segments,
missing ids, cuts and re-request sets.

| Arm | Strict parse | Lenient fix used | Segments missing | Merged | Reordered / dup / unknown | Quoting drift | Stray text |
|---|---|---|---|---|---|---|---|
| vi-raw-1 | 48/49 | 1 × last `</seg>` missing | 0/541 | 0 | 0 | 0 | 0 |
| vi-raw-2 | 47/49 | 2 × last `</seg>` missing | 0/541 | 0 | 0 | 0 | 0 |
| vi-esc | 48/49 | 1 × last `</seg>` missing | 0/541 | 0 | 0 | 0 | 0 |
| de-raw | 49/49 | — | 0/541 | 0 | 0 | 0 | 0 |
| ja-raw | 48/49 | 1 × last `</seg>` missing | 0/541 | 0 | 0 | 0 | 0 |
| **Total** | **240/245 (98.0%)** | **5 chunks, all the same fix** | **0/2,705** | **0** | **0** | **0** | **0** |

- The only deviation gpt-oss:20b produced on real text was **omitting the final `</seg>`**, then stopping normally
  (`finish_reason: stop`). In each case the last segment was complete, so the parser accepts it (`unclosed-end`).
- Never seen: missing segments, merged segments, reordering, duplicates, `id='N'` or `id=N` drift, code fences, or
  preambles.
- The plan's "suspect-merged" length-ratio rule never fired on real output. The only "merge" in the data is a missing
  close in the corpus.

### 2. Literal `<seg` / `</seg>` in the source: v1 corrupts silently, v2 parses it

adv#0 contains `type <seg id="2"> before it and </seg> after it` and `The closing tag </seg> is not special`. The model
echoes those literally (in every raw arm) or as entities (escaped arm, when it keeps them).

| Arm | Output had | v1 (plain lenient grammar) | v2 (close-by-lookahead) |
|---|---|---|---|
| vi-raw-1, vi-raw-2, de-raw, ja-raw, vi-raw-medium | literal tags | **wrong**: segment 1 cut off at the fake tag; the fake segment's text (" trước nó và ") stored under **id 2**; real id 2 dropped as a duplicate; segment 5 truncated. Caught only through dup + orphan-close → whole chunk re-requested. | **right**: 5/5 ids; segments 1 and 5 keep the literal tags as text |
| vi-esc, vi-esc-adv-2 | entities (`&lt;seg…`) | right | right |
| vi-esc-adv-3 | entities **decoded** back to literal tags | **wrong**, as above | **right** |

So v2 parses **8/8** runs of adv#0 correctly, and v1 **2/8**. On the other adversarial chunks both grammars agree.

The re-sent chunk would hit the same problem again unless it was escaped, and escaping is not reliable either (§3).

### 3. Escaping `&`, `<`, `>`: unreliable, and it makes things worse

| Arm | Chunks with entities | All entities came back as entities | Some or all decoded to literal characters |
|---|---|---|---|
| vi-esc (real + adv) | 9 | 7 | 2 |
| vi-esc-adv-2 | 2 | 2 | 0 |
| vi-esc-adv-3 | 2 | 1 | 1 (adv#0, the literal-tag chunk) |
| **Total** | **13** | **10** | **3 (23%)** |

The model follows the "keep them as entities" rule only most of the time, so the output is a mix that a plain `unesc`
cannot always undo. For example, a `&amp;` the source really contained (adv#4) is ambiguous after round-tripping.

Escaping also raised **HTML drift**. Output `<code>…</code>` or `<strong>` in place of backticks or `**` appeared in 6
segments in vi-esc, against 1 in each raw Vietnamese arm. Entities seem to put the model into "HTML mode".

### 4. `max_tokens` cuts

| Arm | Chunks cut (`finish_reason: length`) | Inside a segment | Inside a tag | Between segments | Before any content (reasoning only) |
|---|---|---|---|---|---|
| cut-1.0 | 49/49 | 37 | 9 | 2 | 1 |
| cut-2.0 | 8/49 | 6 | 2 | 0 | 0 |

- **Inside a segment.** The parser reports `cut: {id, text}`, with the partial text already streamed to the panel. Every
  later id is reported as missing.
- **Inside a tag** (`…</seg>\n<seg id`). v2 closes the previous segment, because at the end of the stream a close
  followed by a partial open tag is a real close. The partial tag goes to stray, and the rest is missing.
- **Before any content.** Nothing to parse. All ids are missing.

**Repair (one follow-up call each, only the plan's re-request ids, budget 4096):**

| Arm | Segments re-requested | Repair calls | Lost after one repair |
|---|---|---|---|
| cut-1.0 | 248 of 541 | 49 | **0** |
| cut-2.0 | 31 of 541 | 8 | **0** |
| vi-raw-medium | 14 of 572 (one chunk with no content, §5) | 1 | **0** |

Segment loss after one repair round is **0 / 1,654** over the three arms. All 58 follow-up calls parsed strictly, with
zero fixes, and ended with `finish_reason: stop`.

### 5. Reasoning output (gpt-oss "thinking")

- **It never reaches the content.** On `/v1/chat/completions`, reasoning arrives in a separate `delta.reasoning` field
  (`message.thinking` on `/api/chat`), and `delta.content` holds only the answer. Stray text is 0 in every arm except
  the cut ones, so no reasoning leaked into the format. At medium effort the reasoning often drafts the `<seg>` lines
  first ("mentions `<seg`" in `results.md`). That is harmless, because the parser reads only `content`. **The adapter
  must not concatenate `reasoning` into `text` events.**
- **It counts against `max_tokens` and the bill.** Ollama reports a single `completion_tokens` figure for reasoning and
  content together.

| Effort | Reasoning chars per chunk, med / p90 / max | Completion tokens ÷ est. source tokens, med (p90, max) | First content token, s, med (p90) |
|---|---|---|---|
| low (vi-raw-1) | 23 / 27 / 59 | 1.54 (2.20, 3.63) | 15.5 (20.5) |
| **medium** (vi-raw-medium) | **3,988 / 8,190 / 13,666** | **5.24 (9.31, 23.47)** | **54.4 (97.0)** |

  At medium effort, one chunk (twir-671#1) spent the **whole 4,096-token budget on reasoning** and returned no content.
  All 14 of its segments were missing until the repair call.
- **It can't be switched off.** In single calls, `reasoning_effort: "none"` was accepted but produced 616 reasoning
  chars, more than `low`; `"minimal"` gave 62 and `"high"` 1,243. `think: false` was ignored (211 chars).
  `reasoning_effort: "low"` is the lowest setting that works.

### 6. Output budget (`maxOutputTokens`)

Completion tokens ÷ estimated source tokens, real chunks, low effort:

| Target | Median | p90 | Max | Chunks over 2.5× |
|---|---|---|---|---|
| German | 1.44 | 2.15 | 3.61 | 4/49 |
| Vietnamese (3 arms) | 1.52–1.54 | 2.20–2.26 | 3.63–4.00 | 4/49 each |
| Japanese | 1.69 | 2.44 | 5.15 | 5/49 |

The high ratios all come from small chunks. With `<seg>` tags and the reasoning preamble as a fixed cost, the source
text is a poor predictor. The DESIGN §5.7 rule "about 2.5× the chunk's source tokens" would have cut **35 of 270**
low-effort chunks (adversarial ones included). Checked offline against all 270 low-effort calls:

| Budget formula | Chunks it would cut |
|---|---|
| 2.5 × src | 35 / 270 |
| 2.0 × src + 12 × segments | 5 / 270 |
| **2.0 × src + 12 × segments + 256** | **0 / 270** |
| 1.8 × src + 12 × segments + 256 | 0 / 270 |

At medium effort, the same formula with a 256 reserve cuts 51/54 chunks, with 2,048 it cuts 4/54, and with 4,096 it
cuts 0/54.

Japanese needs about 10% more than Vietnamese or German at the median, and the 2.0× term absorbs that. A per-language
multiplier was not needed for these three languages.

### 7. Marker preservation (for the M2 `check` stage, not a parse problem)

Segments with a marker issue (link count, backtick spans, `**` count), real chunks:

| Arm | vi-raw-1 | vi-raw-2 | vi-esc | de-raw | ja-raw | vi-raw-medium |
|---|---|---|---|---|---|---|
| Issue rate | 2 (0.4%) | 2 (0.4%) | 8 (1.5%) | 2 (0.4%) | **26 (4.8%)** | 11 (2.0%) |

Japanese mostly drops `[link]` around terms the model restructured (Wikipedia: `[link]computer science[/link]` became
plain コンピュータ科学), and adds backticks around quoted terms (“io-util” became `` `io-util` ``). These are translation
quality issues for DESIGN §5.7 step 4, and the parser doesn't see them.

"Untranslated" segments (53–69 per arm) are mostly correct keeps. In the first 25 of vi-raw-1's 57: lorem ipsum (the
Material admonition demo text), product names, and browser names.

## Decision

### Grammar: v2, "close-by-lookahead" (`spikes/s2/parser.mjs`, default `grammar: 'v2'`)

```
output := WS (seg WS)* [stray]
seg    := OPEN text CLOSE
OPEN   := '<seg id="' DIGITS '">'                  strict
        | '<' WS? 'seg' attrs '>' with id="N" | id='N' | id=N, any case   lenient (counted as a fix)
CLOSE  := '</seg>' | '<' WS? '/' WS? 'seg' WS? '>'  — a CLOSE token counts as a close only if what follows it, after
          whitespace, is an OPEN, another CLOSE, the end of output, or (at the end) a partial OPEN
text   := anything; inside an open segment, an OPEN, or a CLOSE that fails the lookahead, is literal text
```

- Strict output parses with zero fixes. Every lenient path is recorded as a `fix` with a kind, for telemetry.
- Streaming: hold back at most 40 chars while a `<` could still become a tag, and at most the whitespace after a
  `</seg>` until the lookahead decides. `segment.partial` is emitted for the text as it arrives.
- End of stream inside a segment:
  - `stopReason: max_tokens` → `cut` (open segment plus its partial text);
  - `end` → accept the segment (`unclosed-end`). This is the one fix gpt-oss actually needs.
- A segment that saw a CLOSE failing the lookahead, and no later close, ends at that CLOSE; the rest is stray. This
  handles a literal `</seg>` near the end of a segment followed by a model note.
- Duplicate id: the first one wins. Unknown ids are dropped. Out-of-order ids are accepted. Each is a fix.

### Repair policy (`plan()`)

- Re-request, in **one follow-up call per chunk**, exactly these segments:
  - the missing ones;
  - the `cut` one plus every one after it (all of them missing);
  - empty ones;
  - suspect-merged ones: a neighbour is missing and either the ratio is over 1.6× the chunk's median, or an OPEN was
    swallowed as text.
- If the structure is ambiguous (any dup, orphan close or unknown id), **re-request the whole chunk**.
- Keep everything else.
- A segment still failing after one repair round becomes `segment.failed` (M2's "re-request once, then mark failed").
- `stopReason: max_tokens` is the "re-request open segment" case from the plan default. The partial text stays visible
  until the repair result replaces it.

### No escaping of the source

Send `<`, `>` and `&` as they are. The v2 grammar makes literal tags in the source safe without escaping, and escaping
was neither reliable (§3) nor neutral (more HTML drift).

### Output budget

`maxOutputTokens = 2.0 × estTokens(source) + 12 × segments + reasoningReserve`, where `estTokens` is chars ÷ 4 and
`reasoningReserve` is 0 for models without reasoning, 256 for a reasoning model at `low` effort, and 4,096 at `medium`.
The reserve is a per-model or per-preset setting (a quirk flag next to `supportsTemperature`). No per-language
multiplier for now.

### Reasoning models

Use the lowest effort that works (`reasoning_effort: "low"` for gpt-oss). Treat `delta.reasoning` / `thinking` as
non-content: count it in usage, never emit it as `text`. A chunk that ends with no content at all and
`finish_reason: length` is a `cut` before segment 1. Re-request it with the full reserve once, then fail it.

## Deviation from plan default

Plan default: "Strict `<seg id="N">` with lenient fallback; retry only missing segments; treat `max_tokens` cut as
"re-request open segment"."

- **(f) The lenient fallback is context-sensitive (v2), not a plain set of looser tag patterns.** The difference from
  plain lenient parsing (v1) is two rules:
  - a CLOSE closes only when the lookahead allows it;
  - an OPEN inside an open segment is text, not an implicit close.

  Evidence: §2. v1 put the wrong translation under a real id in 6 of 8 runs of the literal-tag chunk, and it noticed
  only because a duplicate happened to follow. v2 got all 8 right. On all 392 real-chunk outputs, v1 and v2 give
  identical results.

  Cost: a model that drops a mid-chunk `</seg>` before the next `<seg>` now produces "missing + merged". Both segments
  are re-requested, where v1 would have split them silently. That never happened in 3,246 real segments (all six
  non-cut arms), and the swallowed-open rule catches it in the corpus.
- **The rest of the default holds and is made exact:**
  - "retry only missing segments" becomes the re-request set above, which adds cut, empty and suspect-merged segments;
  - an ambiguous structure re-requests the whole chunk;
  - "re-request open segment" becomes "the open segment and all segments after it". One follow-up call brought loss to
    0 in every cut case (§4).
- **Not a plan deviation, but a DESIGN change:** the output budget formula (§6) replaces DESIGN §5.7's "about 2.5×
  source tokens". The flat 2.5× would cut about 13% of chunks on this model, and the formula cuts none. See Proposed
  spec changes.

## Consequences

- **M1-E3** (`<seg>` streaming parser plus repair) ports `parser.mjs` v2 and `plan()` into `engine/parsing/`.
  - The corpus in `corpus.test.mjs` becomes its golden tests, including the 200-split determinism check. M1's "parser
    fuzz tests pass" exit criterion can build on that harness.
  - The seen outputs in `spikes/s2/runs/*.jsonl` are a ready replay set.
- **M1-E6** (`openai-chat` adapter):
  - map `delta.reasoning` / `reasoning_content` to usage only, never to `text` events;
  - send `reasoning_effort` when the preset says so;
  - add the `reasoningReserve` quirk.
- **M1 chunker:** budget per the formula. Keep chunks around 300–450 estimated tokens. Small chunks pay the fixed
  overhead (tags and the reasoning preamble), so they cost proportionally more.
- **M1 exit criterion** "Segment loss after repair is 0 on the fixtures": met on this model, with one repair round, in
  every arm measured.
- **M2-E4** (`check` stage): marker loss is the real quality risk (4.8% of Japanese segments), not parsing. The check
  stage's per-segment re-request uses the same `plan()` path.
- **The local model presets (M4)** should start at `reasoning_effort: low` (or the model's equivalent) and get the
  reserve quirk.
- **Latency on Ollama cloud.** About 15 s to first content at low effort, and 54 s at medium. That is slow for the
  "first segment within ~2 s" goal (ROADMAP M1). It's a cloud queueing and model matter, outside S2, but worth knowing
  before choosing a demo model.

## Limits of this spike

- **One model, gpt-oss:20b, via Ollama cloud.** Haiku 4.5 was not tested (user decision 2026-10-05), and no local model
  ran. Compliance this good may not carry over to smaller local models, which the ROADMAP risk list expects to be worse
  below ~7B.
- Three target languages (vi, de, ja), one source language (English), and one style mode. Thai and other scripts with
  higher token costs were not measured.
- Two repetitions for Vietnamese raw, one for the other arms. Rates below about 1% (for example the single "last
  `</seg>` missing" in a language) are not stable.
- The source token count is the chars ÷ 4 estimate, not a tokenizer count. Ollama reports reasoning and content tokens
  as one number, so content-only ratios in `results.md` are estimated from the share of characters.
- The brief was only the title. With a full brief the system prompt is longer. That doesn't change the format results,
  but it may change reasoning length.
- Temperature 0.2 throughout. Higher temperatures were not tried.
- The adversarial chunks are synthetic and hand-written. Real pages rarely contain literal `<seg` text, but code
  tutorials about markup can.
- `runs/` contains machine translations of the fixture text. They are derived from the fixtures, under the fixtures'
  licenses (see `fixtures/sites/ATTRIBUTION.md` and `spikes/s2/runs/README.md`).

## Proposed spec changes

1. **DESIGN §5.7 Step 3**, after "If that happens, retry just that segment.", add: "The parser grammar and repair policy
   are fixed by S2 (`docs/decisions/S2-seg-parser-grammar.md`): a close tag closes only when followed by an open tag or
   the end of output, and an open tag inside a segment is text. Re-request missing, cut-and-later, empty and
   suspect-merged segments in one follow-up call; re-request the whole chunk if ids are duplicated or unknown. Source
   `<`/`>` are sent unescaped."
2. **DESIGN §5.7 Model settings**:
   - old: "`max_tokens` around 2.5× the chunk's source tokens. Some target languages (Vietnamese, Thai, Japanese, and
     others) need more tokens than English for the same content."
   - new: "`max_tokens` = 2.0 × estimated source tokens + 12 × segments + the model's reasoning reserve (0 for
     non-reasoning models; 256 for a reasoning model at low effort). S2 measured vi/de/ja with no per-language
     multiplier needed; a fixed 2.5× cut 13% of chunks because small chunks carry fixed overhead."
3. **DESIGN §5.7 Model settings**:
   - old: "Use low/no thinking."
   - new: "Use the lowest thinking setting the model accepts (gpt-oss cannot turn it off; `reasoning_effort: low`).
     Reasoning tokens count against `max_tokens`; adapters never emit reasoning as text."
4. **DESIGN §4.2.4 `Quirks`**: add `reasoningReserve?: number; // output tokens to add to maxOutputTokens for
   reasoning models (S2)` and `reasoningEffort?: "low" | "medium" | "high";`.
5. **ROADMAP §2 S2 row, Output column**: append "Decided in S2: v2 close-by-lookahead grammar, one-round repair, no
   escaping, budget formula instead of a per-language multiplier."
