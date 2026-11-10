import { describe, expect, it, vi } from 'vitest';
import { boundTabId, openTabPanel } from './tab-panel.ts';

type Api = Parameters<typeof openTabPanel>[0];

describe('openTabPanel', () => {
  it("enables the tab's own panel and opens it in the same tick, with nothing awaited before open (S12)", () => {
    const calls: string[] = [];
    const api = {
      sidePanel: {
        setOptions: (o: { tabId: number; path: string; enabled: boolean }) => (calls.push(`options:${o.tabId}:${o.path}:${o.enabled}`), new Promise(() => undefined)),
        open: (o: { tabId: number }) => (calls.push(`open:${o.tabId}`), Promise.resolve()),
      },
    } as unknown as Api;
    void openTabPanel(api, 12);
    // setOptions never settles here: open must not wait for it.
    expect(calls).toEqual(['options:12:sidepanel.html?tab=12:true', 'open:12']);
  });

  it('rejects when the panel did not open, and only logs a failed setOptions', async () => {
    const api = {
      sidePanel: {
        setOptions: () => Promise.reject(new Error('options')),
        open: () => Promise.reject(new Error('no gesture')),
      },
    } as unknown as Api;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(openTabPanel(api, 3)).rejects.toThrow('no gesture');
    await Promise.resolve();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('boundTabId', () => {
  it('reads the tab a panel serves from its query', () => {
    expect(boundTabId('?tab=42')).toBe(42);
  });

  it('is undefined when absent or not a tab id', () => {
    for (const search of ['', '?tab=', '?tab=0', '?tab=-3', '?tab=1.5', '?tab=abc', '?tab=99999999999999999999']) expect(boundTabId(search)).toBeUndefined();
  });
});
