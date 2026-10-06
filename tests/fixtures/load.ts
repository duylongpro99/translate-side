// Fixture loading for extraction tests (M0-E8). jsdom doesn't build declarative shadow roots, so
// each <template shadowrootmode> is attached as a real open shadow root, so the extractor's
// live-DOM composition (el.shadowRoot, slots) runs as it does in Chrome (S3: fixtures/README).
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

export const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures');
export const SITES = path.join(FIXTURES, 'sites');

export interface FixtureMeta {
  slug: string;
  finalUrl: string;
  contentSelector: string;
  /** Hand-checked number of code blocks in the content root (S3 `results.md`, re-checked for M0-E8). */
  codeBlocks: number;
  /** Code blocks in the content root that are deliberately not counted, and why. */
  codeExcluded?: { selector: string; why: string };
  generator: string;
}

export const manifest = JSON.parse(fs.readFileSync(path.join(SITES, 'manifest.json'), 'utf8')) as Record<string, FixtureMeta>;
export const slugs = Object.keys(manifest);

export function attachDeclarativeShadowRoots(root: ParentNode): number {
  let n = 0;
  for (const t of [...root.querySelectorAll('template[shadowrootmode]')] as HTMLTemplateElement[]) {
    const host = t.parentElement;
    if (!host || host.shadowRoot) continue;
    const mode = t.getAttribute('shadowrootmode') === 'closed' ? 'closed' : 'open';
    const sr = host.attachShadow({ mode });
    sr.append(t.content);
    t.remove();
    n += 1 + attachDeclarativeShadowRoots(sr);
  }
  return n;
}

export function loadHtml(html: string, url: string): Document {
  const doc = new JSDOM(html, { url }).window.document;
  attachDeclarativeShadowRoots(doc);
  return doc;
}

export function loadFixture(slug: string): Document {
  const meta = manifest[slug];
  if (!meta) throw new Error(`unknown fixture ${slug}`);
  return loadHtml(fs.readFileSync(path.join(SITES, `${slug}.html`), 'utf8'), meta.finalUrl);
}
