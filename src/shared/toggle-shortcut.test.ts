import { describe, expect, it } from 'vitest';
import { openShortcutSettings, readToggleShortcut, SHORTCUT_SETTINGS_URL, toggleRow } from './toggle-shortcut.ts';

type Api = Parameters<typeof readToggleShortcut>[0];
const commands = (all: Array<{ name: string; shortcut?: string }>) => ({ commands: { getAll: () => Promise.resolve(all) } }) as unknown as Api;

describe('the toggle key actually assigned', () => {
  it('reads the _execute_action key', async () => {
    expect(await readToggleShortcut(commands([{ name: 'other', shortcut: 'Ctrl+K' }, { name: '_execute_action', shortcut: 'Alt+Shift+T' }]))).toBe('Alt+Shift+T');
  });
  it("is '' when Chrome left it unset (another extension has it)", async () => {
    expect(await readToggleShortcut(commands([{ name: '_execute_action', shortcut: '' }]))).toBe('');
    expect(await readToggleShortcut(commands([{ name: '_execute_action' }]))).toBe('');
  });
  it('is undefined when Chrome cannot say', async () => {
    expect(await readToggleShortcut(commands([]))).toBeUndefined();
    expect(await readToggleShortcut({} as Api)).toBeUndefined();
  });
  it('words the first row for each case', () => {
    expect(toggleRow('Alt+Shift+T').keys).toBe('Alt+Shift+T');
    expect(toggleRow(undefined).keys).toBe('Alt+T');
    const unset = toggleRow('');
    expect(unset.keys).toBe('Not set');
    expect(unset.what).toContain(SHORTCUT_SETTINGS_URL);
  });
  it('opens the shortcut page in a tab, and says when Chrome refuses', async () => {
    const urls: string[] = [];
    expect(await openShortcutSettings({ tabs: { create: (o: { url: string }) => (urls.push(o.url), Promise.resolve({})) } } as never)).toBe(true);
    expect(urls).toEqual([SHORTCUT_SETTINGS_URL]);
    expect(await openShortcutSettings({ tabs: { create: () => Promise.reject(new Error('no')) } } as never)).toBe(false);
  });
});
