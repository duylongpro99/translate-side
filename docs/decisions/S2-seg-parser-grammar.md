# S2 — `<seg>` parse robustness → parser grammar and repair policy

Status: **user decisions 2026-10-05 recorded** (deviation (f): option C; spec changes 1–5 approved, applied in the final Phase B step); review rounds 1–2 addressed · Date: 2026-10-05 · Spike code: `spikes/s2/`

Model = gpt-oss:20b (Ollama cloud). The user picked it on 2026-10-05 (decision D5) after `qwen3.5:9b`, the plan's
model, returned 404 on the cloud (S4 §2).

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
  four distinct chunks. These chunks are **smaller than DESIGN §5.7 Step 2's 800–1,500 source tokens**. Review round
  1 added a DESIGN-size set, so the record covers both sizes:
- **DESIGN-size chunks** (`segment.mjs --large` → `chunks-large.json`): **10 chunks, one per fixture, 877–1,490
  estimated tokens** (median 1,098; the segmenter's estimate, the sum of ⌈chars ÷ 4⌉ per segment. As total
  `srcChars` ÷ 4, which the formula budget in `run.mjs` uses, they are 864–1,477), **383 segments** (19–69 per chunk), no segment cap. Same segmenter and cleanup.
  The budget rotates over 900/1,100/1,300/1,500 by fixture, so the sizes cover the range. Six real segments contain `<` or `>`, all inside code spans (`Vec<T>`, `<!-- … -->`).
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
| large-vi, large-ja | Vietnamese, Japanese | as is | low | **the proposed formula** (§6) | 10 DESIGN-size |

In total: **12 arms, 452 first-pass calls, 5,342 segments**, plus **58 repair calls** (below). The two large arms were
added in review round 1, as a holdout for the budget formula. Estimated source tokens
are source chars ÷ 4, the cheap estimate an engine without a tokenizer would use.

### Parser and checks

- `parser.mjs` is the grammar draft: `SegParser` (streaming), `plan()` (the repair plan), and `esc`/`unesc`.
- `corpus.test.mjs` is the malformed-output corpus: **32 cases, each fed in 200 random delta splits** so that tag
  boundaries land mid-delta. All pass, and every result is the same under every split. (The first commit had 22; review
  round 1 added the 10 cases listed under "Literal tags in the source" and Grammar rules 4, 5 and 7.) The cases cover:
  - quoting and case drift, a missing segment, a merged pair, a missing close, fences and preambles;
  - reordered, duplicate and unknown ids;
  - a `max_tokens` cut inside a segment and inside a tag, an end without a close;
  - an orphan close, an empty segment, prose only;
  - the literal-tag cases seen in the runs, under both v1 and v2, and the cases v2 does not make safe;
  - opens with a bad id, `<segment>`, text between segments, a cut inside a closing tag, and empty segments.
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
  followed by a partial open tag is a real close. The partial tag goes to stray, and the rest is missing. Three of the
  cuts in this column (2 in cut-1.0, 1 in cut-2.0, all in MDN chunks) ended inside the segment's **own** closing tag
  instead. That segment is still open, so it is reported as `cut`. The draft parser put the partial tag (`</se`, `</`)
  into the cut text. Since review round 1, a partial tag at the end of the stream goes to stray (Grammar rule 5). The
  re-request sets are unchanged.
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
- **It can't be switched off** (`effort-probe.mjs` → `results/effort-probe.json`: one real chunk, goblog-pipelines#1,
  10 segments, one call per setting, `max_tokens` 4096). Unlike the arms, the probe uses a **short prompt** (only the
  format rules of `translate@1`) and **non-streaming** calls:

  | Setting sent | Reasoning chars | Completion tokens | Result |
  |---|---|---|---|
  | none (no field) | 4,212 | 1,617 | strict |
  | `reasoning_effort: "none"` | 4,355 | 1,653 | strict |
  | `"minimal"` | 19 | 601 | strict |
  | `"low"` | 19 | 596 | strict |
  | `"medium"` | 4,150 | 1,608 | strict |
  | `"high"` | 15,286 | 4,096 | **cut before any content**, 10/10 missing |
  | `think: false` | 4,187 | 1,616 | strict |
  | `think: false` + `"low"` | 19 | 603 | strict |

  - `"none"` and `think: false` are accepted without an error, but they behave like the default, which is about
    medium. Only `"low"` and `"minimal"` actually lower reasoning, and they gave the same result.
  - `reasoning_effort: "low"` stays the setting to use. It is the documented gpt-oss level; `"minimal"` is not.
  - These are single calls (n = 1 per setting). The first commit quoted numbers from an earlier, uncommitted run of
    the same kind (`"none"` 616 chars, `"minimal"` 62, `"high"` 1,243, `think: false` 211). That run is replaced by
    this committed one. The conclusion is the same, but `"none"` and `think: false` now look clearly like the default.

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

