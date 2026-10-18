// @vitest-environment jsdom
import { render } from 'preact';
import { browser } from 'wxt/browser';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/types';
import { App, type TranslatorProps } from './App.tsx';
import type { Jobs, JobView, SegState } from './jobs.ts';
import { parseMarkup, plainText } from './markup.ts';
import type { PanelController, PanelView } from './controller.ts';
import { uiError } from './status.ts';

function fakeController(view: PanelView) {
  let listener: ((v: PanelView, tabId: number | undefined) => void) | undefined;
  const c = {
    view,
    tabId: undefined as number | undefined,
    retried: 0,
    subscribe(fn: (v: PanelView, tabId: number | undefined) => void) {
      listener = fn;
      fn(c.view, c.tabId);
      return () => undefined;
    },
    retry() {
      c.retried++;
    },
    push(v: PanelView) {
      c.view = v;
      act(() => listener?.(v, c.tabId));
    },
  };
  return c;
}

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

const mount = (view: PanelView) => {
  const c = fakeController(view);
  act(() => render(<App controller={c as unknown as PanelController} />, root));
  return c;
};

const seg = (s: Partial<Segment> & Pick<Segment, 'kind' | 'inlineMarkup'>): Segment => ({
  id: `id-${Math.random().toString(36).slice(2)}`,
  // What the segmenter would give as plain text: the markup without its markers.
  text: plainText(parseMarkup(s.inlineMarkup)),
  domPath: '/x',
  translate: s.kind !== 'code',
  ...s,
});

describe('panel states', () => {
  it.each([
    [{ kind: 'loading' }, 'Reading the page'],
    [{ kind: 'idle' }, 'Press Alt+T'],
    [{ kind: 'blocked', reason: 'restricted' }, "Can't read this page"],
    [{ kind: 'blocked', reason: 'inject-failed', detail: 'Cannot access a chrome:// URL' }, "Can't read this page"],
    [{ kind: 'blocked', reason: 'denylisted' }, 'never reads this site'],
    [{ kind: 'blocked', reason: 'password' }, 'A password field has focus on this page, so Translate Side did not read it. Nothing was sent.'],
    [{ kind: 'lost' }, 'Press Alt+T or click the toolbar icon'],
    [{ kind: 'empty', url: 'https://x/' }, "Couldn't read this page. Select text to translate it."],
    [{ kind: 'error', message: 'boom' }, 'boom'],
  ] as [PanelView, string][])('%o shows "%s"', (view, text) => {
    mount(view);
    expect(root.textContent).toContain(text);
    expect(root.querySelector(`[data-state="${view.kind}"]`)).not.toBeNull();
  });

  it('the error state (extraction threw) carries the selection hint too', () => {
    mount({ kind: 'error', message: 'boom' });
    expect(root.querySelector('[data-state="error"]')?.textContent).toContain("Couldn't read this page. Select text to translate it.");
  });

  it('retries from the error state', () => {
    const c = mount({ kind: 'error', message: 'boom' });
    act(() => (root.querySelector('[data-state=error] button') as HTMLButtonElement).click());
    expect(c.retried).toBe(1);
  });

  it('switches when the controller reports a new view', () => {
    const c = mount({ kind: 'loading' });
    c.push({ kind: 'blocked', reason: 'restricted' });
    expect(root.textContent).toContain("Can't read this page");
  });
});

