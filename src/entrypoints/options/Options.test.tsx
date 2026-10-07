// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONNECTION, DEFAULT_ORIGIN, GLOSSARY_KEY, SYNC_QUOTA_BYTES_PER_ITEM, syncItemBytes } from '@/shared/settings';
import { PERSONAL_GLOSSARY_PROMPT_TOKENS, personalGlossaryTokens } from '@/engine/context/budget';
import { Options } from './Options.tsx';

type Api = Parameters<typeof Options>[0]['api'];

function fakeApi({ grant = true, answer = Promise.resolve() } = {}) {
  const local = new Map<string, unknown>();
  const sync = new Map<string, unknown>();
  const granted = new Set<string>();
  const log: string[] = [];
  const area = (m: Map<string, unknown>, name: string) => ({
    get: (k: string) => Promise.resolve(m.has(k) ? { [k]: m.get(k) } : {}),
    set: (o: Record<string, unknown>) => {
      log.push(`${name}.set ${Object.keys(o).join(',')}`);
      for (const [k, v] of Object.entries(o)) m.set(k, v);
      return Promise.resolve();
    },
    remove: (k: string) => Promise.resolve(void m.delete(k)),
  });
  const api = {
    storage: { local: area(local, 'local'), sync: area(sync, 'sync') },
    permissions: {
      contains: ({ origins }: { origins: string[] }) => Promise.resolve(origins.every((o) => granted.has(o))),
      request: ({ origins }: { origins: string[] }) => {
        log.push(`request ${origins.join(',')}`);
        return answer.then(() => {
          if (grant) origins.forEach((o) => granted.add(o));
          return grant;
        });
      },
      remove: ({ origins }: { origins: string[] }) => Promise.resolve(origins.every((o) => granted.delete(o))),
    },
    i18n: { getUILanguage: () => 'en-US' },
  } as unknown as Api;
  return { api, local, sync, log };
}

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
});
const flush = () => act(async () => new Promise((r) => setTimeout(r, 10)));

