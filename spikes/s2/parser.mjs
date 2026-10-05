// Draft <seg> streaming parser for S2. The full grammar, with every rule, is in docs/decisions/S2-seg-parser-grammar.md
// ("Grammar"). Summary:
//   Tokens: OPEN strict '<seg id="N">'; OPEN lenient '<' WS? 'seg' (WS attrs)? '>' with id="N" | id='N' | id=N, any
//   case (fix: open-form); a tag-shaped OPEN without a digit id (fix: bad-id). CLOSE '</seg>' or
//   '<' WS? '/' WS? 'seg' WS? '>' (fix: close-form). Every other '<' is text.
//   v2 (default) = close-by-lookahead: inside an open segment, a CLOSE closes only if what follows (after whitespace) is
//   an OPEN of any kind, another CLOSE, the end of output, or at the very end a partial tag; otherwise it is text
//   (fix: close-in-text). An OPEN inside an open segment is text (fix: open-in-text).
//   v1 = plain lenient: every CLOSE closes, an OPEN inside a segment closes it (fix: implicit-close).
//   Both: text outside segments is stray (fix: stray); a partial tag left at the end of the stream is stray, never
//   segment text; dup id: first wins (fix: dup); unknown id dropped (fix: unknown); out of order accepted
//   (fix: reorder); end inside a segment: "cut" if stopReason is max_tokens, else accepted (fix: unclosed-end), except
//   that a v2 segment with a close-in-text and no later close ends at that close and the rest is stray (the
//   close-in-text fix is then withdrawn: the close was real, as after a final "</seg>" followed by a code fence).
//   `strict` = no fixes, nothing missing, no cut. It is a statement about the tags only: an empty segment can be strict.
// Repair plan (plan()): re-request missing, cut-and-later, empty, suspect-merged, truncated and literal-tag-mismatch
// ids; the whole chunk when the structure is ambiguous (dup, orphan-close, unknown, bad-id).
export const OPEN_STRICT = /^<seg id="(\d+)">/;
const OPEN_LENIENT = /^<\s*seg(\s[^<>]*)?>/i; // tag-shaped open; the id is checked separately ("<segment>" is text)
const CLOSE_STRICT = '</seg>';
const CLOSE_LENIENT = /^<\s*\/\s*seg\s*>/i;
const ID_ATTR = /\bid\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))/i;
const MAX_TAG = 40; // longest lenient tag we wait for before treating '<' as text
const PARTIAL = /^<\s*\/?\s*(s|se|seg(\s[^<>]*)?)?$/i; // could still become a tag
const idOf = (attrs) => { const m = ID_ATTR.exec(attrs ?? ''); return m ? +m.slice(1).find(Boolean) : null; };
// Literal tag-shaped text, counted per segment in source and output (plan(): a mismatch means the tags were misread).
export const literalTags = (s) => (s.match(/<\s*\/?\s*seg(\s[^<>]*)?>/gi) ?? []).length;

