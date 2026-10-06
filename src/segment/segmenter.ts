// Segmenter (plan M0-E6, DESIGN.md §4.1): turns the cleaned working copy into Segment[] in
// reading order. Block kinds come from the element (and its context: a paragraph inside a list
// item is part of the item); inline formatting becomes light markers; code blocks are kept
// verbatim and never translated; table cells of a row share a groupId.
import type { Segment, SegmentKind } from '@/engine/types';
import { BOX_ATTR } from '@/extract/compose';
import { CODE_BLOCK } from './code-block.ts';

export { CODE_BLOCK };
import { hashId } from './hash.ts';

export interface SegmentOptions {
  /** domPath of a block in the working copy (it maps the copy back to the page). */
  pathOf(el: Element): string;
  /** Whether the block is kept but hidden (inactive tab panel, closed details). */
  isHidden?(el: Element): boolean;
}

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'center', 'dd', 'details', 'dialog', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr',
  'legend', 'li', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'tr', 'ul',
]);
const BLOCK_SELECTOR = [...BLOCK_TAGS].join(', ');
const HEADING = /^h([1-6])$/;
const EDITOR_LINES = new Set(['div', 'p']);
const INLINE_CODE = new Set(['code', 'kbd', 'samp', 'tt']);
const EMPHASIS = new Set(['em', 'i', 'strong', 'b']);
/** No text of their own worth translating. */
const IGNORED = new Set(['img', 'picture', 'video', 'audio', 'source', 'track', 'map', 'area', 'wbr', 'annotation', 'annotation-xml']);

/** Block kinds that the paragraphs inside them inherit. */
type Context = { kind?: SegmentKind; groupId?: string };

const BR = ''; // private-use placeholder for <br>, not matched by \s

export function segment(root: Element, opts: SegmentOptions): Segment[] {
  const out: Segment[] = [];
  const blockCache = new WeakMap<Element, boolean>();
  const isBlock = (el: Element): boolean => {
    let b = blockCache.get(el);
    if (b === undefined) {
      b = BLOCK_TAGS.has(el.localName) || el.querySelector(BLOCK_SELECTOR) !== null;
      blockCache.set(el, b);
    }
    return b;
  };

  const emit = (el: Element, kind: SegmentKind, text: string, inlineMarkup: string, domPath: string, extra: Partial<Segment> = {}) => {
    const wordy = /[\p{L}\p{N}]/u.test(text);
    // A block with no letters or digits (¶, —, a lone zero-width space) is dropped, except code
    // and table cells: a cell like `{/* … */}` keeps its row aligned, and isn't translated.
    if (!wordy && kind !== 'code' && kind !== 'table-cell') return;
    if (text.trim() === '') return;
    const translate = kind !== 'code' && wordy && !optedOut(el, root);
    const seg: Segment = { id: hashId(`${domPath}\n${text}`), kind, text, inlineMarkup, domPath, translate, ...extra };
    if (opts.isHidden?.(el)) seg.hidden = true;
    out.push(seg);
  };

  const emitCode = (el: Element) => {
    const text = codeText(el);
    const lang = codeLang(el);
    emit(el, 'code', text, text, opts.pathOf(el), lang ? { codeLang: lang } : {});
  };

  const visitBlock = (el: Element, ctx: Context): void => {
    const tag = el.localName;
    if (el.matches(CODE_BLOCK) || (INLINE_CODE.has(tag) && el.querySelector(BLOCK_SELECTOR))) return emitCode(el);
    const h = HEADING.exec(tag);
    if (h) {
      const { text, markup } = inline([...el.childNodes]);
      emit(el, 'heading', text, markup, opts.pathOf(el), { level: Number(h[1]) });
      return;
    }
    let next = ctx;
    // Blocks inside a table cell keep the row's groupId (ROADMAP §8 item 12).
    const row = ctx.groupId ? { groupId: ctx.groupId } : {};
    switch (tag) {
      case 'li':
        next = { kind: 'li', ...row };
        break;
      case 'blockquote':
        next = { kind: 'quote', ...row };
        break;
      case 'td':
      case 'th': {
        const row = el.closest('tr');
        next = { kind: 'table-cell', ...(row ? { groupId: `row-${hashId(opts.pathOf(row))}` } : {}) };
        break;
      }
      case 'figcaption':
      case 'caption':
        next = { kind: 'caption', ...row };
        break;
    }
    visitContainer(el, next);
  };

  /** Loose inline content between blocks becomes segments of the context's kind. */
  const visitContainer = (el: Element, ctx: Context): void => {
    const parts: (Node[] | Element)[] = [];
    let run: Node[] = [];
    for (const child of el.childNodes) {
      if (child.nodeType === 1 && isBlock(child as Element)) {
        if (run.length) parts.push(run);
        run = [];
        parts.push(child as Element);
      } else if (child.nodeType === 1 || child.nodeType === 3) {
        run.push(child);
      }
    }
    if (run.length) parts.push(run);
    const onlyRun = parts.length === 1 && Array.isArray(parts[0]);
    let k = 0;
    for (const part of parts) {
      if (!Array.isArray(part)) {
        visitBlock(part, ctx);
        continue;
      }
      const { text, markup } = inline(part);
      if (!text) continue;
      k++;
      const path = onlyRun ? opts.pathOf(el) : `${opts.pathOf(el)}#run[${k}]`;
      emit(el, ctx.kind ?? 'p', text, markup, path, ctx.groupId ? { groupId: ctx.groupId } : {});
    }
  };

  visitContainer(root, {});
  // Ids must be unique; identical path + text can only repeat through a malformed page.
  const seen = new Map<string, number>();
  for (const s of out) {
    const n = (seen.get(s.id) ?? 0) + 1;
    seen.set(s.id, n);
    if (n > 1) s.id = `${s.id}~${n}`;
  }
  return out;
}

