// The shortcuts a user can find in the panel, on the options page and in the README (plan M5-E10,
// DESIGN.md §3). One list, so the three cannot drift apart. The panel's keys act only while a
// block (or one of its buttons) has keyboard focus, so they cannot clash with a page's or Chrome's
// own shortcuts, and no key is taken from a text field (WCAG 2.1.4, character key shortcuts).

export interface Shortcut {
  /** Keys, as shown. */
  keys: string;
  what: string;
  /** Where it works. */
  scope: 'browser' | 'block';
}

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: 'Alt+T', what: 'Open the panel, or close it when it is open (rebind it at chrome://extensions/shortcuts)', scope: 'browser' },
  { keys: '↓ or J', what: 'Next block', scope: 'block' },
  { keys: '↑ or K', what: 'Previous block', scope: 'block' },
  { keys: 'Home / End', what: 'First / last block', scope: 'block' },
  { keys: 'O', what: 'Show or hide the original under this block', scope: 'block' },
  { keys: 'R', what: 'Retranslate this block', scope: 'block' },
  { keys: 'E', what: 'Explain this block', scope: 'block' },
  { keys: 'C', what: 'Copy this block as plain text', scope: 'block' },
  { keys: 'Esc', what: 'Close the shortcut list', scope: 'block' },
];
