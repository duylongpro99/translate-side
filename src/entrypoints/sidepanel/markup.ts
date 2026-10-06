// Parse a segment's light markers (DESIGN.md §4.1) into tokens the panel renders as elements.
// Text only, never HTML: page content is untrusted (DESIGN.md §8).
//
// Literal marker characters (M0 carry-over NB6): the segmenter does not escape page text, so a
// page that says "2 * 3 * 4" or "`[link]`" looks like markup. A marker only becomes formatting
// when the source segment proves it: `markerKinds` keeps a kind only if parsing the segment's
// markup gives back exactly its plain text. The panel parses both the original and the
// translation with that set, so the model can't turn literal characters into formatting either.

export type MarkupNode =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'em'; children: MarkupNode[] }
  | { type: 'link'; children: MarkupNode[] };

const TOKEN = /\[link\]|\[\/link\]|`[^`\n]+`|\*/g;

export type MarkerKind = 'em' | 'link' | 'code';
export const ALL_MARKERS: ReadonlySet<MarkerKind> = new Set(['em', 'link', 'code']);
const NO_MARKERS: ReadonlySet<MarkerKind> = new Set();

/** The text a reader sees, markers removed. */
export function plainText(nodes: readonly MarkupNode[]): string {
  return nodes.map((n) => (n.type === 'text' || n.type === 'code' ? n.text : plainText(n.children))).join('');
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The marker kinds a segment really uses: those its markup parses into, when the markup minus
 * its markers is the segment's plain text. Otherwise some marker character is the page's own
 * text and there is no telling which, so none is formatting.
 */
export function markerKinds(seg: { text: string; inlineMarkup: string }): ReadonlySet<MarkerKind> {
  if (seg.inlineMarkup === seg.text) return NO_MARKERS;
  const nodes = parseMarkup(seg.inlineMarkup);
  if (squash(plainText(nodes)) !== squash(seg.text)) return NO_MARKERS;
  const kinds = new Set<MarkerKind>();
  const walk = (ns: readonly MarkupNode[]) => {
    for (const n of ns) {
      if (n.type !== 'text') kinds.add(n.type);
      if (n.type === 'em' || n.type === 'link') walk(n.children);
    }
  };
  walk(nodes);
  return kinds;
}

/** Unbalanced markers, and markers of a kind not in `allowed`, stay literal text. */
export function parseMarkup(src: string, allowed: ReadonlySet<MarkerKind> = ALL_MARKERS): MarkupNode[] {
  type Frame = { type: 'root' | 'em' | 'link'; children: MarkupNode[]; open: string };
  const stack: Frame[] = [{ type: 'root', children: [], open: '' }];
  const top = () => stack[stack.length - 1] as Frame;
  const text = (t: string) => {
    if (!t) return;
    const kids = top().children;
    const last = kids[kids.length - 1];
    if (last?.type === 'text') last.text += t;
    else kids.push({ type: 'text', text: t });
  };
  const close = (type: 'em' | 'link') => {
    const f = stack.pop() as Frame;
    top().children.push({ type, children: f.children });
  };
  let pos = 0;
  for (const m of src.matchAll(TOKEN)) {
    text(src.slice(pos, m.index));
    pos = m.index + m[0].length;
    const tok = m[0];
    const kind: MarkerKind = tok.startsWith('`') ? 'code' : tok === '*' ? 'em' : 'link';
    if (!allowed.has(kind)) text(tok);
    else if (tok === '[link]') stack.push({ type: 'link', children: [], open: tok });
    else if (tok === '[/link]' && top().type === 'link') close('link');
    else if (tok === '*' && top().type === 'em') close('em');
    else if (tok === '*' && src.indexOf('*', pos) > pos) stack.push({ type: 'em', children: [], open: tok });
    else if (tok.startsWith('`')) top().children.push({ type: 'code', text: tok.slice(1, -1) });
    else text(tok);
  }
  text(src.slice(pos));
  // Unclosed frames: their marker becomes text again.
  while (stack.length > 1) {
    const f = stack.pop() as Frame;
    text(f.open);
    for (const c of f.children) {
      if (c.type === 'text') text(c.text);
      else top().children.push(c);
    }
  }
  return (stack[0] as Frame).children;
}
