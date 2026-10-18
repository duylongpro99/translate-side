import type { ComponentChildren, ComponentProps } from 'preact';

export type IconButtonProps = Omit<ComponentProps<'button'>, 'aria-label' | 'title' | 'aria-pressed'> & {
  /** Required: it becomes the accessible name, and the tooltip unless `title` says more. */
  label: string;
  title?: string | undefined;
  /** A toggle's state; leave it out for a plain action. */
  pressed?: boolean | undefined;
  children: ComponentChildren;
};

/** A 32×32 hit area around an icon. */
export function IconButton({ label, title, pressed, class: cls, className, type = 'button', children, ...rest }: IconButtonProps) {
  return (
    <button type={type} class={['ui-icon-button', cls, className].filter(Boolean).join(' ')} aria-label={label} title={title ?? label} {...(pressed === undefined ? {} : { 'aria-pressed': pressed })} {...rest}>
      {children}
    </button>
  );
}