export class SegParser {
  constructor(expectedIds, { onPartial, onFinal, grammar = 'v2' } = {}) {
    this.v2 = grammar === 'v2';
    this.expected = new Set(expectedIds);
    this.order = [...expectedIds];
    this.buf = '';
    this.open = null; // { id, text }
    this.done = new Map(); // id -> text
    this.fixes = []; // { kind, id?, detail? }
    this.stray = '';
    this.lastId = 0;
    this.onPartial = onPartial ?? (() => {});
    this.onFinal = onFinal ?? (() => {});
  }
  fix(kind, extra = {}) { this.fixes.push({ kind, ...extra }); }
  push(delta) { this.buf += delta; this.#drain(false); }
  end(stopReason) {
    this.#drain(true);
    if (this.open) {
      const { id, text, lastClose: lc } = this.open; this.open = null;
      if (stopReason === 'max_tokens') { this.cut = { id, text }; this.fix('cut', { id }); }
      // v2: a close tag that was followed by text, with no later close: it was the real close and the rest is stray
      else if (lc) { this.stray += text.slice(lc.at + lc.len); this.fixes = this.fixes.filter((f) => f !== lc.fix); this.#final(id, text.slice(0, lc.at)); }
      else { this.fix('unclosed-end', { id }); this.#final(id, text); }
    }
    if (this.stray.trim()) this.fix('stray', { detail: this.stray.trim().slice(0, 80) });
    return this.result(stopReason);
  }
  #final(id, text) {
    if (id === null) return; // bad-id segment: already flagged, its text is dropped
    if (!this.expected.has(id)) { this.fix('unknown', { id }); return; }
    if (this.done.has(id)) { this.fix('dup', { id }); return; }
    if (id < this.lastId) this.fix('reorder', { id });
    this.lastId = Math.max(this.lastId, id);
    this.done.set(id, text);
    this.onFinal(id, text);
  }
  #text(s) {
    if (!s) return;
    if (this.open) { this.open.text += s; this.onPartial(this.open.id, s); } else this.stray += s;
  }
  #drain(final) {
    for (;;) {
      const i = this.buf.indexOf('<');
      if (i < 0) { this.#text(this.buf); this.buf = ''; return; }
      this.#text(this.buf.slice(0, i)); this.buf = this.buf.slice(i);
      const b = this.buf;
      // strict forms first
      let m;
      const close = b.startsWith(CLOSE_STRICT) ? [CLOSE_STRICT, true] : (m = CLOSE_LENIENT.exec(b)) ? [m[0], false] : null;
      if (close) {
        const [tag, strict] = close;
        if (this.v2 && this.open) {
          const v = this.#closeVerdict(b.slice(tag.length), final);
          if (v === 'wait') return;
          if (v === 'text') { // v2: "</seg>" followed by more text is content (or the real close, decided at the end)
            const f = { kind: 'close-in-text', id: this.open.id }; this.fixes.push(f);
            this.open.lastClose = { at: this.open.text.length, len: tag.length, fix: f };
            this.#text(tag); this.buf = b.slice(tag.length); continue;
          }
        }
        if (!strict) this.fix('close-form', { detail: tag });
        this.#close(); this.buf = b.slice(tag.length); continue;
      }
      const open = (m = OPEN_STRICT.exec(b)) ? [m[0], +m[1], true] : (m = OPEN_LENIENT.exec(b)) ? [m[0], idOf(m[1]), false] : null;
      if (open) {
        const [tag, id, strict] = open;
        // v2: an open tag inside an open segment is content; a missing close then shows up as missing + merged.
        if (this.v2 && this.open) { this.fix('open-in-text', { id: this.open.id }); this.#text(tag); this.buf = b.slice(tag.length); continue; }
        if (id === null) this.fix('bad-id', { detail: tag }); else if (!strict) this.fix('open-form', { detail: tag });
        this.#open(id); this.buf = b.slice(tag.length); continue;
      }
      // could still become a tag: wait for more input
      if (b.length < MAX_TAG && !b.includes('>') && PARTIAL.test(b)) {
        if (!final) return;
        this.stray += b; this.buf = ''; return; // a tag cut by the end of the stream (e.g. "</se"): never segment text
      }
      // literal '<'
      this.#text('<'); this.buf = b.slice(1);
    }
  }
  // v2 close rule: a close tag closes only when what follows (after whitespace) is an open tag or the end of output.
  #closeVerdict(rest, final) {
    const r = rest.replace(/^\s+/, '');
    if (!r) return final ? 'close' : 'wait';
    if (r[0] !== '<') return 'text';
    // Any tag-shaped OPEN counts, also with an unknown, duplicate or bad id: those are flagged later and make the chunk
    // ambiguous (whole-chunk re-request), which is safer than merging them into this segment as text.
    if (OPEN_STRICT.test(r) || OPEN_LENIENT.test(r)) return 'close';
    if (r.startsWith(CLOSE_STRICT) || CLOSE_LENIENT.test(r)) return 'close'; // "</seg></seg>": first closes, second is orphan
    const prefix = r.length < MAX_TAG && !r.includes('>') && PARTIAL.test(r);
    if (prefix) return final ? 'close' : 'wait'; // at the end (e.g. a max_tokens cut inside the next tag) it was a real close
    return 'text';
  }
  #open(id) {
    if (this.open) { this.fix('implicit-close', { id: this.open.id }); this.#final(this.open.id, this.open.text); }
    this.open = { id, text: '' };
  }
  #close() {
    if (!this.open) { this.fix('orphan-close'); return; }
    const { id, text } = this.open; this.open = null; this.#final(id, text);
  }
  result(stopReason) {
    const missing = this.order.filter((id) => !this.done.has(id) && this.cut?.id !== id);
    const strict = this.fixes.length === 0 && missing.length === 0 && !this.cut;
    return { strict, segs: Object.fromEntries(this.done), missing, cut: this.cut ?? null, fixes: this.fixes, stopReason };
  }
}