/**
 * The page asks for no translation: the nearest `translate` attribute says "no", or the block
 * sits in a `.notranslate` region (the class Google Translate honours). It keeps its kind.
 * Only marks inside the content root count: many apps put translate="no" on html or body to keep
 * the browser's translator out of their DOM, and the user asked for this page explicitly.
 */
function optedOut(el: Element, root: Element): boolean {
  const marked = el.closest('[translate], .notranslate');
  if (!marked || marked === root || !root.contains(marked)) return false;
  if (marked.classList.contains('notranslate')) return true;
  return marked.getAttribute('translate')?.toLowerCase() === 'no';
}

/** Plain text and marker text of inline content. */
export function inline(nodes: Node[]): { text: string; markup: string } {
  let text = '';
  let markup = '';
  for (const n of nodes) {
    const r = inlineRaw(n, false);
    text += r.text;
    markup += r.markup;
  }
  return { text: normalize(text), markup: normalize(markup) };
}

function inlineRaw(node: Node, inEmphasis: boolean): { text: string; markup: string } {
  if (node.nodeType === 3) {
    const t = (node as Text).data;
    return { text: t, markup: t };
  }
  if (node.nodeType !== 1) return { text: '', markup: '' };
  const el = node as Element;
  const tag = el.localName;
  if (IGNORED.has(tag)) return { text: '', markup: '' };
  if (tag === 'br') return { text: BR, markup: BR };
  if (tag === 'math') {
    const alt = el.getAttribute('alttext') ?? '';
    return { text: alt, markup: alt };
  }
  if (INLINE_CODE.has(tag)) {
    const t = el.textContent ?? '';
    return { text: t, markup: wrap(t, '`', '`') };
  }
  const isLink = tag === 'a' && el.hasAttribute('href');
  const isEmphasis = EMPHASIS.has(tag) && !inEmphasis;
  let text = '';
  let markup = '';
  for (const c of el.childNodes) {
    // Nested emphasis is flattened into the outer one.
    const r = inlineRaw(c, inEmphasis || isEmphasis);
    text += r.text;
    markup += r.markup;
  }
  if (isLink) markup = wrap(markup, '[link]', '[/link]');
  else if (isEmphasis) markup = wrap(markup, '*', '*');
  // Its own box on screen (compose.ts): keep its text apart from the elements it touches.
  if (el.hasAttribute(BOX_ATTR)) {
    const before = el.previousSibling?.nodeType === 1 ? ' ' : '';
    const after = el.nextSibling?.nodeType === 1 ? ' ' : '';
    return { text: before + text + after, markup: before + markup + after };
  }
  return { text, markup };
}

/** Put markers around the content, keeping its edge whitespace outside. Empty content: no markers. */
function wrap(content: string, open: string, close: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(content);
  const [, lead = '', core = '', trail = ''] = m ?? [];
  if (!core.replace(new RegExp(BR, 'g'), '').trim()) return content;
  return `${lead}${open}${core}${close}${trail}`;
}

function normalize(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(new RegExp(` ?${BR} ?`, 'g'), '\n')
    .trim();
}

/**
 * A code block's text, verbatim: `<br>` counts as a newline; trailing whitespace is dropped.
 * Outside `pre` (editor surfaces, block `<code>`), each line div starts a new line.
 */
export function codeText(el: Element): string {
  let out = '';
  const lineDivs = el.localName !== 'pre';
  const walk = (node: Node) => {
    if (node.nodeType === 3) out += (node as Text).data;
    else if (node.nodeType === 1) {
      const tag = (node as Element).localName;
      if (tag === 'br') out += '\n';
      else {
        if (lineDivs && node !== el && EDITOR_LINES.has(tag) && out && !out.endsWith('\n')) out += '\n';
        for (const c of node.childNodes) walk(c);
      }
    }
  };
  walk(el);
  return out.replace(/^\n+/, '').trimEnd();
}

function codeLang(el: Element): string | undefined {
  for (const e of [el, el.querySelector('code')]) {
    if (!e) continue;
    const attr = e.getAttribute('data-language') ?? e.getAttribute('data-lang');
    if (attr) return attr;
    const m = /(?:^|\s)(?:language|lang)-([\w+#.-]+)/.exec(e.getAttribute('class') ?? '');
    if (m?.[1]) return m[1];
  }
  return undefined;
}
