// Parse a segment's light markers (DESIGN.md §4.1) into tokens the panel renders as elements.
// Text only, never HTML: page content is untrusted (DESIGN.md §8).

export type MarkupNode =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'em'; children: MarkupNode[] }
  | { type: 'link'; children: MarkupNode[] };

const TOKEN = /\[link\]|\[\/link\]|`[^`\n]+`|\*/g;

/** Unbalanced markers stay literal text. */
export function parseMarkup(src: string): MarkupNode[] {
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
    if (tok === '[link]') stack.push({ type: 'link', children: [], open: tok });
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
