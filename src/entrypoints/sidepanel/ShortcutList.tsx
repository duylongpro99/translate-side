import { browser } from 'wxt/browser';
import { i18n } from '#i18n';
import { SCREEN_READER_NOTE, SHORTCUTS } from '@/shared/shortcuts';
import { openShortcutSettings, toggleRow, useToggleShortcut } from '@/shared/toggle-shortcut';

/** The panel's keyboard shortcuts (plan M5-E10), as the same list the options page and the README show. */
export function ShortcutList({ id, onClose }: { id: string; onClose: () => void }) {
  const shortcut = useToggleShortcut(browser);
  const rows = SHORTCUTS.map((s, i) => (i === 0 ? { ...s, ...toggleRow(shortcut) } : s));
  return (
    <section id={id} class="shortcuts" aria-labelledby={`${id}-h`} data-testid="shortcuts">
      <h2 id={`${id}-h`}>{i18n.t('panel.shortcuts.title')}</h2>
      <dl>
        {rows.map((s, i) => (
          <div key={i}>
            <dt>
              <kbd>{s.keys}</kbd>
            </dt>
            <dd>{s.what}</dd>
          </div>
        ))}
      </dl>
      <p class="panel__meta">{i18n.t('panel.shortcuts.note')}</p>
      <p class="panel__meta">{SCREEN_READER_NOTE}</p>
      <button type="button" class="panel__action" data-testid="shortcut-settings" onClick={() => void openShortcutSettings(browser)}>
        {i18n.t('panel.shortcuts.changeKey')}
      </button>{' '}
      <button type="button" class="panel__action" data-testid="shortcuts-close" onClick={onClose}>
        {i18n.t('panel.shortcuts.close')}
      </button>
    </section>
  );
}
