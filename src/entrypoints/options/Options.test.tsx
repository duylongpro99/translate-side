// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { GEMINI_ORIGIN } from '@/shared/settings';
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
  it('saves the key to storage.local, asks for the Gemini origin in the same click, and shows it masked only', async () => {
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
    expect(f.log[0]).toBe(`request ${GEMINI_ORIGIN}`);
    await flush();
    expect(f.local.get('secret:gemini')).toBe('AIzaSyExampleKey1234');
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
    f.local.set('secret:gemini', 'AIzaSyExampleKey1234');
    act(() => render(<Options api={f.api} />, root));
    await flush();
    expect(root.querySelector('[data-testid=access-status]')?.textContent).toContain('No access to generativelanguage.googleapis.com');
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
    expect(f.sync.get('prefs')).toEqual({ targetLang: 'vi', sourceLang: 'de' });
  });
});
