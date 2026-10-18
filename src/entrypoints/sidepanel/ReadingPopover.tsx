import { useEffect, useRef } from 'preact/hooks';
import type { browser } from 'wxt/browser';
import { i18n } from '#i18n';
import { READING_SIZE_MAX, READING_SIZE_MIN, updateReading, type Reading, type ReadingTheme, type ReadingTypeface, type ReadingWidth } from '@/shared/reading';
import { useReading } from '@/ui/use-reading';
import { Popover } from '@/ui/Popover';
import { Segmented } from '@/ui/Segmented';

type Browser = typeof browser;

const THEMES: readonly ReadingTheme[] = ['system', 'light', 'paper', 'dark'];
const WIDTHS: readonly ReadingWidth[] = ['narrow', 'medium', 'full'];
const TYPEFACES: readonly ReadingTypeface[] = ['serif', 'sans'];

/**
 * `Aa` in the header: the reading settings. Each change is written at once (its own sync item,
 * never `prefs`), so nothing is translated again.
 */
export function ReadingPopover({ api, inert }: { api: Browser; inert?: boolean }) {
  const reading = useReading(api);
  const save = (patch: Partial<Reading>) => void updateReading(api, patch).catch(() => undefined);
  // The size the last click asked for, so two quick clicks are two steps even before storage answers.
  const size = useRef(reading.size);
  useEffect(() => {
    size.current = reading.size;
  }, [reading.size]);
  const step = (by: number) => {
    const next = Math.min(READING_SIZE_MAX, Math.max(READING_SIZE_MIN, size.current + by));
    if (next === size.current) return;
    size.current = next;
    save({ size: next });
  };
  const label = i18n.t('panel.reading.title');
  return (
    <Popover
      label={label}
      testId="reading-popover"
      trigger={(p) => (
        <button type="button" class="ui-icon-button panel__aa" aria-label={label} title={label} data-testid="reading-button" inert={inert} {...p}>
          Aa
        </button>
      )}
    >
      <h2 class="pop__title">{label}</h2>
      <div class="pop__field">
        <span class="pop__label" id="reading-size-label">
          {i18n.t('panel.reading.size')}
        </span>
        <div class="stepper" role="group" aria-labelledby="reading-size-label">
          <button type="button" class="ui-button" data-testid="reading-smaller" aria-label={i18n.t('panel.reading.smaller')} aria-disabled={reading.size <= READING_SIZE_MIN} onClick={() => step(-1)}>
            A−
          </button>
          <output data-testid="reading-size" aria-live="polite">
            {reading.size}
          </output>
          <button type="button" class="ui-button" data-testid="reading-larger" aria-label={i18n.t('panel.reading.larger')} aria-disabled={reading.size >= READING_SIZE_MAX} onClick={() => step(1)}>
            A+
          </button>
        </div>
      </div>
      <Segmented
        legend={i18n.t('panel.reading.typeface')}
        name="reading-typeface"
        testId="reading-typeface"
        value={reading.typeface}
        onChange={(typeface) => save({ typeface })}
        options={TYPEFACES.map((t) => ({ value: t, label: i18n.t(`panel.reading.typefaces.${t}`), style: { fontFamily: t === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)' } }))}
      />
      <Segmented legend={i18n.t('panel.reading.width')} name="reading-width" testId="reading-width" value={reading.width} onChange={(width) => save({ width })} options={WIDTHS.map((w) => ({ value: w, label: i18n.t(`panel.reading.widths.${w}`) }))} />
      <Segmented legend={i18n.t('panel.reading.theme')} name="reading-theme" testId="reading-theme" value={reading.theme} onChange={(theme) => save({ theme })} options={THEMES.map((t) => ({ value: t, label: i18n.t(`panel.reading.themes.${t}`) }))} />
    </Popover>
  );
}
