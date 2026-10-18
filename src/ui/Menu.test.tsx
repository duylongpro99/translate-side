// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Menu } from './Menu.tsx';

let root: HTMLDivElement;
const trigger = () => root.querySelector<HTMLButtonElement>('[data-testid="more"]') as HTMLButtonElement;
const menu = () => root.querySelector<HTMLElement>('[role="menu"]') as HTMLElement;
const item = (id: string) => root.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`) as HTMLButtonElement;
const key = async (k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  await act(() => void (document.activeElement ?? document.body).dispatchEvent(e));
  return e;
};
const run = { settings: vi.fn(), help: vi.fn(), close: vi.fn() };

// Unmount, so an open overlay of an earlier test does not keep its document listeners.
afterEach(() => render(null, root));

beforeEach(async () => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
  Object.values(run).forEach((f) => f.mockClear());
  await act(() =>
    render(
      <Menu
        label="More"
        trigger={(p) => <button type="button" data-testid="more" {...p}>…</button>}
        items={[
          { key: 'settings', label: 'Settings', onSelect: run.settings, testId: 'i-settings' },
          { key: 'off', label: 'Unavailable', onSelect: vi.fn(), disabled: true, testId: 'i-off' },
          { key: 'help', label: 'Shortcuts', onSelect: run.help, checked: false, testId: 'i-help' },
          'separator',
          { key: 'close', label: 'Close panel', onSelect: run.close, testId: 'i-close' },
        ]}
      />,
      root,
    ),
  );
});

describe('Menu', () => {
  it('names a menu trigger and links it, with menuitem roles and a checkbox item', () => {
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-controls')).toBe(menu().id);
    expect(menu().getAttribute('aria-label')).toBe('More');
    expect(item('i-settings').getAttribute('role')).toBe('menuitem');
    expect(item('i-help').getAttribute('role')).toBe('menuitemcheckbox');
    expect(item('i-help').getAttribute('aria-checked')).toBe('false');
    expect(menu().hidden).toBe(true);
  });

  it('focuses the first item on open; arrows wrap and skip disabled items; Home and End jump', async () => {
    await act(() => trigger().click());
    expect(menu().hidden).toBe(false);
    expect(document.activeElement).toBe(item('i-settings'));
    expect((await key('ArrowDown')).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(item('i-help'));
    await key('ArrowDown');
    expect(document.activeElement).toBe(item('i-close'));
    await key('ArrowDown');
    expect(document.activeElement).toBe(item('i-settings'));
    await key('ArrowUp');
    expect(document.activeElement).toBe(item('i-close'));
    await key('Home');
    expect(document.activeElement).toBe(item('i-settings'));
    await key('End');
    expect(document.activeElement).toBe(item('i-close'));
  });

  it('runs an item, closes, and gives focus back to the trigger', async () => {
    await act(() => trigger().click());
    await act(() => item('i-close').click());
    expect(run.close).toHaveBeenCalledTimes(1);
    expect(menu().hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on Escape, stops it there, and gives focus back to the trigger', async () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    await act(() => trigger().click());
    const e = await key('Escape');
    document.removeEventListener('keydown', outer);
    expect(menu().hidden).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on Tab and on a press outside, without running anything', async () => {
    await act(() => trigger().click());
    await key('Tab');
    expect(menu().hidden).toBe(true);
    await act(() => trigger().click());
    await act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(menu().hidden).toBe(true);
    expect(Object.values(run).every((f) => f.mock.calls.length === 0)).toBe(true);
  });

  it('a second press of the trigger closes it', async () => {
    await act(() => trigger().click());
    await act(() => trigger().click());
    expect(menu().hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });
});