At medium effort, the same formula with a 256 reserve would cut 51/54 chunks, and with 2,048 it would cut 4/54. With
4,096 it covers 53/54. The 54th, twir-671#1, hit `finish_reason: length` at exactly 4,096 completion tokens with no
content (§5). Its real need is above 4,096 and unknown, so no reserve is shown to be safe for medium effort.

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

### 8. DESIGN-size chunks (800–1,500 tokens): the spec size works (holdout)

Arms large-vi and large-ja, low effort, `max_tokens` set by the proposed formula (§6). Re-parsed with v2:

| Arm | Strict parse | Fix used | Segments missing | Cut | Re-request | Marker issues | Flat 2.5× would cut | Formula: used ÷ budget, med / max | Smallest headroom |
|---|---|---|---|---|---|---|---|---|---|
| large-vi | 9/10 | 1 × last `</seg>` missing | 0/383 | 0 | 0 | 4 (1.0%) | 0/10 | 0.55 / 0.61 | 1,087 tokens |
| large-ja | 8/10 | 2 × last `</seg>` missing | 0/383 | 0 | 0 | 22 (5.7%) | 0/10 | 0.59 / 0.67 | 892 tokens |

- **Format compliance is the same as on small chunks.** The only slip was the missing final `</seg>`. Chunks of up
  to 69 segments lost nothing, and nothing was re-requested.
- **The formula held on the holdout**: 0 of 20 cut, with 892 or more tokens of headroom. On large chunks, though, the
  flat 2.5× also cuts nothing: completion ÷ source tokens is at most 1.96 (vi) and 2.18 (ja). The formula's advantage
  is on small chunks, where the fixed overhead (tags, the reasoning preamble) dominates. A chunker that never makes
  small chunks could keep 2.5×, but every page's last chunk and short pages are small, so the formula is still the
  safer rule.
- **Latency.** The time to the first token of any kind ranged from 1 to 79 s (median about 65 s). Reasoning and
  content started at the same moment, and the first requests in each arm got their first token in 1–2 s. So most of
  the wait is queueing on the shared cloud account (4 large requests at once), not chunk size. These runs can't
  separate the two.
- Marker issues in Japanese (5.7%) match §7 (4.8%).

## Decision

### Grammar: option C — v1 by default, v2 (with the nonce) on chunks with literal tags (user decision 2026-10-05)

Before sending, the engine checks each chunk's source for literal tag-shaped text (the `literalTags` regex in
`parser.mjs`).

