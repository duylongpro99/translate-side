// Editable regions are never read (decision D24): the extractor skips them, and the selection
// button never offers a selection in them. Kept small: the opt-in selection script on every site
// imports it without the extractor.
import { CODE_BLOCK } from '@/segment/code-block';

/**
 * contenteditable and role=textbox. Code editors (CodeMirror) are the exception: they show the
 * page's code example, and come out as do-not-translate code blocks.
 */
export function isEditable(el: Element): boolean {
  const ce = el.getAttribute('contenteditable');
  const editable = (ce !== null && ce.toLowerCase() !== 'false') || el.getAttribute('role') === 'textbox';
  return editable && !el.matches(CODE_BLOCK);
}

/** A document being edited as a whole: designMode, or a contenteditable root or body. */
export function isEditableDocument(doc: Document): boolean {
  const editable = (el: Element | null) => {
    const ce = el?.getAttribute('contenteditable');
    return ce !== null && ce !== undefined && ce.toLowerCase() !== 'false';
  };
  return doc.designMode === 'on' || editable(doc.documentElement) || editable(doc.body);
}

/** The focused element, through open shadow roots (a password field inside a web component counts). */
export function deepActiveElement(doc: Document): Element | null {
  let el = doc.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}
