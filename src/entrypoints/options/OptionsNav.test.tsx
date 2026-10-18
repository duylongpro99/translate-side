// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OptionsNav, SECTIONS } from './OptionsNav.tsx';

type Callback = (entries: { target: Element; isIntersecting: boolean }[]) => void;
let observed: Element[];
let fire: Callback;

let root: HTMLDivElement;
beforeEach(() => {
  observed = [];
  globalThis.IntersectionObserver = class {
    constructor(cb: Callback) {
      fire = cb;
    }
    observe(el: Element) {
      observed.push(el);
    }
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
  root = document.createElement('div');
  document.body.replaceChildren(root);
  for (const [id] of SECTIONS) {
    const s = document.createElement('section');
    s.id = id;
    document.body.append(s);
  }
});
afterEach(() => act(() => render(null, root)));

describe('OptionsNav', () => {
  it('is a labelled nav with a link to every section by its id, in page order', async () => {
    await act(() => render(<OptionsNav />, root));
    const nav = root.querySelector('nav') as HTMLElement;
    expect(nav.getAttribute('aria-label')).toBe('Settings sections');
    const links = [...nav.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(SECTIONS.map(([id]) => `#${id}`));
    expect(links.map((a) => a.textContent)).toContain('Site rules');
    // Every target exists on the page, the deep links #sites and #memory among them.
    for (const [id] of SECTIONS) expect(document.getElementById(id)).not.toBeNull();
    expect(observed.map((e) => e.id)).toEqual(SECTIONS.map(([id]) => id));
  });

  it('marks the section in view with aria-current, the first in page order when several are', async () => {
    await act(() => render(<OptionsNav />, root));
    const current = () => [...root.querySelectorAll('a[aria-current="true"]')].map((a) => a.getAttribute('href'));
    expect(current()).toEqual(['#providers']);
    await act(() => fire([{ target: document.getElementById('memory') as Element, isIntersecting: true }, { target: document.getElementById('sites') as Element, isIntersecting: true }]));
    expect(current()).toEqual(['#sites']);
    await act(() => fire([{ target: document.getElementById('sites') as Element, isIntersecting: false }]));
    expect(current()).toEqual(['#memory']);
  });

  it('marks a section at once when its link is followed', async () => {
    await act(() => render(<OptionsNav />, root));
    await act(() => root.querySelector<HTMLAnchorElement>('a[href="#transfer"]')?.click());
    expect(root.querySelector('a[aria-current="true"]')?.getAttribute('href')).toBe('#transfer');
  });
});
