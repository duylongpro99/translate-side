// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/types';
import { resolveDomPath } from '@/segment/dom-path';
import { loadHtml } from '../../tests/fixtures/load.ts';
import { extractPage, hasFocusedPassword } from './index.ts';

const LONG = 'Futures decouple a value from how it is computed, so programs can wait for results. '.repeat(8);

function extract(body: string, url = 'https://example.com/docs/page') {
  const doc = loadHtml(`<!doctype html><html lang="en"><head><title>T</title></head><body>${body}</body></html>`, url);
  return { doc, result: extractPage(doc) };
}

function segmentsOf(body: string, url?: string): Segment[] {
  const { result } = extract(body, url);
  if (!result.ok) throw new Error(`no content: ${result.reason}`);
  return result.segments;
}

const texts = (segs: Segment[]) => segs.map((s) => s.text);

describe('extraction policy (decision S3)', () => {
  it('walks main and drops landmark chrome around and inside it', () => {
    const segs = segmentsOf(`
      <header><nav><a href="/">Home</a> <a href="/docs">Docs</a></nav></header>
      <main>
        <h1>Title</h1><p>${LONG}</p>
        <aside>Related posts</aside>
        <nav><a href="/next">Next page</a></nav>
        <button>Copy</button>
        <form><label>Search</label><input type="search"></form>
      </main>
      <footer>Footer text © 2026</footer>`);
    expect(texts(segs)).toEqual(['Title', LONG.trim()]);
  });

  it('applies the generic cleanup rules (visually hidden, edit links, glyph permalinks)', () => {
    const segs = segmentsOf(`<main>
      <h2>Section <a class="headerlink" href="#section">¶</a> <span class="mw-editsection">[<a href="?action=edit">edit</a>]</span></h2>
      <p>${LONG}<span class="sr-only">Opens in a new window</span></p></main>`);
    expect(texts(segs)).toEqual(['Section', LONG.trim()]);
  });

  it('removes a paywall box, but not an article body wrapped in a paywall class', () => {
    expect(texts(segmentsOf(`<main><p>${LONG}</p><div class="paywall-prompt"><p>Subscribe to keep reading</p></div></main>`))).toEqual([LONG.trim()]);
    expect(texts(segmentsOf(`<main><div class="paywall-content"><p>${LONG}</p><p>Second paragraph.</p></div></main>`))).toEqual([LONG.trim(), 'Second paragraph.']);
  });

  it('applies per-generator rules only for that generator', () => {
    const body = `<main><p class="prevnext">Previous article</p><p>${LONG}</p></main>`;
    expect(texts(segmentsOf(body, 'https://go.dev/blog/x'))).toEqual([LONG.trim()]);
    expect(texts(segmentsOf(body, 'https://example.com/blog/x'))).toEqual(['Previous article', LONG.trim()]);
  });

  it('narrows main to a single dominant article', () => {
    const segs = segmentsOf(`<main><div>Breadcrumb trail here</div><article><p>${LONG}</p></article></main>`);
    expect(texts(segs)).toEqual([LONG.trim()]);
  });

  it('removes a badge only when it stands alone in its paragraph (MkDocs)', () => {
    const body = `<main><p><span class="mdx-badge"><a href="/changelog">8.3.0</a></span></p><p>${LONG}</p>
      <p>Prior to <span class="mdx-badge"><a href="/changelog">8.5.6</a></span>, admonitions looked different.</p></main>`;
    const doc = loadHtml(`<!doctype html><html><head><meta name="generator" content="mkdocs-1.6.1"></head><body>${body}</body></html>`, 'https://example.com/');
    const result = extractPage(doc);
    if (!result.ok) throw new Error('expected content');
    expect(texts(result.segments)).toEqual([LONG.trim(), 'Prior to 8.5.6, admonitions looked different.']);
  });

  it('falls back to Readability when there is no main/article container', () => {
    const { result } = extract(`<div id="top">Menu links</div><div class="content"><p>${LONG}</p><p>${LONG}</p></div>`);
    expect(result).toMatchObject({ ok: true, via: 'readability' });
    if (result.ok) expect(texts(result.segments)).toContain(LONG.trim());
  });

  it('falls back to Readability when the walk finds too little text', () => {
    const { result } = extract(`<main><p>Short.</p></main><div class="post"><p>${LONG}</p><p>${LONG}</p></div>`);
    expect(result).toMatchObject({ ok: true, via: 'readability' });
  });

  it('Readability segments still carry page domPaths', () => {
    const { doc, result } = extract(`<div class="post"><p id="a">${LONG}</p><p id="b">${LONG} more</p></div>`);
    if (!result.ok) throw new Error('expected content');
    for (const s of result.segments) expect(resolveDomPath(doc, s.domPath)?.textContent?.replace(/\s+/g, ' ').trim()).toBe(s.text);
  });

  it('gives the selection hint when nothing reaches the threshold', () => {
    expect(extract('<p>Just a line.</p>').result).toEqual({ ok: false, reason: 'no-content', url: 'https://example.com/docs/page' });
  });

  it('never extracts a denylisted origin', () => {
    expect(extract(`<main><p>${LONG}</p></main>`, 'https://mail.google.com/mail/u/0/').result).toMatchObject({ ok: false, reason: 'denylisted' });
  });

  it('skips the page while a password field has focus (M3-D5), and reads it once focus left', () => {
    const { doc } = extract(`<main><p>${LONG}</p><form><input type="text" id="user"><input type="PassWord" id="pw"></form></main>`);
    (doc.getElementById('pw') as HTMLInputElement).focus();
    expect(extractPage(doc)).toEqual({ ok: false, reason: 'password', url: 'https://example.com/docs/page' });
    (doc.getElementById('user') as HTMLInputElement).focus();
    expect(extractPage(doc).ok).toBe(true);
  });

  it('sees a focused password field inside an open shadow root', () => {
    const { doc } = extract(`<main><p>${LONG}</p><div id="host"></div></main>`);
    const root = (doc.getElementById('host') as HTMLElement).attachShadow({ mode: 'open' });
    root.innerHTML = '<input type="password">';
    (root.querySelector('input') as HTMLInputElement).focus();
    expect(hasFocusedPassword(doc)).toBe(true);
    expect(extractPage(doc)).toMatchObject({ ok: false, reason: 'password' });
  });

  it('reads a page whose password field is not focused', () => {
    const { result } = extract(`<main><p>${LONG}</p><input type="password"></main>`);
    expect(result.ok).toBe(true);
  });

  it('never reads form fields, so password values cannot reach a segment (DESIGN §8)', () => {
    const { doc, result } = extract(`<article><p>${LONG}</p>
      <div><input type="password" value="hunter2"><textarea>draft secret</textarea>
      <select><option>opt secret</option></select></div></article>`);
    (doc.querySelector('input') as HTMLInputElement).value = 'typed-secret';
    const again = extractPage(doc);
    const all = JSON.stringify([result, again]);
    for (const secret of ['hunter2', 'typed-secret', 'draft secret', 'opt secret']) expect(all).not.toContain(secret);
  });

  it('keeps the text of glued elements apart when each renders as its own box', () => {
    const segs = segmentsOf(`<main><p>${LONG}</p>
      <div class="byline"><span style="display:inline-block">Written by</span><a href="/a">Ana</a></div>
      <p><b>un</b><i>glued</i> stays glued</p></main>`);
    expect(texts(segs).slice(1)).toEqual(['Written by Ana', 'unglued stays glued']);
  });

  it('never reads editable regions, default or typed text, but still shows code editors as code (D24)', () => {
    const { doc } = extract(`<main><p>${LONG}</p>
      <div contenteditable="true"><p>default draft</p></div>
      <div contenteditable=""><p>empty-attr draft</p></div>
      <div role="textbox"><p>textbox draft</p></div>
      <div contenteditable="false"><p>Read-only note stays.</p></div>
      <div class="cm-editor"><div class="cm-content" contenteditable="true" role="textbox"><div class="cm-line">let x = 1;</div></div></div></main>`);
    // The user types into the editable region and the code editor.
    const editable = doc.querySelector('[contenteditable="true"] p') as HTMLElement;
    editable.textContent = 'typed secret';
    (doc.querySelector('.cm-line') as HTMLElement).textContent = 'let x = 2;';
    const result = extractPage(doc);
    if (!result.ok) throw new Error('expected content');
    const all = JSON.stringify(result);
    for (const secret of ['default draft', 'empty-attr draft', 'textbox draft', 'typed secret']) expect(all).not.toContain(secret);
    expect(texts(result.segments)).toContain('Read-only note stays.');
    expect(result.segments.find((s) => s.kind === 'code')).toMatchObject({ text: 'let x = 2;', translate: false });
  });

  it('translates pages that opt out on html or body (app guards), honouring opt-outs inside the content', () => {
    for (const [htmlAttr, bodyAttr] of [['translate="no"', ''], ['', 'translate="no"'], ['', 'class="notranslate"']]) {
      const doc = loadHtml(`<!doctype html><html ${htmlAttr}><body ${bodyAttr}><main><p>${LONG}</p><p translate="no">Brand</p></main></body></html>`, 'https://example.com/');
      const result = extractPage(doc);
      if (!result.ok) throw new Error('expected content');
      expect(result.segments.map((s) => s.translate)).toEqual([true, false]);
    }
  });

  it('never reads a page that is all editable: contenteditable html/body or designMode (D24)', () => {
    for (const attrs of [['contenteditable', ''], ['', 'contenteditable="true"']]) {
      const doc = loadHtml(`<!doctype html><html ${attrs[0]}><body ${attrs[1]}><main><p>${LONG}</p></main></body></html>`, 'https://example.com/');
      expect(extractPage(doc)).toEqual({ ok: false, reason: 'no-content', url: 'https://example.com/' });
    }
    const { doc } = extract(`<main><p>${LONG}</p></main>`);
    doc.designMode = 'on';
    expect(extractPage(doc)).toMatchObject({ ok: false, reason: 'no-content' });
  });

  it('reports title, url and lang', () => {
    expect(extract(`<main><p>${LONG}</p></main>`).result).toMatchObject({ title: 'T', url: 'https://example.com/docs/page', lang: 'en' });
  });
});

