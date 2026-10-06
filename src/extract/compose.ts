// Working copy of the page with open shadow roots composed in (decision S3). Extraction edits
// this copy, never the page. Each copied element carries `data-ts-i`, an index into `live`, so
// a block found in the copy (or in Readability's output, which keeps attributes) maps back to
// the page element it came from, for its domPath.

export const INDEX_ATTR = 'data-ts-i';
/** On an element that is not visible but kept: an inactive tab panel or closed `details` content. */
export const HIDDEN_ATTR = 'data-ts-hidden';

/**
 * Tab panels, by role or by known markup without a role: pymdownx.tabbed (MkDocs Material) hides
 * inactive panels with CSS alone (radio inputs + `.tabbed-block`). Found by the Chrome check on
 * the MkDocs fixture, where jsdom (no CSS) can't see it.
 */
export const TAB_PANEL = '[role=tabpanel], .tabbed-set > .tabbed-content > .tabbed-block';

export interface Composed {
  /** Copy of `<body>`, detached from the document. */
  root: Element;
  /** Page elements, by `data-ts-i`. */
  live: Element[];
}

// Never text: skipped while copying, so they cost nothing later. Form fields are never read, so
// a password (or any typed value) can't reach a segment (DESIGN.md §8); a textarea's default
// text is a text node, hence the explicit skip.
const SKIP = new Set([
  'script', 'style', 'noscript', 'template', 'link', 'meta', 'iframe', 'object', 'embed', 'canvas',
  'input', 'textarea', 'select', 'option', 'datalist', 'output',
]);

export function composeDocument(doc: Document): Composed {
  const live: Element[] = [];
  const body = doc.body as Element | null;
  if (!body) return { root: doc.createElement('body'), live };
  const root = copyElement(body, live, false);
  return { root, live };
}

function copyElement(el: Element, live: Element[], inHidden: boolean): Element {
  const copy = el.cloneNode(false) as Element;
  copy.setAttribute(INDEX_ATTR, String(live.length));
  live.push(el);
  // Open shadow root: its tree replaces the light children, which appear where slots take them.
  const children = el.shadowRoot ? el.shadowRoot.childNodes : el.childNodes;
  const closedDetails = el.localName === 'details' && !el.hasAttribute('open');
  for (const child of children) copyChild(child, copy, live, inHidden, closedDetails);
  return copy;
}

function copyChild(node: Node, into: Element, live: Element[], inHidden: boolean, inClosedDetails: boolean): void {
  if (node.nodeType === 3) {
    into.appendChild(node.cloneNode(false));
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  if (SKIP.has(el.localName)) return;
  if (el.localName === 'slot' && el.getRootNode() !== el.ownerDocument) {
    // A slot inside a shadow tree: its assigned light nodes (or fallback content), flattened
    // through nested slots.
    for (const n of (el as HTMLSlotElement).assignedNodes({ flatten: true })) copyChild(n, into, live, inHidden, false);
    return;
  }
  let hidden = inHidden;
  if (!hidden) {
    const keptHidden = isKeptHidden(el, inClosedDetails);
    if (keptHidden) hidden = true;
    else if (!isVisible(el)) return;
  }
  const copy = copyElement(el, live, hidden);
  if (hidden && !inHidden) copy.setAttribute(HIDDEN_ATTR, '');
  into.appendChild(copy);
}

/**
 * Hidden, but kept and translated when shown (decision S3): an inactive tab panel, however it
 * is hidden (`hidden`, `aria-hidden`, CSS), and the content of a closed `details`.
 */
function isKeptHidden(el: Element, inClosedDetails: boolean): boolean {
  if (inClosedDetails && el.localName !== 'summary') return true;
  if (!el.matches(TAB_PANEL)) return false;
  return el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true' || !isVisible(el);
}

/**
 * CSS visibility in the live page (decision S3). jsdom has no layout and no checkVisibility, so
 * there every element counts as visible and only the attribute rules apply (tested in M0-E8).
 */
function isVisible(el: Element): boolean {
  if (typeof el.checkVisibility !== 'function') return true;
  if (el.checkVisibility({ visibilityProperty: true })) return true;
  // display: contents has no box, so checkVisibility says false, but its children render.
  return el.ownerDocument.defaultView?.getComputedStyle(el).display === 'contents';
}