describe('options v0 (plan M1-E9)', () => {
  it('saves the key to storage.local, asks for the provider origin (from its base URL) in the same click, and shows it masked only', async () => {
    const f = fakeApi();
    act(() => render(<Options api={f.api} />, root));
    await flush();
    expect(root.textContent).toContain('No key yet');
    const input = root.querySelector('#key') as HTMLInputElement;
    expect(input.type).toBe('password');
    act(() => {
      input.value = '  AIzaSyExampleKey1234 ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      (root.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    // The permission request comes before any await: still inside the gesture.
    expect(f.log[0]).toBe('request https://api.ai-box.vn/*');
    expect(DEFAULT_ORIGIN).toBe('https://api.ai-box.vn/*');
    await flush();
    expect(f.local.get(`secret:${DEFAULT_CONNECTION.id}`)).toBe('AIzaSyExampleKey1234');
    expect(root.querySelector('#key-h')?.textContent).toBe('APIBOX');
    expect(root.textContent).toContain('ds/deepseek-flash');
    expect(f.sync.size).toBe(0);
    expect(root.querySelector('[data-testid=masked-key]')?.textContent).toBe('AIz…1234');
    expect(root.innerHTML).not.toContain('AIzaSyExampleKey1234');
    expect(input.value).toBe('');
    expect(root.textContent).toContain('stored on this device only');
  });

  it('shows the saved key at once, while the permission prompt is still open (review E-T1)', async () => {
    let answer = () => {};
    const f = fakeApi({ answer: new Promise<void>((r) => (answer = r)) });
    act(() => render(<Options api={f.api} />, root));
    await flush();
    const input = root.querySelector('#key') as HTMLInputElement;
    act(() => {
      input.value = 'AIzaSyExampleKey1234';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      (root.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(root.querySelector('[data-testid=masked-key]')?.textContent).toBe('AIz…1234');
    expect(root.textContent).not.toContain('No key yet');
    answer();
    await flush();
    expect(root.querySelector('[role=status]')?.textContent).toBe('Saved.');
  });

  it('offers Grant access when the permission was refused', async () => {
    const f = fakeApi({ grant: false });
    f.local.set(`secret:${DEFAULT_CONNECTION.id}`, 'AIzaSyExampleKey1234');
    act(() => render(<Options api={f.api} />, root));
    await flush();
    expect(root.querySelector('[data-testid=access-status]')?.textContent).toContain('No access to api.ai-box.vn.');
  });

  it('stores the target and source languages in sync', async () => {
    const f = fakeApi();
    act(() => render(<Options api={f.api} />, root));
    await flush();
    const target = root.querySelector('#target') as HTMLSelectElement;
    expect(target.value).toBe('en');
    act(() => {
      target.value = 'vi';
      target.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const source = root.querySelector('#source') as HTMLSelectElement;
    expect(source.value).toBe('auto');
    act(() => {
      source.value = 'de';
      source.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(f.sync.get('prefs')).toEqual({ targetLang: 'vi', sourceLang: 'de', style: 'natural', gloss: 'first' });
  });
});

const input = (sel: string, value: string) =>
  act(() => {
    const el = root.querySelector(sel) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const choose = (sel: string, value: string) =>
  act(() => {
    const el = root.querySelector(sel) as HTMLSelectElement;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
const check = (sel: string, on: boolean) =>
  act(() => {
    const el = root.querySelector(sel) as HTMLInputElement;
    el.checked = on;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
const submitGlossary = () =>
  act(() => {
    (root.querySelector('[data-testid=glossary-form]') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
const click = (label: string) =>
  act(() => {
    (root.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click();
  });
const rows = () => [...root.querySelectorAll('[data-testid=glossary-entry]')].map((li) => li.textContent?.replace(/\s*Edit\s*Remove\s*$/, '').trim());

describe('options: style and personal glossary (plan M2-E6)', () => {
  it('stores the style mode and the gloss setting in sync prefs, keeping the languages (M2-D1 defaults)', async () => {
    const f = fakeApi();
    act(() => render(<Options api={f.api} />, root));
    await flush();
    expect((root.querySelector('#style') as HTMLSelectElement).value).toBe('natural');
    expect((root.querySelector('#gloss') as HTMLSelectElement).value).toBe('first');
    choose('#target', 'vi');
    choose('#style', 'simplified');
    choose('#gloss', 'off');
    await flush();
    expect(f.sync.get('prefs')).toEqual({ targetLang: 'vi', sourceLang: 'auto', style: 'simplified', gloss: 'off' });
    expect(root.querySelector('[data-testid=style-hint]')?.textContent).toContain('Short sentences');
  });

  it('adds a "keep as is" entry and a translated one, edits and removes them, saving each change to sync', async () => {
    const f = fakeApi();
    act(() => render(<Options api={f.api} />, root));
    await flush();
    expect(root.querySelector('[data-testid=glossary-empty]')).not.toBeNull();
    expect((root.querySelector('#g-keep') as HTMLInputElement).checked).toBe(true);
    expect((root.querySelector('#g-rendering') as HTMLInputElement).disabled).toBe(true);
    input('#g-term', ' deploy ');
    submitGlossary();
    await flush();
    expect(f.sync.get('glossary')).toEqual([{ term: 'deploy', rendering: 'deploy' }]);
    expect(rows()).toEqual(['deploy → keep as is']);
    expect((root.querySelector('#g-term') as HTMLInputElement).value).toBe('');

    input('#g-term', 'executor');
    check('#g-keep', false);
    input('#g-rendering', 'bộ thực thi');
    submitGlossary();
    await flush();
    expect(f.sync.get('glossary')).toEqual([
      { term: 'deploy', rendering: 'deploy' },
      { term: 'executor', rendering: 'bộ thực thi' },
    ]);
    expect(rows()).toEqual(['deploy → keep as is', 'executor → bộ thực thi']);

    click('Edit deploy');
    expect((root.querySelector('#g-term') as HTMLInputElement).value).toBe('deploy');
    check('#g-keep', false);
    input('#g-rendering', 'triển khai');
    submitGlossary();
    await flush();
    expect(rows()).toEqual(['deploy → triển khai', 'executor → bộ thực thi']);

    click('Remove executor');
    await flush();
    expect(f.sync.get('glossary')).toEqual([{ term: 'deploy', rendering: 'triển khai' }]);
  });

  it('keeps an entry\'s note when the entry is edited (review 3)', async () => {
    const f = fakeApi();
    f.sync.set('glossary', [{ term: 'executor', rendering: 'bộ thực thi', note: 'core concept' }]);
    act(() => render(<Options api={f.api} />, root));
    await flush();
    expect(rows()).toEqual(['executor → bộ thực thi · core concept']);
    click('Edit executor');
    input('#g-rendering', 'trình thực thi');
    submitGlossary();
    await flush();
    expect(f.sync.get('glossary')).toEqual([{ term: 'executor', rendering: 'trình thực thi', note: 'core concept' }]);
  });

  it('warns when the personal glossary is larger than its share of a translation request (review 6)', async () => {
    const f = fakeApi();
    const many = Array.from({ length: 30 }, (_, i) => ({ term: `term ${i}`, rendering: `${'r'.repeat(150)} ${i}` }));
    expect(personalGlossaryTokens(many)).toBeGreaterThan(PERSONAL_GLOSSARY_PROMPT_TOKENS);
    f.sync.set('glossary', many.slice(0, 3));
    act(() => render(<Options api={f.api} />, root));
    await flush();
    expect(root.querySelector('[data-testid=glossary-share]')).toBeNull();
    f.sync.set('glossary', many);
    act(() => render(null, root));
    act(() => render(<Options api={f.api} />, root));
    await flush();
    const warn = root.querySelector('[data-testid=glossary-share]')?.textContent ?? '';
    expect(warn).toContain(`of ${PERSONAL_GLOSSARY_PROMPT_TOKENS} tokens`);
    expect(warn).toContain('the entries at the end of the list are left out');
  });

  it('refuses a duplicate term and shows the quota guard\'s refusal without saving', async () => {
    const f = fakeApi();
    f.sync.set('glossary', [{ term: 'deploy', rendering: 'deploy' }]);
    act(() => render(<Options api={f.api} />, root));
    await flush();
    expect(rows()).toEqual(['deploy → keep as is']);
    input('#g-term', 'Deploy');
    submitGlossary();
    await flush();
    expect(root.querySelector('[data-testid=glossary-note]')?.textContent).toContain('already in the glossary');
    expect(f.sync.get('glossary')).toEqual([{ term: 'deploy', rendering: 'deploy' }]);

    // Fill the item close to its 8 KB quota, then one more entry is refused.
    const big = [];
    for (let i = 0; syncItemBytes(GLOSSARY_KEY, big) < SYNC_QUOTA_BYTES_PER_ITEM - 150; i++) big.push({ term: `term ${i}`, rendering: `r ${i}` });
    f.sync.set('glossary', big);
    act(() => render(null, root));
    act(() => render(<Options api={f.api} />, root));
    await flush();
    input('#g-term', 'one more term that does not fit');
    check('#g-keep', false);
    input('#g-rendering', 'y'.repeat(200));
    submitGlossary();
    await flush();
    const note = root.querySelector('[data-testid=glossary-note]')?.textContent ?? '';
    expect(note).toContain("over Chrome's sync limit of 8192 bytes");
    expect(f.sync.get('glossary')).toBe(big);
    expect(rows()).toHaveLength(big.length);
  });
});
