// domPath: where a block lives in the page, including inside open shadow roots (decision S3, N3).
// Steps are `tag[n]` (n = 1-based index among same-tag element siblings); `#shadow-root` marks
// the step from a host into its shadow root.

export const SHADOW_STEP = '#shadow-root';

export function domPathOf(el: Element): string {
  const steps: string[] = [];
  let node: Element | null = el;
  while (node) {
    const parent: Node | null = node.parentNode;
    let n = 1;
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) if (sib.localName === node.localName) n++;
    steps.push(`${node.localName}[${n}]`);
    if (parent && parent.nodeType === 11 && (parent as ShadowRoot).host) {
      steps.push(SHADOW_STEP);
      node = (parent as ShadowRoot).host;
    } else {
      node = parent && parent.nodeType === 1 ? (parent as Element) : null;
    }
  }
  return '/' + steps.reverse().join('/');
}

/** The element a domPath points to, or null. Any `#run[k]` suffix is ignored. */
export function resolveDomPath(doc: Document, path: string): Element | null {
  const steps = path.replace(/#run\[\d+\]$/, '').split('/').filter(Boolean);
  let scope: ParentNode = doc;
  let el: Element | null = null;
  for (const step of steps) {
    if (step === SHADOW_STEP) {
      const root = el?.shadowRoot;
      if (!root) return null;
      scope = root;
      continue;
    }
    const m = /^([^[]+)\[(\d+)\]$/.exec(step);
    if (!m) return null;
    const [, tag, idx] = m;
    el = [...scope.children].filter((c) => c.localName === tag)[Number(idx) - 1] ?? null;
    if (!el) return null;
    scope = el;
  }
  return el;
}
