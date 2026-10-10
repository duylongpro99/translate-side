// Page extraction (plan M0-E5, decision S3): on a shadow-composed working copy, walk
// main/article/[role=main] with generic + per-site cleanup; if that finds no container or too
// little text, Readability on the same copy; otherwise the selection hint. Denylisted origins
// are never extracted.
import { Readability } from '@mozilla/readability';
import { segment } from '@/segment/segmenter';
import { domPathOf } from '@/segment/dom-path';
import { classifyUrl } from '@/shared/denylist';
import type { Segment } from '@/engine/types';
import type { ExtractResult, ExtractVia } from '@/shared/protocol';
import { detectGenerator, stripInContent, stripLandmarks } from './clean.ts';
import { composeDocument, HIDDEN_ATTR, INDEX_ATTR, type Composed } from './compose.ts';

/** Thresholds from S3: accept the walk, or Readability, at ≥ 500 chars of text. */
export const WALK_MIN_CHARS = 500;
export const READABILITY_MIN_CHARS = 500;

const textLength = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().length;

/** The walk's root in the working copy: the outermost main, narrowed to one dominant article. */
export function walkRoot(root: Element): Element | null {
  const candidates = [...root.querySelectorAll('[role=main], main, article')];
  if (!candidates.length) return null;
  let main = candidates.find((c) => c.matches('[role=main], main')) ?? (candidates[0] as Element);
  const mainLen = textLength(main);
  const dominant = [...main.querySelectorAll('article')].filter((a) => textLength(a) >= 0.5 * mainLen);
  if (dominant.length === 1 && dominant[0]) main = dominant[0];
  return main;
}

export interface MainContent {
  via: ExtractVia;
  root: Element;
}

/** Choose the content root of a composed copy (mutates it). Null → selection hint. */
export function findMainContent(doc: Document, composed: Composed): MainContent | null {
  stripInContent(composed.root, detectGenerator(doc));
  const walked = walkRoot(composed.root);
  if (walked) {
    stripLandmarks(walked);
    if (textLength(walked) >= WALK_MIN_CHARS) return { via: 'walk', root: walked };
  }
  const article = runReadability(doc, composed.root);
  if (article && textLength(article) >= READABILITY_MIN_CHARS) return { via: 'readability', root: article };
  return null;
}

function runReadability(doc: Document, body: Element): Element | null {
  const work = doc.implementation.createHTMLDocument(doc.title);
  work.body.replaceWith(work.importNode(body, true));
  // Readability drops hidden subtrees; the tab panels and details content kept hidden (S3) go
  // in visible. Every element inside is marked HIDDEN_ATTR, since Readability may unwrap the
  // panel itself (a div holding one p becomes the p), so their segments still come out hidden.
  for (const el of work.querySelectorAll<HTMLElement>(`[${HIDDEN_ATTR}]`)) {
    el.removeAttribute('hidden');
    el.removeAttribute('aria-hidden');
    if (el.style.display === 'none') el.style.removeProperty('display');
    for (const d of el.querySelectorAll('*')) d.setAttribute(HIDDEN_ATTR, '');
  }
  try {
    // serializer: keep the element (and its data-ts-i attributes) rather than an HTML string.
    const parsed = new Readability<Element>(work, { charThreshold: READABILITY_MIN_CHARS, serializer: (el) => el as Element }).parse();
    return parsed?.content ?? null;
  } catch (err) {
    console.warn('[translate-side] Readability failed', err);
    return null;
  }
}

/**
 * Reads the page. With `targets`, also fills it with where each segment is in the live page (for
 * the viewport observer, plan M3-E1): the block itself; for a `#run[k]` block or an element
 * Readability made (which share their live container with others), a Range over its own live
 * text (M3 dogfood B3: an essay of `<br><br>` paragraphs), else that container.
 */