describe('segments by kind', () => {
  const segments = [
    seg({ kind: 'heading', level: 1, inlineMarkup: 'Title' }),
    seg({ kind: 'p', inlineMarkup: 'See [link]docs[/link] and `npm i` *now*.' }),
    seg({ kind: 'li', inlineMarkup: 'Item' }),
    seg({ kind: 'quote', inlineMarkup: 'Quoted' }),
    seg({ kind: 'code', inlineMarkup: 'fn main() {\n}', codeLang: 'rust' }),
    seg({ kind: 'table-cell', inlineMarkup: 'A', groupId: 'r1' }),
    seg({ kind: 'table-cell', inlineMarkup: 'B', groupId: 'r1' }),
    seg({ kind: 'table-cell', inlineMarkup: 'C', groupId: 'r2' }),
    seg({ kind: 'caption', inlineMarkup: 'Cap' }),
    seg({ kind: 'p', inlineMarkup: 'In a tab', hidden: true }),
    seg({ kind: 'p', inlineMarkup: '<img src=x onerror=alert(1)>' }),
  ];

  it('renders each kind, markers as elements, and tables by row', () => {
    mount({ kind: 'ready', docId: 'd', result: { ok: true, via: 'walk', url: 'https://x/', title: 'Page', segments } });
    const kinds = [...root.querySelectorAll('[data-kind]')].map((e) => e.getAttribute('data-kind'));
    expect(kinds).toEqual(['heading', 'p', 'li', 'quote', 'code', 'table-cell', 'table-cell', 'table-cell', 'caption', 'p', 'p']);
    const p = root.querySelector('[data-kind=p]');
    expect(p?.querySelector('.seg__link')?.textContent).toBe('docs');
    expect(p?.querySelector('code')?.textContent).toBe('npm i');
    expect(p?.querySelector('em')?.textContent).toBe('now');
    expect(root.querySelector('[data-kind=code] pre')?.textContent).toBe('fn main() {\n}');
    expect(root.querySelector('[data-kind=code]')?.textContent).toContain('rust · code, kept as is');
    expect([...root.querySelectorAll('.seg-row')].map((r) => r.querySelectorAll('[role=cell]').length)).toEqual([2, 1]);
    expect(root.querySelector('.seg--hidden')?.textContent).toContain('hidden on the page');
    // Page text is never parsed as HTML.
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps two adjacent tables apart, and a list in a cell in its row', () => {
    const cells = [
      seg({ kind: 'table-cell', inlineMarkup: 'A', groupId: 'r1', domPath: '/table[1]/tr[1]/td[1]' }),
      seg({ kind: 'li', inlineMarkup: 'A-item', groupId: 'r1', domPath: '/table[1]/tr[1]/td[2]/ul[1]/li[1]' }),
      seg({ kind: 'table-cell', inlineMarkup: 'B', groupId: 'r2', domPath: '/table[2]/tr[1]/td[1]' }),
      // Readability-created tables have `~table` steps.
      seg({ kind: 'table-cell', inlineMarkup: 'C', groupId: 'r3', domPath: '/div[1]/~table[1]/tr[1]/td[1]' }),
      seg({ kind: 'table-cell', inlineMarkup: 'D', groupId: 'r4', domPath: '/div[1]/~table[2]/tr[1]/td[1]' }),
    ];
    mount({ kind: 'ready', docId: 'd', result: { ok: true, via: 'walk', url: 'https://x/', title: 'Page', segments: cells } });
    const tables = [...root.querySelectorAll('.seg-table')];
    expect(tables.map((t) => t.textContent)).toEqual(['AA-item', 'B', 'C', 'D']);
    expect(tables[0]?.querySelectorAll('.seg-row')).toHaveLength(1);
  });

  it('has a dev segment view with ids in dev builds', () => {
    mount({ kind: 'ready', docId: 'doc12345', result: { ok: true, via: 'walk', url: 'https://x/', title: 'Page', segments } });
    expect(import.meta.env.DEV).toBe(true);
    // The segment view is an item of the header's More menu.
    act(() => (root.querySelector('[data-testid=more-button]') as HTMLButtonElement).click());
    expect(root.querySelector('[data-testid=menu-dev]')?.getAttribute('aria-checked')).toBe('false');
    act(() => (root.querySelector('[data-testid=menu-dev]') as HTMLButtonElement).click());
    const dev = root.querySelector('[data-testid=dev-view]');
    expect(dev?.querySelectorAll('tbody tr')).toHaveLength(segments.length);
    expect(dev?.textContent).toContain(segments[0]?.id);
  });
});

