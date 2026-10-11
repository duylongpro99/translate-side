import { SHORTCUTS } from '@/shared/shortcuts';

/** The panel's keyboard shortcuts (plan M5-E10), as the same list the options page and the README show. */
export function ShortcutList({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <section id={id} class="shortcuts" aria-labelledby={`${id}-h`} data-testid="shortcuts">
      <h2 id={`${id}-h`}>Keyboard shortcuts</h2>
      <dl>
        {SHORTCUTS.map((s) => (
          <div key={s.keys}>
            <dt>
              <kbd>{s.keys}</kbd>
            </dt>
            <dd>{s.what}</dd>
          </div>
        ))}
      </dl>
      <p class="panel__meta">The letters and arrows work while a block or one of its buttons has focus. Tab reaches the list once; the arrows move through it.</p>
      <button type="button" class="panel__action" data-testid="shortcuts-close" onClick={onClose}>
        Close
      </button>
    </section>
  );
}
