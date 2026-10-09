// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, GLOSSARY_KEY, SYNC_QUOTA_BYTES_PER_ITEM, syncItemBytes } from '@/shared/settings';
import { PERSONAL_GLOSSARY_PROMPT_TOKENS, personalGlossaryTokens } from '@/engine/context/budget';
import { openTranslationCache, type TranslationCache } from '@/shared/cache';
import { monthKey } from '@/shared/spend';
import { Options } from './Options.tsx';

type Api = Parameters<typeof Options>[0]['api'];

function fakeApi({ grant = true, answer = Promise.resolve() } = {}) {
  const local = new Map<string, unknown>();
  const sync = new Map<string, unknown>();
  const granted = new Set<string>();
  const log: string[] = [];
  const area = (m: Map<string, unknown>, name: string) => {
    const listeners = new Set<(c: Record<string, unknown>) => void>();
    return {
      get: (k: string | null) => Promise.resolve(k === null ? Object.fromEntries(m) : m.has(k) ? { [k]: m.get(k) } : {}),
      set: (o: Record<string, unknown>) => {
        log.push(`${name}.set ${Object.keys(o).join(',')}`);
        for (const [k, v] of Object.entries(o)) m.set(k, v);
        listeners.forEach((l) => l(Object.fromEntries(Object.keys(o).map((k) => [k, {}]))));
        return Promise.resolve();
      },
      remove: (k: string) => Promise.resolve(void m.delete(k)),
      onChanged: { addListener: (l: (c: Record<string, unknown>) => void) => listeners.add(l), removeListener: (l: (c: Record<string, unknown>) => void) => listeners.delete(l) },
    };
  };
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
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await act(async () => new Promise((r) => setTimeout(r, 10)));
  }
};
const flush = () => act(async () => new Promise((r) => setTimeout(r, 10)));

describe('options: languages (plan M1-E9)', () => {
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
    expect(f.sync.get('prefs')).toEqual({ targetLang: 'vi', sourceLang: 'de', style: 'natural', gloss: 'first', budgetTokens: 400000 });
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
    expect(f.sync.get('prefs')).toEqual({ targetLang: 'vi', sourceLang: 'auto', style: 'simplified', gloss: 'off', budgetTokens: 400000 });
    expect(root.querySelector('[data-testid=style-hint]')?.textContent).toContain('Short sentences');
  });

  it('stores the token budget per page in sync prefs (plan M2-E7): a whole number of tokens, 0 for no limit', async () => {
    const f = fakeApi();
    act(() => render(<Options api={f.api} />, root));
    await flush();
    expect((root.querySelector('#budget') as HTMLInputElement).value).toBe('400000');
    choose('#budget', '150000.4');
    await flush();
    expect(f.sync.get('prefs')).toMatchObject({ budgetTokens: 150000 });
    choose('#budget', '0');
    await flush();
    expect(f.sync.get('prefs')).toMatchObject({ budgetTokens: 0 });
    choose('#budget', '-5');
    await flush();
    expect(f.sync.get('prefs')).toMatchObject({ budgetTokens: 400000 });
    // An emptied field is the default, not 0 = no limit (review D-N7).
    choose('#budget', '0');
    await flush();
    choose('#budget', '');
    await flush();
    expect(f.sync.get('prefs')).toMatchObject({ budgetTokens: 400000 });
    expect((root.querySelector('#budget') as HTMLInputElement).value).toBe('400000');
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

describe('options: translation cache (plan M3-E2)', () => {
  it('shows what the cache holds and clears it', async () => {
    const cache = openTranslationCache({ factory: new IDBFactory() }) as TranslationCache;
    await cache.putMany(new Map([['a', { text: 'A', revision: 1, attempt: 1 }], ['b', { text: 'B', revision: 1, attempt: 1 }]]));
    await cache.putBrief('k', { genre: 'g', audience: 'a', purpose: 'p', tone: 't', glossary: [] });
    act(() => render(<Options api={fakeApi().api} cache={cache} />, root));
    await waitFor(() => /^2 translated/.test(root.querySelector('[data-testid=cache-stats]')?.textContent ?? ''));
    expect(root.querySelector('[data-testid=cache-stats]')?.textContent).toMatch(/^2 translated blocks and 1 document briefs, \d+ KB of 50\.0 MB/);
    act(() => (root.querySelector('[data-testid=cache-clear]') as HTMLButtonElement).click());
    await waitFor(() => /^0 translated blocks/.test(root.querySelector('[data-testid=cache-stats]')?.textContent ?? ''));
    expect(root.querySelector('[data-testid=cache-stats]')?.textContent).toMatch(/^0 translated blocks and 0 document briefs/);
    expect((await cache.stats()).entries).toBe(0);
  });

  it('has no cache section where the browser has no IndexedDB', async () => {
    act(() => render(<Options api={fakeApi().api} cache={undefined} />, root));
    await flush();
    expect(root.querySelector('#cache-h')).toBeNull();
  });
});

describe('usage and cost (plan M3-E9)', () => {
  it('shows the routed model’s price, the running total and this month, and resets it', async () => {
    const f = fakeApi();
    const now = Date.now();
    f.local.set('spend', { since: now - 86_400_000, usd: 0.1234, input: 12000, cachedInput: 2000, output: 3400, unpricedTokens: 50, months: { [monthKey(now)]: 0.05 } });
    act(() => render(<Options api={f.api} cache={undefined} />, root));
    await waitFor(() => root.querySelector('[data-testid=spend-tokens]') !== null);
    expect(root.querySelector('[data-testid=spend-price]')?.textContent).toContain(`${DEFAULT_PROFILE.model}: $0.032 input`);
    expect(root.querySelector('[data-testid=spend-total]')?.textContent).toContain('$0.12');
    expect(root.querySelector('[data-testid=spend-total]')?.textContent).toContain('this month $0.0500');
    expect(root.querySelector('[data-testid=spend-tokens]')?.textContent).toContain('12,000 input tokens (2,000 cached), 3,400 output tokens · 50 tokens on models without a price');
    act(() => (root.querySelector('[data-testid=spend-reset]') as HTMLButtonElement).click());
    await waitFor(() => root.querySelector('[data-testid=spend-total]')?.textContent === 'Nothing spent yet.');
    expect(f.local.has('spend')).toBe(false);
  });

  it('shows the new route’s price as soon as Providers saves it (tester C1 #8)', async () => {
    const f = fakeApi();
    act(() => render(<Options api={f.api} cache={undefined} />, root));
    await waitFor(() => root.querySelector('[data-testid=spend-price]')?.textContent?.includes(DEFAULT_PROFILE.model) === true);
    const conn = { id: 'c1', label: 'Work', presetId: 'custom-openai', protocol: 'openai-chat', baseUrl: 'https://gw.example.com/v1', auth: { style: 'none' }, quirks: {}, status: 'ok' };
    const prof = { id: 'p1', connectionId: 'c1', model: 'work-model', maxConcurrency: 2, chunkTokens: 1200, pricing: { inPerM: 1, cachedInPerM: 0.5, outPerM: 2 } };
    await act(async () => {
      await f.api.storage.sync.set({ schemaVersion: 1, 'conn:c1': conn, 'profile:p1': prof, routing: { translate: 'p1' } });
    });
    await waitFor(() => root.querySelector('[data-testid=spend-price]')?.textContent?.startsWith('work-model: $1') === true);
  });
});
