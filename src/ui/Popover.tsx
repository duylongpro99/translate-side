import type { ComponentChildren, VNode } from 'preact';
import { useCallback, useEffect, useId, useRef, useState } from 'preact/hooks';
import { firstStop, type TriggerProps, useOutsidePress } from './overlay.ts';

export interface PopoverProps {
  /** The dialog's accessible name. */
  label: string;
  /** Renders the button that opens it, with the props it needs. */
  trigger: (props: TriggerProps) => VNode;
  /** Which edge of the trigger it lines up with. */
  align?: 'start' | 'end';
  onOpenChange?(open: boolean): void;
  testId?: string;
  children: ComponentChildren;
}

/**
 * A non-modal dialog under its trigger. Opening focuses its first control (or the dialog, when it
 * has none). Escape, a second press
 * of the trigger and a press outside close it; Escape and the trigger give focus back to the
 * trigger. Tab or Shift+Tab out of it closes it and lets focus move on. Its content stays
 * mounted while closed (hidden), so its controls keep their state.
 */
export function Popover({ label, trigger, align = 'end', onOpenChange, testId, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  // The state as of now, for handlers that outlive a render (an outside press reported twice, a Tab check after the move).
  const isOpen = useRef(false);
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const change = useCallback(
    (next: boolean, refocus: boolean) => {
      if (isOpen.current === next) return;
      isOpen.current = next;
      setOpen(next);
      onOpenChange?.(next);
      if (!next && refocus) button.current?.focus();
    },
    [onOpenChange],
  );
  const closeOutside = useCallback(() => change(false, false), [change]);
  useOutsidePress(open, anchor, closeOutside);

  // Its first tab stop (in a radio group, the checked radio), or the dialog itself when nothing in it
  // can take focus, so Escape still reaches it.
  useEffect(() => {
    if (open && panel.current) (firstStop(panel.current) ?? panel.current).focus();
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      change(false, true);
      return;
    }
    // Tab past the last stop or Shift+Tab before the first: the browser moves focus (a radio group
    // is one stop, so the check is where focus went, not which control it left); then it closes.
    if (e.key === 'Tab') {
      setTimeout(() => {
        if (isOpen.current && !panel.current?.contains(document.activeElement)) change(false, false);
      }, 0);
    }
  };

  return (
    <span class="ui-popover-anchor" ref={anchor}>
      {trigger({ ref: button, 'aria-expanded': open, 'aria-controls': id, onClick: () => change(!open, open) })}
      <div id={id} ref={panel} role="dialog" aria-label={label} tabIndex={-1} class={`ui-popover ui-popover--${align}`} hidden={!open} onKeyDown={onKeyDown} data-testid={testId}>
        {children}
      </div>
    </span>
  );
}
