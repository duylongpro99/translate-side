import type { ComponentProps } from 'preact';
import { ChevronDownIcon } from './icons.tsx';

export type SelectProps = ComponentProps<'select'> & {
  /** No border or fill until hover: for a select that sits in running text or a toolbar. */
  quiet?: boolean;
  /** A class for the wrapper (every other prop goes to the native <select>). */
  wrapClass?: string;
};

/** A native <select>, restyled. Its keyboard and screen-reader behaviour stay the browser's. */
export function Select({ quiet = false, wrapClass, ...rest }: SelectProps) {
  return (
    <span class={['ui-select', quiet && 'ui-select--quiet', wrapClass].filter(Boolean).join(' ')}>
      <select {...rest} />
      <ChevronDownIcon />
    </span>
  );
}
