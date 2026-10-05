import { describe, expect, it, vi } from 'vitest';
import { CONTEXT_MENU_ID, setupContextMenu, setupPanelBehavior } from './panel.ts';

type Api = Parameters<typeof setupPanelBehavior>[0];

describe('setupPanelBehavior', () => {
  it('opens the panel on action click when the API exists', async () => {
    const setPanelBehavior = vi.fn().mockResolvedValue(undefined);
    const api = { sidePanel: { setPanelBehavior } } as unknown as Api;
    expect(await setupPanelBehavior(api)).toBe(true);
    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it('is gated by availability, not version', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await setupPanelBehavior({} as Api)).toBe(false);
  });
});

describe('setupContextMenu', () => {
  it('creates the stub entry and opens the panel for the clicked tab window', () => {
    let onClicked: ((info: { menuItemId: string }, tab?: { windowId: number }) => void) | undefined;
    const create = vi.fn();
    const open = vi.fn().mockResolvedValue(undefined);
    const api = {
      contextMenus: { create, onClicked: { addListener: (fn: typeof onClicked) => (onClicked = fn) } },
      sidePanel: { open },
    } as unknown as Api;
    setupContextMenu(api);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ id: CONTEXT_MENU_ID }));
    onClicked?.({ menuItemId: 'other' }, { windowId: 1 });
    expect(open).not.toHaveBeenCalled();
    onClicked?.({ menuItemId: CONTEXT_MENU_ID }, { windowId: 7 });
    expect(open).toHaveBeenCalledWith({ windowId: 7 });
  });
});
