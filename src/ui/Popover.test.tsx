// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Popover } from './Popover.tsx';
import { Segmented } from './Segmented.tsx';

let root: HTMLDivElement;
const trigger = () => root.querySelector<HTMLButtonElement>('[data-testid="open"]') as HTMLButtonElement;
const dialog = () => root.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement;
const key = async (k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  await act(() => void (document.activeElement ?? document.body).dispatchEvent(e));
  return e;
};
const onOpenChange = vi.fn();

// Unmount, so an open overlay of an earlier test does not keep its document listeners.
afterEach(() => render(null, root));

beforeEach(async () => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
  onOpenChange.mockClear();
  await act(() =>
    render(
      <div>
        <Popover label="Reading settings" onOpenChange={onOpenChange} trigger={(p) => <button type="button" data-testid="open" {...p}>Aa</button>}>
          <button type="button" data-testid="first">Smaller</button>
          <input data-testid="mid" />
          <button type="button" data-testid="last">Larger</button>
        </Popover>
        <button type="button" data-testid="after">after</button>
      </div>,
      root,
    ),
  );
});

describe('Popover', () => {
  it('links trigger and dialog, keeps the content mounted while closed, and labels the dialog', () => {
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-controls')).toBe(dialog().id);
    expect(dialog().getAttribute('aria-label')).toBe('Reading settings');
    expect(dialog().hidden).toBe(true);
    expect(root.querySelector('[data-testid="mid"]')).not.toBeNull();
  });

  it('opens on the trigger, focuses its first control, and a second press closes it with focus on the trigger', async () => {
    await act(() => trigger().click());
    expect(dialog().hidden).toBe(false);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(root.querySelector('[data-testid="first"]'));
    await act(() => trigger().click());
    expect(dialog().hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it('closes on Escape, stops it there, and gives focus back to the trigger', async () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    await act(() => trigger().click());
    const e = await key('Escape');
    document.removeEventListener('keydown', outer);
    expect(dialog().hidden).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
  });

  // jsdom does not move focus on Tab: each test moves it where the browser would, then lets the check run.
  const tabTo = async (to: HTMLElement, shiftKey = false) => {
    const e = await key('Tab', { shiftKey });
    await act(async () => {
      to.focus();
      await new Promise((r) => setTimeout(r, 5));
    });
    return e;
  };

  it('closes when Tab leaves it past the last control, and when Shift+Tab leaves it before the first, without taking focus back', async () => {
    await act(() => trigger().click());
    root.querySelector<HTMLElement>('[data-testid="last"]')?.focus();
    const tab = await tabTo(root.querySelector('[data-testid="after"]') as HTMLElement);
    expect(tab.defaultPrevented).toBe(false);
    expect(dialog().hidden).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('[data-testid="after"]'));

    await act(() => trigger().click());
    await tabTo(trigger(), true);
    expect(dialog().hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });

  it('stays open for Tab between its own controls', async () => {
    await act(() => trigger().click());
    await tabTo(root.querySelector('[data-testid="mid"]') as HTMLElement);
    expect(dialog().hidden).toBe(false);
  });

  it('with radio groups first and last: opens on the checked radio, and Tab out of the last group closes it', async () => {
    await act(() =>
      render(
        <div>
          <Popover label="Reading" trigger={(p) => <button type="button" data-testid="open" {...p}>Aa</button>}>
            <Segmented legend="Typeface" name="tf" value="sans" onChange={() => undefined} options={[{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }]} />
            <Segmented legend="Theme" name="th" value="paper" onChange={() => undefined} options={[{ value: 'light', label: 'Light' }, { value: 'paper', label: 'Paper' }, { value: 'dark', label: 'Dark' }]} />
          </Popover>
          <button type="button" data-testid="after">after</button>
        </div>,
        root,
      ),
    );
    await act(() => trigger().click());
    expect((document.activeElement as HTMLInputElement).value).toBe('sans');
    root.querySelector<HTMLInputElement>('input[name="th"][value="paper"]')?.focus();
    await tabTo(root.querySelector('[data-testid="after"]') as HTMLElement);
    expect(dialog().hidden).toBe(true);
  });

  it('reports one close for an outside press seen twice (pointer and mouse)', async () => {
    await act(() => trigger().click());
    await act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it('closes on a press outside, but not on one inside', async () => {
    await act(() => trigger().click());
    await act(() => void root.querySelector('[data-testid="mid"]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(dialog().hidden).toBe(false);
    await act(() => void root.querySelector('[data-testid="after"]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(dialog().hidden).toBe(true);
  });

  it('focuses the dialog itself when it holds no control, so Escape still closes it', async () => {
    await act(() => render(<Popover label="Empty" trigger={(p) => <button type="button" data-testid="open" {...p}>x</button>}><p>Nothing to press</p></Popover>, root));
    await act(() => trigger().click());
    expect(document.activeElement).toBe(dialog());
    await key('Escape');
    expect(dialog().hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });
});
