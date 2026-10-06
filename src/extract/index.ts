// Page extraction (plan M0-E5, decision S3): on a shadow-composed working copy, walk
// main/article/[role=main] with generic + per-site cleanup; if that finds no container or too
// little text, Readability on the same copy; otherwise the selection hint. Denylisted origins
// are never extracted.
import { Readability } from '@mozilla/readability';
import { segment } from '@/segment/segmenter';
import { domPathOf } from '@/segment/dom-path';
import { classifyUrl } from '@/shared/denylist';
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

export function extractPage(doc: Document): ExtractResult {
  const url = doc.URL;
  if (!classifyUrl(url).ok) return { ok: false, reason: 'denylisted', url };
  const composed = composeDocument(doc);
  const main = findMainContent(doc, composed);
  if (!main) return { ok: false, reason: 'no-content', url };

  const paths = new Map<Element, string>();
  const pathOf = (el: Element): string => {
    let p = paths.get(el);
    if (p === undefined) {
      p = livePath(el, composed);
      paths.set(el, p);
    }
    return p;
  };
  const segments = segment(main.root, { pathOf, isHidden: (el) => el.closest(`[${HIDDEN_ATTR}]`) !== null });
  const lang = doc.documentElement.getAttribute('lang') ?? undefined;
  return { ok: true, via: main.via, url, title: doc.title, ...(lang ? { lang } : {}), segments };
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
