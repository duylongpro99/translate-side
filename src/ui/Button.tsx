import type { ComponentProps } from 'preact';

export type ButtonVariant = 'primary' | 'default' | 'quiet';

export type ButtonProps = ComponentProps<'button'> & {
  /** `primary` (accent fill) at most once per view; `default` is a hairline; `quiet` has no border. */
  variant?: ButtonVariant;
};

export function Button({ variant = 'default', class: cls, className, type = 'button', ...rest }: ButtonProps) {
  const classes = ['ui-button', variant !== 'default' && `ui-button--${variant}`, cls, className].filter(Boolean).join(' ');
  return <button type={type} class={classes} {...rest} />;
}
