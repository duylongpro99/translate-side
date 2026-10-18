import type { ComponentProps } from 'preact';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Shown on the segment, e.g. a typeface sample. */
  style?: ComponentProps<'span'>['style'];
}

export interface SegmentedProps<T extends string> {
  legend: string;
  /** The radio group's name; unique on the page. */
  name: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange(value: T): void;
  testId?: string;
}

/**
 * Native radios drawn as segments, so arrow keys work as the browser makes them. Only for free
 * settings (reading settings, the theme): each arrow press is a change, and a setting that
 * starts a paid job (style, quality) stays a <select>.
 */
export function Segmented<T extends string>({ legend, name, value, options, onChange, testId }: SegmentedProps<T>) {
  return (
    <fieldset class="ui-segmented" data-testid={testId}>
      <legend>{legend}</legend>
      <div class="ui-segmented__track">
        {options.map((o) => (
          <label key={o.value} class="ui-segmented__option">
            <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
            <span style={o.style}>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
