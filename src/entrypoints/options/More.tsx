import type { ComponentChildren } from 'preact';
import { i18n } from '#i18n';

/**
 * A long explanation folded under its field: the full text is kept, only behind "More about this".
 * Never used for text that says where data goes or how keys are kept (NEVER_FOLD in Options.test.tsx).
 */
export function More({ children }: { children: ComponentChildren }) {
  return (
    <details class="opt__more">
      <summary>{i18n.t('options.more')}</summary>
      {children}
    </details>
  );
}