export function extractPage(doc: Document, targets?: Map<string, Element | Range>): ExtractResult {
  const url = doc.URL;
  if (!classifyUrl(url).ok) return { ok: false, reason: 'denylisted', url };
  // M3-D5: someone is typing a password here (a sign-in or payment page): skip the page.
  if (hasFocusedPassword(doc)) return { ok: false, reason: 'password', url };
  // D24: a page that is one editable region (an editor app, designMode) is never read.
  if (isEditableDocument(doc)) return { ok: false, reason: 'no-content', url };
  const composed = composeDocument(doc);
  const main = findMainContent(doc, composed);
  if (!main) return { ok: false, reason: 'no-content', url };

  const paths = new Map<Element, string>();
  const liveByPath = new Map<string, Element>();
  const pathOf = (el: Element): string => {
    let p = paths.get(el);
    if (p === undefined) {
      p = livePath(el, composed);
      paths.set(el, p);
      const live = targets && liveElement(el, composed);
      if (live) liveByPath.set(p, live);
    }
    return p;
  };
  const sources = new Map<Segment, Element | readonly Node[]>();
  const texts = liveTexts(composed);
  const segments = segment(main.root, {
    pathOf,
    isHidden: (el) => el.closest(`[${HIDDEN_ATTR}]`) !== null,
    ...(targets ? { onSegment: (seg: Segment, from: Element | readonly Node[]) => void sources.set(seg, from) } : {}),
  });
  if (targets) {
    for (const s of segments) {
      const from = sources.get(s);
      const shared = from !== undefined && (Array.isArray(from) || !(from as Element).hasAttribute(INDEX_ATTR));
      const live = (shared ? liveRange(doc, from, texts) : undefined) ?? liveByPath.get(s.domPath.replace(/#run\[\d+\]$/, ''));
      if (live) targets.set(s.id, live);
    }
  }
  const lang = doc.documentElement.getAttribute('lang') ?? undefined;
  return { ok: true, via: main.via, url, title: doc.title, ...(lang ? { lang } : {}), segments };
}

/** Node.DOCUMENT_POSITION_FOLLOWING (no `Node` global outside a window). */
const FOLLOWING = 4;

/**
 * Finds the page text node a copy text node shows. Text nodes carry no attribute, and Readability
 * may rebuild the copy from its HTML, so this goes by the nearest indexed ancestor (`data-ts-i`)
 * and the same text, among that page element's text nodes in order: each match moves a cursor on,
 * so repeated text maps to its own occurrence.
 */
function liveTexts(composed: Composed): (copy: Text) => Text | undefined {
  const lists = new Map<Element, { nodes: Text[]; next: number }>();
  return (copy) => {
    const own = copy.parentElement?.closest(`[${INDEX_ATTR}]`)?.getAttribute(INDEX_ATTR);
    const live = own === null || own === undefined ? undefined : composed.live[Number(own)];
    if (!live) return undefined;
    let list = lists.get(live);
    if (!list) {
      const nodes: Text[] = [];
      const walk = (n: Node) => (n.nodeType === 3 ? void nodes.push(n as Text) : n.childNodes.forEach(walk));
      walk(live);
      list = { nodes, next: 0 };
      lists.set(live, list);
    }
    const at = (from: number) => list.nodes.findIndex((t, i) => i >= from && t.data === copy.data);
    let i = at(list.next);
    if (i < 0) i = at(0);
    if (i < 0) return undefined;
    list.next = i + 1;
    return list.nodes[i];
  };
}

/** A Range over the live text of `from` (a copy block or run), or undefined when it can't be mapped. */
function liveRange(doc: Document, from: Element | readonly Node[], liveOf: (copy: Text) => Text | undefined): Range | undefined {
  const texts: Text[] = [];
  const collect = (node: Node) => {
    if (node.nodeType !== 3) return node.childNodes.forEach(collect);
    if ((node as Text).data.trim() === '') return;
    const live = liveOf(node as Text);
    if (live?.isConnected) texts.push(live);
  };
  for (const n of Array.isArray(from) ? from : [from as Element]) collect(n);
  const first = texts[0];
  const last = texts[texts.length - 1];
  if (!first || !last || first.ownerDocument !== doc) return undefined;
  if (first !== last && !(first.compareDocumentPosition(last) & FOLLOWING)) return undefined;
  const range = doc.createRange();
  range.setStart(first, 0);
  range.setEnd(last, last.data.length);
  return range;
}

/**
 * domPath of the page element a copy element came from. Elements Readability created have no
 * index; they get their nearest indexed ancestor's path plus their own tag.
 */
function livePath(el: Element, composed: Composed): string {
  const own = el.getAttribute(INDEX_ATTR);
  const live = own === null ? undefined : composed.live[Number(own)];
  if (live) return domPathOf(live);
  const anc = el.parentElement?.closest(`[${INDEX_ATTR}]`);
  const base = anc ? livePath(anc, composed) : '';
  const siblings = el.parentElement ? [...el.parentElement.children].filter((c) => c.localName === el.localName) : [el];
  return `${base}/~${el.localName}[${siblings.indexOf(el) + 1}]`;
}

/** The page element a copy element came from, or its nearest ancestor's that did. */
function liveElement(el: Element, composed: Composed): Element | undefined {
  const indexed = el.closest(`[${INDEX_ATTR}]`);
  const own = indexed?.getAttribute(INDEX_ATTR);
  return own === null || own === undefined ? undefined : composed.live[Number(own)];
}

function isEditableDocument(doc: Document): boolean {
  const editable = (el: Element | null) => {
    const ce = el?.getAttribute('contenteditable');
    return ce !== null && ce !== undefined && ce.toLowerCase() !== 'false';
  };
  return doc.designMode === 'on' || editable(doc.documentElement) || editable(doc.body);
}

/** The focused element, through open shadow roots (a password field inside a web component counts). */
function deepActiveElement(doc: Document): Element | null {
  let el = doc.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

/** Whether focus is in a password field at extraction time (plan M3 §5, decision M3-D5). */
export function hasFocusedPassword(doc: Document): boolean {
  const el = deepActiveElement(doc);
  return el?.localName === 'input' && (el.getAttribute('type') ?? '').trim().toLowerCase() === 'password';
}
