// Draft <seg> streaming parser for S2: strict grammar first, lenient fallback, repair plan.
//
// Strict grammar (what the prompt asks for):
//   output := WS (seg WS)*
//   seg    := '<seg id="' DIGITS '">' text '</seg>'
//   text   := any chars not containing '<seg' or '</seg' (case-sensitive)
//   WS     := [ \t\r\n]*
// Lenient tokens (accepted, but each use is counted as a "fix"):
//   open   := '<' WS? 'seg' (WS attrs)? '>' with id="N" | id='N' | id=N, any case   (fix: open-form)
//   close  := '<' WS? '/' WS? 'seg' WS? '>', any case                               (fix: close-form)
//   a new open while a segment is open closes it                                     (fix: implicit-close)
//   text outside segments is dropped (fences, preambles, notes)                      (fix: stray)
//   duplicate id: the first one wins; unknown id: dropped                            (fix: dup / unknown)
//   out-of-order ids are accepted                                                    (fix: reorder)
//   stream end inside a segment: "cut" when stopReason is max_tokens, else "unclosed-end"
// Repair plan (returned by plan()): request again only ids that are missing, cut, empty or suspect-merged.
export const OPEN_STRICT = /^<seg id="(\d+)">/;
const OPEN_LENIENT = /^<\s*seg\b([^<>]*)>/i;
const CLOSE_STRICT = '</seg>';
const CLOSE_LENIENT = /^<\s*\/\s*seg\s*>/i;
const ID_ATTR = /\bid\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))/i;
const MAX_TAG = 40; // longest lenient tag we wait for before treating '<' as text

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
      const open = (m = OPEN_STRICT.exec(b)) ? [m[0], +m[1], true] : (m = OPEN_LENIENT.exec(b)) && ID_ATTR.exec(m[1]) ? [m[0], +ID_ATTR.exec(m[1]).slice(1).find(Boolean), false] : null;
      if (open) {
        const [tag, id, strict] = open;
        // v2: an open tag inside an open segment is content; a missing close then shows up as missing + merged.
        if (this.v2 && this.open) { this.fix('open-in-text', { id: this.open.id }); this.#text(tag); this.buf = b.slice(tag.length); continue; }
        if (!strict) this.fix('open-form', { detail: tag });
        this.#open(id); this.buf = b.slice(tag.length); continue;
      }
      // could still become a tag: wait for more input
      if (!final && b.length < MAX_TAG && !b.includes('>') && /^<\s*\/?\s*(s|se|seg(\b[^<>]*)?)?$/i.test(b)) return;
      // literal '<'
      this.#text('<'); this.buf = b.slice(1);
    }
  }
  // v2 close rule: a close tag closes only when what follows (after whitespace) is an open tag or the end of output.
  #closeVerdict(rest, final) {
    const r = rest.replace(/^\s+/, '');
    if (!r) return final ? 'close' : 'wait';
    if (r[0] !== '<') return 'text';
    if (OPEN_STRICT.test(r) || ((m) => m && ID_ATTR.test(m[1]))(OPEN_LENIENT.exec(r))) return 'close';
    if (r.startsWith(CLOSE_STRICT) || CLOSE_LENIENT.test(r)) return 'close'; // "</seg></seg>": first closes, second is orphan
    const prefix = r.length < MAX_TAG && !r.includes('>') && /^<\s*\/?\s*(s|se|seg(\b[^<>]*)?)?$/i.test(r);
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
  const ambiguous = res.fixes.some((f) => ['dup', 'orphan-close', 'unknown'].includes(f.kind));
  const ids = Object.keys(src).map(Number);
  const rerequest = ambiguous ? ids : [...new Set([...res.missing, ...(res.cut ? [res.cut.id] : []), ...merged, ...empty, ...truncated])].sort((a, b) => a - b);
  return { rerequest, ambiguous, merged, empty, truncated, cut: res.cut?.id ?? null };
}

// Source escaping for the "escaped" arm: only & < > (what a model must round-trip). Output is unescaped the same way.
export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