- **No hit** (every real chunk in S2; only the synthetic adv#0 has a hit): parse with **v1**. Every CLOSE closes, and an OPEN inside an open
  segment closes it implicitly (fix: `implicit-close`).
- **A hit:** parse with **v2**, below, and add the per-chunk nonce ("Literal tags in the source"). The nonce is untested,
  so M1-E3 settles its exact form.

The two share everything else: the token shapes, the bad-id rule, partial tags to stray, the end-of-stream rules, the
id rules, the literal-tag mismatch check and the repair plan. The rules below are written for v2. For v1, rule 2 is
"every CLOSE closes" and rule 3 is "an OPEN closes the open segment".

`parser.mjs` implements both (`grammar: 'v1' | 'v2'`). Its default is `'v2'`, which is how the spike measured them. The
M1 port switches per chunk.

#### v2, "close-by-lookahead"

```
output   := (seg | STRAY)*
seg      := OPEN text CLOSE
OPEN     := '<seg id="' DIGITS '">'                                         strict
          | '<' WS? 'seg' (WS attrs)? '>' with id="N" | id='N' | id=N, any case   lenient (fix: open-form)
          | '<' WS? 'seg' (WS attrs)? '>' with no id, or an id that is not DIGITS  bad id (fix: bad-id)
CLOSE    := '</seg>' | '<' WS? '/' WS? 'seg' WS? '>'                        (non-strict form: fix: close-form)
text     := any characters; inside an open segment, an OPEN of any kind, and a CLOSE that fails the lookahead, are text
STRAY    := any characters outside a segment (fences, preambles, notes, partial tags at the end)
WS       := [ \t\r\n]*
DIGITS   := [0-9]+
```

**Segment text is kept as is.** The parser doesn't trim it: `<seg id="1"> A </seg>` gives `" A "`, and whitespace
between segments is stray. Only `plan()`'s empty check trims (a whitespace-only segment is empty). The source
segments are trimmed (`segment.mjs`), so the M1 port should trim each segment's text at `segment.final`, and keep the
partial text untrimmed while it streams.

Every rule, in the order the parser applies it:

1. **Tokens.** Only the `OPEN` and `CLOSE` shapes above are tags. Every other `<` is text: `<segment>`, `<seg-x>`,
   `Vec<T>`, `a < b`. While a `<` could still become a tag (`<`, `<s`, `</se`, `<seg id="1`, at most 40 chars, no
   `>` yet), the parser holds it back and waits for more input.
2. **Lookahead on CLOSE.** Inside an open segment, a CLOSE counts as a close only if what follows it, after
   whitespace, is:
   - an OPEN of **any** kind: strict, lenient, an unknown id, a duplicate id, or a bad id;
   - another CLOSE;
   - the end of output;
   - at the end of output only, a partial tag (a `max_tokens` cut inside the next tag).

   Otherwise the CLOSE is text (fix: `close-in-text`). Unknown, duplicate and bad ids count as a close on purpose:
   they are flagged later (rule 6) and make the chunk ambiguous. A whole-chunk re-request is safer than merging them
   into the open segment as text, which nothing would flag.
3. **OPEN inside an open segment** is text (fix: `open-in-text`). It never closes the segment implicitly.
4. **Stray text.** Text outside a segment goes to stray, wherever it is: before the first segment (preambles,
   fences), between segments, or after the last one. It is never content, and it is flagged once per output
   (fix: `stray`). **Text between segments has a cost under v2:** in `</seg> (note) <seg id="2">`, the close fails
   the lookahead, so it is read as text. Segments 1 and 2 merge, and both are re-requested (corpus case "text between
   segments"). v1 would just drop the note. This was never seen in the runs.
5. **End of stream.**
   - A partial tag left in the buffer (`</se`, `<seg id`) goes to stray. It never becomes segment text, also when
     the stream was cut inside the closing tag. Three cut chunks in the cut arms leaked `</se` or `</` into the cut
     text before this fix (§4).
   - Inside a segment with `stopReason: max_tokens`, the segment is `cut` (its id plus the partial text). M1
     addendum (M1-D9): every stop reason other than `end` (`max_tokens`, `refusal`, `other`) counts as a cut.
   - Inside a segment with `end`, the segment is accepted (fix: `unclosed-end`). This is the one fix gpt-oss
     actually needed.
   - With `end`, if the segment saw a `close-in-text` and no later close, it ends at that last close instead. The
     rest is stray, and the `close-in-text` fix is withdrawn, because the close was real. This happens, for example,
     after a final `</seg>` followed by a code fence or a model note. With a cut, the segment stays `cut` and is
     re-requested (as in the spike; corrected in M1-D9, this line used to say "in both cases").
6. **Ids.** On a segment's close:
   - a bad id: the segment's text is dropped (fix `bad-id`, raised at the open);
   - an id not in the chunk: dropped (fix `unknown`);
   - a duplicate: the first one wins (fix `dup`);
   - out of order: accepted (fix `reorder`).
7. **`strict`** means no fixes, nothing missing, and no cut. It describes the tags only. An empty or whitespace-only
   segment can still be `strict: true`; `plan()` re-requests it anyway (Repair policy).

**Events and timing** (compared with DESIGN §5.7 Step 3, "emits each segment as soon as its `</seg>` arrives"):

- `segment.partial` is emitted as text arrives, except for the held-back `<…` prefix (at most 40 chars).
- **v1 chunks (option C's default)** finalize at the `</seg>`, as DESIGN §5.7 Step 3 already says. The rest of this
  bullet applies to **v2 chunks only** (chunks whose source holds literal tags).
- On a v2 chunk, `segment.final` is emitted **when the lookahead decides**, not on the `</seg>` itself. That is at the next
  non-whitespace character, which is normally the next segment's `<seg id=…>`, a token or two later. For the **last
  segment**, `final` waits for the end of the stream. For a segment with a `close-in-text`, it waits for the next close
  that passes the lookahead, or for the end. The M1 port should state this in the DESIGN Step 3 sentence (spec change 1).
- **Replacements.** Two cases replace text the panel has already seen:
  - rule 5's "ends at the last close" removes partial text that was already streamed;
  - a whole-chunk re-request replaces segments that were already final.

  Neither may reuse `segment.final.revision` (DESIGN §5.2, DESIGN.md:496 and :505). Revisions mean "a better version
  from a later stage" (the refine pass is `revision: 2`), so a repair numbered `revision + 1` would collide with it.
  **Proposed:** add an `attempt` counter to `segment.final`. A repair re-emits the **same** revision with
  `attempt + 1`, and the panel replaces the text of that revision. (A `replace: true` flag is the smaller alternative,
  but it can't order two repairs.) M1-E3 decides, and spec change 1 carries the open point.

### Repair policy (`plan()`)

- Re-request, in **one follow-up call per chunk**, exactly these segments:
  - the missing ones;
  - the `cut` one plus every one after it (all of them missing);
  - empty ones;
  - suspect-merged ones: a neighbour is missing and either the ratio is over 1.6× the chunk's median, or an OPEN was
    swallowed as text.
  - **literal-tag mismatch**: the number of literal tag-shaped strings (`<seg …>`, `</seg>`) in the segment's output
    differs from its source. The engine knows the source, so this costs one regex per segment. It catches a segment
    that was cut or extended at a literal tag (case L-end in "Literal tags in the source" below).
- If the structure is ambiguous (any dup, orphan close, unknown id or bad id), **re-request the whole chunk**.
- Keep everything else.
- A segment still failing after one repair round becomes `segment.failed` (M2's "re-request once, then mark failed").
- `stopReason: max_tokens` is the "re-request open segment" case from the plan default. The partial text stays visible
  until the repair result replaces it.

### No escaping of the source

Send `<`, `>` and `&` as they are. Escaping was neither reliable (§3) nor neutral (more HTML drift).

### Literal tags in the source: detected, not made safe

v2 parses the literal-tag text seen in the runs (adv#0, 8 of 8). It does **not** make every literal tag safe. These
cases, from review round 1, are in the corpus:

| Case | Source segment holds | What v2 does | Caught by |
|---|---|---|---|
| L-adjacent | `X </seg><seg id="2"> Y` | closes segment 1 at the literal close; the literal open starts a second `id 2`, so the real one is a dup | `dup` → whole chunk |
| L-tail | text that **ends** with a literal `</seg>` | the literal close passes the lookahead (a CLOSE follows), so the real close becomes an orphan | `orphan-close` → whole chunk |
| L-end | a literal `</seg>` in the **last** segment, and the model drops the final `</seg>` (its one common slip) | rule 5 ends the segment at the literal close; the rest goes to stray | literal-tag mismatch → that segment |
| bad id | (model output) `</seg><seg id="x">garbage` | close, then an open with a bad id; the text is dropped | `bad-id` → whole chunk |

Without the literal-tag mismatch check, L-end would be **silent**: the segment would be truncated, and only a `stray`
fix would remain, which `plan()` does not re-request. Every case is now flagged. But a re-request of the same
segments meets the same literal text, so these chunks can end in `segment.failed` after the one repair round.

**Recommendation for M1-E3 (not tested here):**

- Detect literal tags **before sending**, with the same regex as the mismatch check, on each segment's source.
- For a chunk with a hit, use one of these:
  - **A per-chunk nonce attribute.** For example, `<seg id="3" n="k7q">` in the input. The prompt says to echo it,
    and the parser accepts as tags only OPEN tags that carry the nonce, and CLOSE tags that follow them. Literal tags
    in the text don't carry the nonce, so they stay text.
  - **Isolation.** Send each segment with a hit as a chunk of its own, so a mis-parse costs one segment.
- **User decision 2026-10-05 (option C): the nonce**, together with v2. Isolation stays the fallback if M1-E3's corpus
  and replay check shows that models don't copy the nonce reliably.

### Output budget

`maxOutputTokens = 2.0 × estTokens(source) + 12 × segments + reasoningReserve`, where `estTokens` is chars ÷ 4 and
`reasoningReserve` is 0 for models without reasoning and 256 for gpt-oss at `low` effort. Medium effort has no safe
value on this evidence (§6), so presets should not use it for translation. The reserve is a per-model or per-preset
setting (spec change 4). No per-language multiplier for now.

**The formula is provisional.** It was fitted on the same 270 calls it is scored on. Its smallest headroom there is
45 tokens (`vi-esc/adv#2`, 382 used of 427), then 106 and 140 (`budget-fit.mjs`). So "0/270" is tight, and a
different model, prompt or brief can break it. On the DESIGN-size holdout (§8), it cut 0 of 20, with 892 or more
tokens to spare. Re-check it on M1's replay set and on every new preset.

### Reasoning models

Use the lowest effort that works (`reasoning_effort: "low"` for gpt-oss). Treat `delta.reasoning` / `thinking` as
non-content: count it in usage, never emit it as `text`. A chunk that ends with no content at all and
`finish_reason: length` is a `cut` before segment 1. Re-request it with the full reserve once, then fail it.

## Deviation from plan default

Plan default: "Strict `<seg id="N">` with lenient fallback; retry only missing segments; treat `max_tokens` cut as
"re-request open segment"."

- **(f) How the lenient fallback treats literal tags.** **User decision 2026-10-05: option C.**

  | Option | Grammar | For | Against |
  |---|---|---|---|
  | A, the plan default | v1 everywhere | one code path; recovers silently from a dropped mid-chunk close or a note between segments | a literal `<seg`/`</seg>` in the source mis-parses silently: wrong text under a real id in 6 of 8 adv#0 runs, caught only because a duplicate happened to follow (§2) |
  | B | v2 everywhere | parses the seen literal-tag text (8 of 8) | the cost lands on weak models: a dropped mid-chunk close or a note between segments costs a re-request of both segments (rules 3, 4) |
  | **C, chosen** | v1, plus v2 and the nonce only on chunks whose source has literal tags (detected before sending) | v2's cost falls only on the rare chunks that need it; the **smallest departure** from the plan default | two code paths to test; a literal tag the regex misses (one the model invents) gets v1's silent mis-parse |

  Evidence: §2 and the corpus. On gpt-oss:20b the choice made no difference on real text: v1 and v2 gave identical
  results on all 392 small-chunk and 20 DESIGN-size outputs. Neither failure that v2 would cost (a dropped mid-chunk
  close, text between segments) occurred in 3,246 real segments. If the nonce proves reliable in M1-E3, v2 may not be
  needed on the literal-tag chunks at all.
- **The rest of the default holds and is made exact:**
  - "retry only missing segments" becomes the re-request set above, which adds cut, empty and suspect-merged segments;
  - an ambiguous structure re-requests the whole chunk;
  - "re-request open segment" becomes "the open segment and all segments after it". One follow-up call brought loss to
    0 in every cut case (§4).
- **No deviation on chunk size.** The first commit's Consequences said "keep chunks around 300–450 estimated
  tokens", which would have changed DESIGN §5.7 Step 2 without evidence. That line is withdrawn. §8 shows the spec's
  800–1,500 works on this model, so no deviation (g) is needed.
- **Not a plan deviation, but a DESIGN change:** the output budget formula (§6) replaces DESIGN §5.7's "about 2.5×
  source tokens". The flat 2.5× would cut about 13% of chunks on this model, and the formula cuts none. See Proposed
  spec changes.

## Consequences

- **M1-E3** (`<seg>` streaming parser plus repair) ports `parser.mjs` v2 and `plan()` into `engine/parsing/`.
  - The corpus in `corpus.test.mjs` becomes its golden tests, including the 200-split determinism check. M1's "parser
    fuzz tests pass" exit criterion can build on that harness.
  - The seen outputs in `spikes/s2/runs/*.jsonl` are a ready replay set.
  - Add the literal-tag pre-send check, and the nonce or isolation option (see "Literal tags in the source"). If
    deviation (f)'s recommended option is chosen, add the per-chunk grammar switch.
  - **Before freezing any threshold** (merge factor 1.6, the 40-char tag hold-back, the budget formula), replay the
    corpus and the fixture chunks on Haiku 4.5 in the M1 harness. S2 measured one model, and Haiku was dropped from
    this spike by user decision.
- **M1-E6** (adapters):
  - `openai-chat`: map `delta.reasoning` / `reasoning_content` to usage only, never to `text` events. Send the
    reasoning control when the preset says so. Add the `reasoning` quirk (spec change 4).
  - `anthropic`: drop `thinking` and `redacted_thinking` content blocks, and their deltas, in the same way. Only
    `text` blocks become `text` events.
- **M1 chunker:** keep DESIGN's 800–1,500 source tokens; S2 confirms it (§8). Set the budget by the formula. Small
  chunks (a page's last chunk, short pages) pay the fixed overhead of tags and the reasoning preamble, which is where
  a flat multiplier fails (§6). Whether a smaller **first** chunk helps the "first segment within ~2 s" goal is a
  latency question for M1. §8 could not separate queueing from size.
- **M1 exit criterion** "Segment loss after repair is 0 on the fixtures": met on this model, with one repair round, in
  every arm measured.
- **M2-E4** (`check` stage): marker loss is the real quality risk (4.8% of Japanese segments), not parsing. The check
  stage's per-segment re-request uses the same `plan()` path.
- **M2 context tail** (DESIGN §5.7 Step 2). The tail is the last 1–2 source paragraphs of the previous chunk, plus their
  translations.
  - It must **not** use `<seg>` markers. Send it as a separate block before the segments, as plain paragraphs: for
    example `<context>` … `</context>`, or a "Context — do not translate:" heading.
  - If the model still echoes a tail paragraph as a `<seg>`, its id is not in the chunk, so it is dropped as
    `unknown`. That makes the chunk ambiguous and triggers a whole-chunk re-request.
  - So an echoed tail costs a full re-request. M2 should measure how often that happens. If it is common, change
    `unknown` from "ambiguous" to "drop and continue", but only for ids outside the chunk's range.
  - Neither the tail nor this case was tested in S2. S2's prompts had no tail.
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
- The budget formula was fitted in-sample. The holdout (§8) is 20 chunks of one size class, on the same model.
- **A model that entity-escapes a literal tag** that the source holds (writes `&lt;seg…` for `<seg…`) would trip
  the literal-tag mismatch check on a correct-looking segment. The repair would likely repeat it, so the segment would
  end as `segment.failed`. This was not seen in the runs (no raw arm escaped). M1-E3 could count entity forms as
  matches.
- The nonce and isolation options for literal tags, the per-chunk grammar switch, and the context-tail format are
  recommendations. None was run against the model.
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

**Applied in a1d8969** (user decision 2026-10-05, option C). The "Also consider" items under change 4 are not applied; they stay suggestions for M1.

1. **DESIGN §5.7 Step 3**, after "If that happens, retry just that segment.", add: "The parser grammar and repair policy
   are fixed by S2 (`docs/decisions/S2-seg-parser-grammar.md`). Tags are parsed leniently (quoting and case drift
   accepted), and every close tag closes. Chunks whose source holds literal `<seg`/`</seg>` text are detected before
   sending. They get a per-chunk nonce attribute (isolation if M1-E3 shows models don't copy it), and the
   close-by-lookahead grammar: a close tag closes only when
   followed by an open tag or the end of output, an open tag inside a segment is text, and a segment is final when
   that lookahead decides. A repaired segment replaces the shown text
   in place (same revision, a new attempt; M1-E3 decides between an `attempt` counter and a `replace` flag, because
   `revision` is taken by refine). Re-request missing, cut-and-later, empty, suspect-merged and literal-tag-mismatch segments in one
   follow-up call; re-request the whole chunk if ids are duplicated, unknown or malformed. Source `<`/`>` are sent
   unescaped."
2. **DESIGN §5.7 Model settings**:
   - old: "`max_tokens` around 2.5× the chunk's source tokens. Some target languages (Vietnamese, Thai, Japanese, and
     others) need more tokens than English for the same content."
   - new: "`max_tokens` = 2.0 × estimated source tokens + 12 × segments + `reasoning.reserveTokens` (0 for models
     without reasoning). Provisional: fitted on one model (S2), re-checked per preset. S2 measured vi/de/ja with no
     per-language multiplier needed; a fixed 2.5× cut 13% of chunks because small chunks carry fixed overhead."
3. **DESIGN §5.7 Model settings**:
   - old: "Use low/no thinking."
   - new: "Use the lowest reasoning setting the model accepts (`reasoning.lowest`); some models cannot turn it off.
     Reasoning tokens count against `max_tokens`. Adapters never emit reasoning as text."
4. **DESIGN §4.2.4 `Quirks`**: add a provider-neutral reasoning block.
   ```ts
   reasoning?: {
     control: "effort" | "budget" | "none";  // how the model's reasoning is set: an effort level
                                             // (OpenAI-style reasoning_effort), a token budget
                                             // (Anthropic-style thinking.budget_tokens), or not at all
     lowest: string | number | "off";        // the value to send, e.g. "low", or a budget in tokens;
                                             // "off" where the model can switch thinking off
     reserveTokens: number;                  // added to maxOutputTokens; 0 when lowest is "off"
   };
   ```
   The gpt-oss preset is `{ control: "effort", lowest: "low", reserveTokens: 256 }` (S2). For a model whose thinking
   can be switched off, the lowest setting is `"off"` and the reserve is 0. Values for other presets come
   from their own measurements.

   Also consider, for **DESIGN §4.2.1 `NormalizedEvent`**, two optional additions:
   - `usage.reasoning?: number`, where the provider reports it separately (Ollama does not; S2 §5);
   - a `{ type: "progress" }` event, sent while the model reasons and no text has arrived. At medium effort that lasted
     54 s at the median (§5), so the panel needs some sign of life during it.
5. **ROADMAP §2 S2 row, Output column**: append "Decided in S2: lenient v1 grammar, plus the close-by-lookahead
   grammar and a nonce for chunks with literal tags (option C); one-round repair; no escaping; budget formula instead
   of a per-language multiplier."

## M1 addendum (decisions M1-D8, M1-D9, M1-D10)

Found by the M1-E12 fuzz tests; the engine port (`src/engine/parsing/`) implements them.

- **M1-D8 (a).** A segment left unclosed at `end` whose text is followed by a held-back partial tag (`… Vec<se`) is
  re-requested as truncated: the partial tag may have been its own text. Rule 5 still sends the partial tag to stray.
- **M1-D8 (b).** On a nonce chunk where the model copied the nonce, an OPEN carrying the nonce that was read as text
  inside a segment, whose id also arrives as its own segment, makes the structure ambiguous: the whole chunk is
  re-requested.
- **M1-D9.** Rule 5: every stop reason other than `end` counts as a cut, and a cut segment with a `close-in-text`
  stays `cut` (see rule 5 above).
- **M1-D10.** The same as M1-D8 (b) on a v2 chunk where the nonce was not copied: an OPEN read as text inside segment
  i, whose id also arrives as its own segment, makes the chunk ambiguous when segment i holds more tag-shaped strings
  than its source. A source that holds the tag as text has equal counts and is kept.
