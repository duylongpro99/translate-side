// The key that is actually assigned to the toggle (_execute_action). The manifest suggests Alt+T,
// but Chrome leaves it unset when another extension has it, and the user can rebind it at
// chrome://extensions/shortcuts, so the help shows what chrome.commands reports (M5-E10).
import { useEffect, useState } from 'preact/hooks';
import type { browser } from 'wxt/browser';

type Browser = typeof browser;

export const SHORTCUT_SETTINGS_URL = 'chrome://extensions/shortcuts';
export const TOGGLE_COMMAND = '_execute_action';

/** The assigned key; '' when none is set; undefined when Chrome cannot say (then the help shows the suggestion). */
export async function readToggleShortcut(api: Pick<Browser, 'commands'>): Promise<string | undefined> {
  try {
    const all = await api.commands.getAll();
    const command = all.find((c) => c.name === TOGGLE_COMMAND);
    return command === undefined ? undefined : (command.shortcut ?? '');
  } catch {
    return undefined;
  }
}

/** The assigned key, kept current when the user returns to the page after changing it. */
export function useToggleShortcut(api: Pick<Browser, 'commands'>): string | undefined {
  const [shortcut, setShortcut] = useState<string | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const refresh = () => void readToggleShortcut(api).then((s) => alive && setShortcut(s));
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      window.removeEventListener('focus', refresh);
    };
  }, [api]);
  return shortcut;
}

/** Opens Chrome's shortcut page in a tab (an extension may open it). False when Chrome refuses. */
export async function openShortcutSettings(api: Pick<Browser, 'tabs'>): Promise<boolean> {
  try {
    await api.tabs.create({ url: SHORTCUT_SETTINGS_URL });
    return true;
  } catch {
    return false;
  }
}

/** The first row of the list, as it should read for the assigned key. */
export function toggleRow(shortcut: string | undefined): { keys: string; what: string } {
  if (shortcut === '') return { keys: 'Not set', what: `Open the panel, or close it when it is open. Choose a key at ${SHORTCUT_SETTINGS_URL}` };
  return { keys: shortcut ?? 'Alt+T', what: 'Open the panel, or close it when it is open (change it at chrome://extensions/shortcuts)' };
}