describe('shadow DOM and hidden content (decision S3)', () => {
  it('composes open shadow roots and slots, with a #shadow-root step in domPath', () => {
    const { doc, result } = extract(`<main><p>${LONG}</p>
      <code-example><template shadowrootmode="open"><div class="frame"><pre>let x = 1;</pre><slot></slot></div></template>
      <p>Slotted caption text</p></code-example></main>`);
    if (!result.ok) throw new Error('expected content');
    const code = result.segments.find((s) => s.kind === 'code');
    expect(code?.text).toBe('let x = 1;');
    expect(code?.domPath).toContain('/code-example[1]/#shadow-root/div[1]/pre[1]');
    expect(resolveDomPath(doc, code?.domPath ?? '')?.textContent).toBe('let x = 1;');
    // A slotted child lives in the light DOM, so its path has no shadow step.
    const slotted = result.segments.find((s) => s.text === 'Slotted caption text');
    expect(slotted?.domPath).toMatch(/\/code-example\[1\]\/p\[1\]$/);
    expect(resolveDomPath(doc, slotted?.domPath ?? '')?.textContent).toBe('Slotted caption text');
  });

  it('keeps inactive tab panels and closed details as hidden segments', () => {
    const segs = segmentsOf(`<main><p>${LONG}</p>
      <div role="tabpanel">npm install</div>
      <div role="tabpanel" hidden><p>yarn add</p></div>
      <div role="tabpanel" aria-hidden="true"><p>pnpm add</p></div>
      <details><summary>More</summary><p>Inside details</p></details>
      <details open><summary>Open one</summary><p>Shown details</p></details></main>`);
    const hidden = Object.fromEntries(segs.map((s) => [s.text, s.hidden ?? false]));
    expect(hidden).toMatchObject({
      'npm install': false,
      'yarn add': true,
      'pnpm add': true,
      More: false,
      'Inside details': true,
      'Open one': false,
      'Shown details': false,
    });
  });

  it('recognizes pymdownx.tabbed panels (no role) as tab panels', () => {
    const { result } = extract(`<main><p>${LONG}</p><div class="tabbed-set"><input type="radio" checked><input type="radio">
      <div class="tabbed-content"><div class="tabbed-block"><pre>first</pre></div><div class="tabbed-block" hidden><pre>second</pre></div></div></div></main>`);
    if (!result.ok) throw new Error('expected content');
    expect(result.segments.filter((s) => s.kind === 'code').map((s) => [s.text, s.hidden ?? false])).toEqual([
      ['first', false],
      ['second', true],
    ]);
  });

  it('keeps hidden tab panels on the Readability path too', () => {
    const { result } = extract(`<div class="post"><p>${LONG}</p><p>${LONG}</p>
      <div role="tablist"></div><div role="tabpanel"><p>Install it with npm, the default package manager.</p></div>
      <div role="tabpanel" hidden><p>Install it with yarn, if your project already uses it.</p></div>
      <div role="tabpanel" aria-hidden="true" style="display:none"><p>Install it with pnpm, for a shared store.</p></div></div>`);
    expect(result).toMatchObject({ ok: true, via: 'readability' });
    if (!result.ok) return;
    const hidden = Object.fromEntries(result.segments.filter((s) => s.text.startsWith('Install')).map((s) => [s.text.split(' ')[3], s.hidden ?? false]));
    expect(hidden).toEqual({ 'npm,': false, 'yarn,': true, 'pnpm,': true });
  });

  it('drops hidden elements that are not tab panels', () => {
    const segs = segmentsOf(`<main><p>${LONG}</p><div hidden><p>Hidden promo</p></div><div aria-hidden="true">Decor</div></main>`);
    expect(texts(segs)).toEqual([LONG.trim()]);
  });
});
