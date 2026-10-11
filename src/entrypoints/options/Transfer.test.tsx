// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { saveApiKey, readApiKey } from '@/shared/settings';
import { saveConnection } from '@/shared/providers';
import { EXPORT_FORMAT } from '@/shared/portable';
import { TransferSection } from './Transfer.tsx';

type Api = Parameters<typeof TransferSection>[0]['api'];

function fakeApi() {
  const local = new Map<string, unknown>();
  const sync = new Map<string, unknown>();
  const area = (m: Map<string, unknown>) => ({
    get: (k: string | string[] | null) => Promise.resolve(k === null ? Object.fromEntries(m) : Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => m.has(x)).map((x) => [x, m.get(x)]))),
    set: (o: Record<string, unknown>) => (Object.entries(o).forEach(([k, v]) => m.set(k, v)), Promise.resolve()),
    remove: (k: string | string[]) => Promise.resolve(void [k].flat().forEach((x) => m.delete(x))),
  });
  return { api: { storage: { local: area(local), sync: area(sync) }, i18n: { getUILanguage: () => 'en-US' } } as unknown as Api, local, sync };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await act(() => new Promise((r) => setTimeout(r, 0)));
};
let root: HTMLElement;
const q = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement;
const click = async (id: string) => {
  await act(() => q(id).click());
  await flush();
};

let downloaded: string[];
beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
  downloaded = [];
  URL.createObjectURL = ((b: Blob) => (b.text().then((t) => downloaded.push(t)), 'blob:x')) as never;
  URL.revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = () => undefined;
});

const gw = { id: 'gw', label: 'GW', presetId: 'custom', protocol: 'openai-chat', baseUrl: 'https://llm.example.com/v1', auth: { style: 'bearer' }, quirks: {}, status: 'unverified' };

describe('TransferSection', () => {
  it('exports without keys until the user ticks include keys and confirms', async () => {
    const t = fakeApi();
    await saveConnection(t.api, gw as never);
    await saveApiKey(t.api, 'gw', 'sk-SECRET');
    render(<TransferSection api={t.api} />, root);
    await click('export');
    expect(downloaded[0]).toContain('"gw"');
    expect(downloaded[0]).not.toContain('SECRET');
    expect(q('export-note').textContent).toContain('no API keys');

    await act(() => q('include-keys').click());
    expect(q('keys-confirm')).toBeTruthy();
    expect((q('export') as HTMLButtonElement).disabled).toBe(true);
    await click('keys-confirm-yes');
    await click('export');
    expect(downloaded[1]).toContain('sk-SECRET');
  });

  it('cancelling the confirmation unticks include keys', async () => {
    const t = fakeApi();
    render(<TransferSection api={t.api} />, root);
    await act(() => q('include-keys').click());
    await click('keys-confirm-no');
    expect((q('include-keys') as HTMLInputElement).checked).toBe(false);
    expect(q('keys-confirm')).toBeNull();
  });

  const pick = async (text: string) => {
    const input = q('import-file') as HTMLInputElement;
    const file = new File([text], 'in.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(() => void input.dispatchEvent(new Event('change', { bubbles: true })));
    await flush();
  };

  it('shows what a file would change, imports on confirm, and takes keys only when ticked', async () => {
    const t = fakeApi();
    render(<TransferSection api={t.api} />, root);
    await pick(JSON.stringify({ format: EXPORT_FORMAT, formatVersion: 1, settings: { connections: [gw] }, keys: { gw: 'sk-IN' } }));
    expect(q('import-summary').textContent).toContain('1 new');
    expect(q('import-endpoints').textContent).toContain('llm.example.com');
    expect(t.sync.has('conn:gw')).toBe(false);
    await click('import-apply');
    expect(t.sync.has('conn:gw')).toBe(true);
    expect(await readApiKey(t.api, 'gw')).toBeUndefined();
    expect(q('import-note').textContent).toContain('keys in the file were not imported');

    await pick(JSON.stringify({ format: EXPORT_FORMAT, formatVersion: 1, settings: {}, keys: { gw: 'sk-IN' } }));
    await act(() => q('import-keys').click());
    await click('import-apply');
    expect(await readApiKey(t.api, 'gw')).toBe('sk-IN');
  });

  it('says why a file is refused, and changes nothing', async () => {
    const t = fakeApi();
    render(<TransferSection api={t.api} />, root);
    await pick('not json');
    expect(q('import-note').textContent).toContain('not valid JSON');
    expect(q('import-preview')).toBeNull();
    expect(t.sync.size).toBe(0);
  });

  it('names a connection the file points elsewhere, says its key goes, and keeps it only when ticked (B1)', async () => {
    const t = fakeApi();
    await saveConnection(t.api, gw as never);
    await saveApiKey(t.api, 'gw', 'sk-MINE');
    render(<TransferSection api={t.api} />, root);
    await pick(JSON.stringify({ format: EXPORT_FORMAT, formatVersion: 1, settings: { connections: [{ ...gw, baseUrl: 'https://evil.example/v1' }] } }));
    expect(q('import-redirect').textContent).toContain('https://evil.example/v1');
    expect(q('import-redirect').textContent).toContain('saved key for it will be removed');
    await act(() => q('import-keep-key').click());
    await flush();
    expect(q('import-redirect').textContent).toContain('stays, and will be sent');
    await click('import-apply');
    expect(await readApiKey(t.api, 'gw')).toBe('sk-MINE');
  });

  it('moves focus into the keys confirmation and back, and into the preview and back', async () => {
    const t = fakeApi();
    render(<TransferSection api={t.api} />, root);
    document.body.append(root);
    await act(() => q('include-keys').click());
    await flush();
    expect(document.activeElement).toBe(q('keys-confirm-no'));
    await click('keys-confirm-no');
    expect(document.activeElement).toBe(q('include-keys'));
    await pick(JSON.stringify({ format: EXPORT_FORMAT, formatVersion: 1, settings: { glossary: [{ term: 'a', rendering: 'b' }] } }));
    expect(q('import-preview').contains(document.activeElement)).toBe(true);
    await click('import-cancel');
    expect(document.activeElement).toBe(q('import-file'));
  });
});
