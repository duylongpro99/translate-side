import type { ComponentProps } from 'preact';

export type NoticeTone = 'info' | 'warn' | 'danger';

export type NoticeProps = ComponentProps<'div'> & { tone?: NoticeTone };

/** A flat tinted block. `info` is a polite status; `warn` and `danger` are alerts. */
export function Notice({ tone = 'info', class: cls, className, ...rest }: NoticeProps) {
  return <div role={tone === 'info' ? 'status' : 'alert'} class={['ui-notice', `ui-notice--${tone}`, cls, className].filter(Boolean).join(' ')} {...rest} />;
}