// One-shot helper: feed a whole output in random-size deltas (exercises tag splitting).
export function parseAll(text, ids, stopReason = 'end', { rng = Math.random, maxDelta = 7, grammar = 'v2' } = {}) {
  const p = new SegParser(ids, { grammar });
  for (let i = 0; i < text.length;) { const n = 1 + Math.floor(rng() * maxDelta); p.push(text.slice(i, i + n)); i += n; }
  return p.end(stopReason);
}

// Repair plan. `src` maps id -> source text. A present segment is "suspect-merged" when its neighbour is missing
// and its length ratio is far above the median ratio of the chunk's other segments (it likely absorbed the neighbour).
// A segment closed implicitly by an *unknown* id is suspect too: a literal "<seg" in its text cut it short.
export function plan(res, src, { mergeFactor = 1.6 } = {}) {
  const ratio = (id) => (res.segs[id]?.length ?? 0) / Math.max(1, src[id].length);
  const present = Object.keys(res.segs).map(Number);
  const medOthers = (id) => { const r = present.filter((x) => x !== id).map(ratio).sort((a, b) => a - b); return r.length ? r[Math.floor((r.length - 1) / 2)] : 1; };
  const missing = new Set(res.missing);
  // v2: an open tag swallowed as text next to a missing id is a missing close, whatever the ratio.
  const swallowed = new Set(res.fixes.filter((f) => f.kind === 'open-in-text').map((f) => f.id));
  const merged = present.filter((id) => (missing.has(id - 1) || missing.has(id + 1)) && (swallowed.has(id) || ratio(id) > mergeFactor * medOthers(id)));
  const empty = present.filter((id) => !res.segs[id].trim() && src[id].trim());
  const truncated = res.fixes.flatMap((f, i) => (f.kind === 'implicit-close' && res.fixes[i + 1]?.kind === 'unknown' ? [f.id] : []));
  // dup / orphan-close / unknown mean the tag structure itself is in doubt (seen when the source holds a literal
  // "<seg" or "</seg>"): which text belongs to which id can't be trusted, so the whole chunk is requested again.
  const ambiguous = res.fixes.some((f) => ['dup', 'orphan-close', 'unknown', 'bad-id'].includes(f.kind));
  // A segment whose literal tag count differs from its source's was cut or extended at a literal tag (e.g. a retracted
  // close in the last segment, when the model also dropped the final </seg>).
  const tagMismatch = present.filter((id) => literalTags(src[id]) !== literalTags(res.segs[id]));
  const ids = Object.keys(src).map(Number);
  const rerequest = ambiguous ? ids : [...new Set([...res.missing, ...(res.cut ? [res.cut.id] : []), ...merged, ...empty, ...truncated, ...tagMismatch])].sort((a, b) => a - b);
  return { rerequest, ambiguous, merged, empty, truncated, tagMismatch, cut: res.cut?.id ?? null };
}

// Source escaping for the "escaped" arm: only & < > (what a model must round-trip). Output is unescaped the same way.
export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
