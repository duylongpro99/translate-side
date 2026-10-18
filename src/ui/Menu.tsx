import type { ComponentChildren, VNode } from 'preact';
import { useCallback, useEffect, useId, useRef, useState } from 'preact/hooks';
import { type TriggerProps, useOutsidePress } from './overlay.ts';

export interface MenuItem {
  key: string;
  label: ComponentChildren;
  onSelect(): void;
  disabled?: boolean;
  /** A toggle's state: the item becomes a menuitemcheckbox. */
  checked?: boolean;
  testId?: string;
}

export type MenuEntry = MenuItem | 'separator';

export interface MenuProps {
  /** The menu's accessible name. */
  label: string;
  trigger: (props: TriggerProps & { 'aria-haspopup': 'menu' }) => VNode;
  items: readonly MenuEntry[];
  testId?: string;
}

/**
 * A menu of actions. Arrow keys and Home/End move through the items, Enter or Space runs one.
 * Escape closes it and gives focus back to the trigger; Tab and a press outside close it. No typeahead.
 */
export function Menu({ label, trigger, items, testId }: MenuProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);
  const closeOutside = useCallback(() => close(false), [close]);
  useOutsidePress(open, anchor, closeOutside);

  const enabled = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not([disabled])') ?? [])];
  useEffect(() => {
    if (open) enabled()[0]?.focus();
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    const all = enabled();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const move = (i: number) => {
      e.preventDefault();
      all[(i + all.length) % all.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at < 0 ? -1 : at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(-1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') close(false);
  };

  return (
    <span class="ui-popover-anchor" ref={anchor}>
      {trigger({ ref: button, 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': id, onClick: () => (open ? close(true) : setOpen(true)) })}
      <ul id={id} ref={list} role="menu" aria-label={label} class="ui-menu" hidden={!open} onKeyDown={onKeyDown} data-testid={testId}>
        {items.map((item, i) =>
          item === 'separator' ? (
            <li key={`sep-${i}`} role="separator" class="ui-menu__sep" />
          ) : (
            <li key={item.key} role="none">
              <button
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                {...(item.checked === undefined ? {} : { 'aria-checked': item.checked })}
                tabIndex={-1}
                class="ui-menu__item"
                disabled={item.disabled}
                data-testid={item.testId}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ),
        )}
      </ul>
    </span>
  );
}