describe('translation in the panel (plan M1-E10)', () => {
  const p1 = seg({ kind: 'p', inlineMarkup: 'Read [link]the docs[/link].' });
  const p2 = seg({ kind: 'p', inlineMarkup: 'Second' });
  const p3 = seg({ kind: 'p', inlineMarkup: 'Third' });
  // The page's own text has the stars (no <em>): plain text and markup are the same.
  const lit = seg({ kind: 'p', inlineMarkup: '2 * 3 * 4', text: '2 * 3 * 4' });
  const code = seg({ kind: 'code', inlineMarkup: 'x = 1' });
  const segments = [p1, p2, p3, lit, code];

  function fakeJobs(view: JobView) {
    let listener: ((tabId: number) => void) | undefined;
    const calls: string[] = [];
    const j = {
      view,
      docOf: () => 'd',
      get: () => j.view,
      subscribe(fn: (tabId: number) => void) {
        listener = fn;
        return () => undefined;
      },
      async push(v: JobView) {
        j.view = v;
        await act(async () => {
          listener?.(7);
          await new Promise((r) => setTimeout(r, 30));
        });
      },
    };
    const translator: TranslatorProps = {
      jobs: j as unknown as Jobs,
      actions: () => ({
        cancel: () => calls.push('cancel'),
        resume: () => calls.push('resume'),
        translateRest: () => calls.push('rest'),
        openOptions: () => calls.push('options'),
        retrySegment: (id: string) => calls.push(`retry:${id}`),
        retranslateSegment: (id: string) => calls.push(`retranslate:${id}`),
        explainSegment: (id: string) => calls.push(`explain:${id}`),
        retranslatePage: () => calls.push('retranslate-page'),
        grantAccess: () => calls.push('grant'),
        continuePastLimit: () => calls.push('continue-limit'),
      }),
    };
    return { j, translator, calls };
  }

  const jobView = (segs: [Segment, SegState][], patch: Partial<JobView> = {}): JobView => ({
    status: 'running',
    paused: false,
    model: 'gemini-3.5-flash-lite',
    targetLang: 'vi',
    sourceLang: 'en',
    segments,
    segs: new Map(segs.map(([s, st]) => [s.id, st])),
    counts: { total: 4, final: segs.filter(([, s]) => s.status === 'final').length, failed: segs.filter(([, s]) => s.status === 'failed').length },
    usage: { input: 1000, cachedInput: 0, output: 800 },
    cost: 0.0023,
    unmetered: 0,
    startedAt: 1,
    ...patch,
  });

  function mountJob(view: JobView) {
    const f = fakeJobs(view);
    const c = fakeController({ kind: 'ready', docId: 'd', result: { ok: true, via: 'walk', url: 'https://x/', title: 'Page', segments } });
    c.tabId = 7;
    act(() => render(<App controller={c as unknown as PanelController} translator={f.translator} />, root));
    return f;
  }
  const block = (s: Segment) => root.querySelector(`[data-id="${s.id}"]`);
  /** A block's text without its action buttons (M3-E5). */
  const shown = (s: Segment) => {
    const el = block(s)?.cloneNode(true) as Element | undefined;
    el?.querySelector('.seg__actions')?.remove();
    return el?.textContent;
  };

  it('streams: original dimmed while pending, the preview while streaming, then the final', async () => {
    const f = mountJob(jobView([[p1, { status: 'pending' }], [p2, { status: 'streaming', text: 'Thứ h' }], [p3, { status: 'pending' }], [lit, { status: 'pending' }]]));
    expect(block(p1)?.getAttribute('data-status')).toBe('pending');
    expect(shown(p1)).toBe('Read the docs.');
    expect(block(p2)?.getAttribute('data-status')).toBe('streaming');
    expect(shown(p2)).toBe('Thứ h');
    expect(block(code)?.getAttribute('data-status')).toBe('kept');
    expect(root.querySelector('[data-testid=job]')?.textContent).toContain('Translating into Vietnamese… 0 of 4');
    await f.j.push(jobView([[p1, { status: 'final', text: 'Đọc [link]tài liệu[/link].', revision: 1, attempt: 1 }], [p2, { status: 'final', text: 'Thứ hai', revision: 1 }], [p3, { status: 'pending' }], [lit, { status: 'pending' }]]));
    expect(block(p1)?.getAttribute('data-status')).toBe('final');
    expect(block(p1)?.querySelector('.seg__link')?.textContent).toBe('tài liệu');
    expect(shown(p2)).toBe('Thứ hai');
  });

  it('renders model output as text only, and literal markers of the page stay literal (NB6)', () => {
    mountJob(jobView([[p1, { status: 'final', text: '<img src=x onerror=alert(1)> *đậm*', revision: 1 }], [lit, { status: 'final', text: '2 * 3 * 4', revision: 1 }]]));
    expect(root.querySelector('img')).toBeNull();
    expect(shown(p1)).toBe('<img src=x onerror=alert(1)> *đậm*');
    expect(block(p1)?.querySelector('em')).toBeNull();
    expect(shown(lit)).toBe('2 * 3 * 4');
    expect(block(lit)?.querySelector('em')).toBeNull();
  });

  it('shows a failed segment as its original with the reason', () => {
    mountJob(jobView([[p3, { status: 'failed', error: { kind: 'rate_limit', message: '429' } }]]));
    expect(block(p3)?.getAttribute('data-status')).toBe('failed');
    expect(shown(p3)).toContain('Third');
    expect(shown(p3)).toContain('Not translated: the provider is busy');
  });

  it('Cancel while running; the cost readout; Translate the rest after a cancel', async () => {
    const f = mountJob(jobView([]));
    expect(root.querySelector('[data-testid=job-cost]')?.textContent).toBe('$0.0023');
    // Cancel sits in the header (M3-E6), not twice in the status line.
    expect(root.querySelector('[data-testid=job] button')).toBeNull();
    act(() => (root.querySelector('[data-testid=page-cancel]') as HTMLButtonElement).click());
    expect(f.calls).toEqual(['cancel']);
    await f.j.push(jobView([[p1, { status: 'final', text: 'x', revision: 1 }]], { status: 'cancelled', unmetered: 2 }));
    expect(root.querySelector('[data-testid=job]')?.textContent).toContain('Cancelled · 1 of 4 translated');
    // Usage of a cancelled request never arrives: the readout says what it leaves out (review E-T2).
    expect(root.querySelector('[data-testid=job-cost]')?.textContent).toBe('$0.0023 · excludes cancelled requests');
    act(() => (root.querySelector('[data-testid=job] button') as HTMLButtonElement).click());
    expect(f.calls).toEqual(['cancel', 'resume']);
    await f.j.push(jobView([], { status: 'done', counts: { total: 4, final: 4, failed: 0 }, endedAt: 14_201, cost: 0.0072 }));
    expect(root.querySelector('[data-testid=job]')?.textContent).toContain('Vietnamese · 4 of 4 · 14.2 s');
    expect(root.querySelector('[data-testid=job-cost]')?.textContent).toBe('$0.0072');
  });

  it('a reading settings change restyles the text at once and sends nothing: no action, no page message, no block re-render', async () => {
    const f = mountJob(jobView([[p1, { status: 'final', text: 'Một', revision: 1 }]], { status: 'done', counts: { total: 4, final: 1, failed: 0 } }));
    let sent = 0;
    f.translator.send = () => void sent++;
    await act(() => new Promise((r) => setTimeout(r, 0)));
    const before = root.querySelector(`[data-id="${p1.id}"]`) as HTMLElement;
    // Any change inside the block (text, attributes, children) would mean the blocks were drawn again.
    const changes: MutationRecord[] = [];
    const watch = new MutationObserver((records) => changes.push(...records));
    watch.observe(before, { subtree: true, childList: true, attributes: true, characterData: true });
    await act(async () => {
      await browser.storage.sync.set({ reading: { theme: 'system', typeface: 'serif', size: 21, width: 'narrow' } });
      await new Promise((r) => setTimeout(r, 0));
    });
    const region = root.querySelector('.segments') as HTMLElement;
    expect(region.dataset.typeface).toBe('serif');
    expect(region.style.getPropertyValue('--reading-size')).toBe('21px');
    expect(region.style.getPropertyValue('--reading-measure')).toBe('34em');
    expect(f.calls).toEqual([]);
    expect(sent).toBe(0);
    // The same block, untouched: the change went through the region's CSS, not a new render of the blocks.
    watch.disconnect();
    expect(root.querySelector(`[data-id="${p1.id}"]`)).toBe(before);
    // (The list's one Tab stop is set again on each of its renders: tabindex and data-roving are not the block's content.)
    const drawn = changes.filter((c) => !(c.type === 'attributes' && (c.attributeName === 'tabindex' || c.attributeName === 'data-roving')));
    expect(drawn.map((c) => `${c.type}:${c.attributeName ?? ''}`)).toEqual([]);
    await browser.storage.sync.remove('reading');
  });

  it('a 2px progress bar while running, gone at once when done; the live region says start, failures and done', async () => {
    const f = mountJob(jobView([[p1, { status: 'final', text: 'x', revision: 1 }]]));
    const bar = root.querySelector('[role=progressbar]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('1');
    expect(bar?.getAttribute('aria-valuemax')).toBe('4');
    const live = () => root.querySelector('[data-testid=job-live]');
    expect(root.querySelector('[data-testid=job]')?.getAttribute('role')).toBe('status');
    expect(live()?.textContent).toBe('Translating into Vietnamese… 1 of 4');
    // The progress sentence is for screen readers only on the page view: the bar shows it.
    expect(live()?.classList.contains('sr-only')).toBe(true);
    await f.j.push(jobView([[p2, { status: 'failed', error: { kind: 'rate_limit', message: '429' } }]], { status: 'done', counts: { total: 4, final: 3, failed: 1 }, endedAt: 2001 }));
    expect(root.querySelector('[role=progressbar]')).toBeNull();
    expect(live()?.textContent).toBe('Vietnamese · 3 of 4 · 1 failed · 2.0 s');
    // A failure is something to say: it stays in view, with its Retry.
    const say = root.querySelector('[data-testid=job] .job__say');
    expect(say?.textContent).toContain('1 failed');
    expect(say?.querySelector('[data-testid=retry-failed]')).not.toBeNull();
  });

  it('the page line in the Translation popover carries the model, blocks, time and cost', async () => {
    mountJob(jobView([], { status: 'done', counts: { total: 4, final: 4, failed: 0 }, endedAt: 3001, cost: 0.0072 }));
    expect(root.querySelector('[data-testid=page-line]')?.textContent).toBe('Model gemini-3.5-flash-lite · 4 of 4 blocks · 3.0 s · $0.0072');
    expect(root.querySelector('[data-testid=translation-popover]')?.contains(root.querySelector('[data-testid=job-cost]'))).toBe(true);
  });

  it('Escape in a popover closes only the popover while the shortcut list is open', async () => {
    mountJob(jobView([], { status: 'done', counts: { total: 4, final: 4, failed: 0 } }));
    document.body.append(root);
    await act(() => root.querySelector<HTMLButtonElement>('[data-testid=more-button]')?.click());
    await act(() => root.querySelector<HTMLButtonElement>('[data-testid=shortcuts-button]')?.click());
    expect(root.querySelector('[data-testid=shortcuts]')).not.toBeNull();
    await act(() => root.querySelector<HTMLButtonElement>('[data-testid=translation-button]')?.click());
    const popover = root.querySelector<HTMLElement>('[data-testid=translation-popover]') as HTMLElement;
    expect(popover.hidden).toBe(false);
    await act(() => void document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(popover.hidden).toBe(true);
    expect(root.querySelector('[data-testid=shortcuts]')).not.toBeNull();
    expect(document.activeElement).toBe(root.querySelector('[data-testid=translation-button]'));
    // Escape in the More menu closes only the menu too.
    await act(() => root.querySelector<HTMLButtonElement>('[data-testid=more-button]')?.click());
    expect(root.querySelector<HTMLElement>('[data-testid=more-menu]')?.hidden).toBe(false);
    await act(() => void document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(root.querySelector<HTMLElement>('[data-testid=more-menu]')?.hidden).toBe(true);
    expect(root.querySelector('[data-testid=shortcuts]')).not.toBeNull();
    expect(document.activeElement).toBe(root.querySelector('[data-testid=more-button]'));
    // A second Escape, now outside any popover, closes the list.
    await act(() => void document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(root.querySelector('[data-testid=shortcuts]')).toBeNull();
  });

  it('About this document: collapsed, shows genre, audience, purpose, tone and key terms as text (plan M2 §2)', async () => {
    const f = mountJob(jobView([]));
    expect(root.querySelector('[data-testid=about]')).toBeNull();
    const brief = {
      genre: 'technical blog post',
      audience: 'Rust developers',
      purpose: 'explain lazy futures',
      tone: '<b>dry</b>',
      glossary: [
        { term: 'future', rendering: 'future', note: 'keep English' },
        { term: 'executor', rendering: 'bộ thực thi' },
      ],
    };
    await f.j.push(jobView([], { brief, sourceLang: 'en' }));
    const about = root.querySelector('[data-testid=about]') as HTMLDetailsElement;
    expect(about.open).toBe(false);
    expect(about.querySelector('summary')?.textContent).toBe('About this document');
    const field = (k: string) => about.querySelector(`[data-field=${k}]`)?.textContent;
    expect(field('genre')).toBe('technical blog post');
    expect(field('audience')).toBe('Rust developers');
    expect(field('purpose')).toBe('explain lazy futures');
    expect(field('tone')).toBe('<b>dry</b>');
    expect(about.querySelector('b')).toBeNull();
    // The key terms are a definition list: the term, then its rendering and note.
    expect([...about.querySelectorAll('[data-field=glossary] > div')].map((d) => d.textContent)).toEqual(['future · keep English', 'executor → bộ thực thi']);
    expect(about.textContent).toContain('LanguageEnglish');
    // Empty fields are left out.
    await f.j.push(jobView([], { brief: { ...brief, audience: '', glossary: [] }, sourceLang: '' }));
    expect(field('audience')).toBeUndefined();
    expect(root.querySelector('[data-field=glossary]')).toBeNull();
    expect(root.querySelector('[data-testid=about]')?.textContent).not.toContain('Language');
  });

  it('a page already in the target language shows the skip note and Translate anyway (plan M2 criterion 6)', () => {
    const f = mountJob(jobView([], { status: 'skipped', counts: { total: 0, final: 0, failed: 0 }, detection: { lang: 'vi', via: 'detector', confidence: 0.98 }, cost: undefined }));
    const note = root.querySelector('[data-testid=job-skipped]')?.textContent;
    expect(note).toBe('This page is already in Vietnamese, so it was not translated (language detection on this device).');
    expect(shown(p1)).toBe('Read the docs.');
    act(() => (root.querySelector('[data-testid=job] button') as HTMLButtonElement).click());
    expect(f.calls).toEqual(['resume']);
  });

  it('a stopped job offers the fix: settings for the key, Grant access for the host permission', async () => {
    const f = mountJob(jobView([], { status: 'stopped', stopError: uiError('auth', 'Add your Gemini API key in settings', 'noKey', ['Gemini']) }));
    expect(root.querySelector('[data-testid=job]')?.textContent).toContain('Add your Gemini API key in settings');
    act(() => (root.querySelector('[data-testid=job] button') as HTMLButtonElement).click());
    await f.j.push(jobView([], { status: 'stopped', stopError: { kind: 'cors', cause: 'permission', message: 'No access to generativelanguage.googleapis.com' } }));
    act(() => (root.querySelector('[data-testid=job] button') as HTMLButtonElement).click());
    expect(f.calls).toEqual(['options', 'grant']);
  });
});

describe('shortcut list (M5-E10)', () => {
  it('More › Keyboard shortcuts opens the list; Esc closes it and returns focus to the More button', async () => {
    mount({ kind: 'idle' } as PanelView);
    document.body.append(root);
    // The list opens from the More menu, so the menu's trigger says the list is open and takes focus back.
    const button = root.querySelector<HTMLButtonElement>('[data-testid="more-button"]') as HTMLButtonElement;
    expect(root.querySelector('[data-testid="shortcuts"]')).toBeNull();
    await act(() => button.click());
    await act(() => root.querySelector<HTMLButtonElement>('[data-testid="shortcuts-button"]')?.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe('shortcuts');
    expect(root.querySelector('[data-testid="shortcuts"]')?.textContent).toContain('Alt+T');
    expect(root.querySelector('[data-testid="shortcuts"]')?.textContent).toContain('Retranslate this block');
    await act(() => void root.querySelector('[data-testid="shortcuts"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(root.querySelector('[data-testid="shortcuts"]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});

