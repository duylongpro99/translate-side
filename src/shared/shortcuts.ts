// The shortcuts a user can find in the panel, on the options page and in the README (plan M5-E10,
// DESIGN.md §3). One list, so the three cannot drift apart. The panel's keys act only while a
// block (or one of its buttons) has keyboard focus, so they cannot clash with a page's or Chrome's
// own shortcuts, and no key is taken from a text field (WCAG 2.1.4, character key shortcuts).
import { i18n } from '#i18n';

export interface Shortcut {
  /** Keys, as shown. */
  keys: string;
  what: string;
  /** Where it works. */
  scope: 'browser' | 'block';
}

/** The list in the reader's language. The first row is the toggle (toggle-shortcut.ts `toggleRow` words it for the assigned key). */
export const shortcutList = (): readonly Shortcut[] => [
  { keys: 'Alt+T', what: i18n.t('options.shortcuts.rowToggle'), scope: 'browser' },
  { keys: i18n.t('options.shortcuts.keysNext'), what: i18n.t('options.shortcuts.rowNext'), scope: 'block' },
  { keys: i18n.t('options.shortcuts.keysPrevious'), what: i18n.t('options.shortcuts.rowPrevious'), scope: 'block' },
  { keys: 'Home / End', what: i18n.t('options.shortcuts.rowEnds'), scope: 'block' },
  { keys: 'O', what: i18n.t('options.shortcuts.rowOriginal'), scope: 'block' },
  { keys: 'R', what: i18n.t('options.shortcuts.rowRetranslate'), scope: 'block' },
  { keys: 'E', what: i18n.t('options.shortcuts.rowExplain'), scope: 'block' },
  { keys: 'C', what: i18n.t('options.shortcuts.rowCopy'), scope: 'block' },
  { keys: 'Esc', what: i18n.t('options.shortcuts.rowEscape'), scope: 'block' },
];

/** Said under the list in the panel, on the options page and in the README. */
export const screenReaderNote = (): string => i18n.t('options.shortcuts.screenReader');
