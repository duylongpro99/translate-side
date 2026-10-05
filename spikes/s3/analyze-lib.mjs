// Compose open shadow roots into the light tree (declarative <template shadowrootmode> in fixtures;
// in the extension the same walk reads el.shadowRoot). Slots receive the host's matching light children.
export function flattenShadow(doc) {
  let t;
  while ((t = doc.querySelector('template[shadowrootmode]'))) {
    const host = t.parentElement; t.remove();
    const frag = t.content;
    const light = [...host.childNodes];
    for (const slot of [...frag.querySelectorAll('slot')]) {
      const name = slot.getAttribute('name');
      const assigned = light.filter((n) => (name ? n.nodeType === 1 && n.getAttribute('slot') === name : !(n.nodeType === 1 && n.hasAttribute('slot'))));
      if (assigned.length) slot.replaceWith(...assigned); else slot.replaceWith(...slot.childNodes);
    }
    host.replaceChildren(...frag.childNodes);
  }
}
