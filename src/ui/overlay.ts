// What Popover and Menu share: the trigger's props, and closing on a press outside.
import type { Ref } from 'preact';
import { useEffect } from 'preact/hooks';

export interface TriggerProps {
  ref: Ref<HTMLButtonElement>;
  'aria-expanded': boolean;
  'aria-controls': string;
  onClick(): void;
}

/** While `open`, a pointer press outside `container` calls `close`. */
export function useOutsidePress(open: boolean, container: { current: HTMLElement | null }, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent | MouseEvent) => {
      if (container.current && !container.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [open, container, close]);
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The first element Tab reaches in `root`; in a radio group that is the checked radio when there is one. */
export function firstStop(root: HTMLElement): HTMLElement | null {
  const first = root.querySelector<HTMLElement>(FOCUSABLE);
  if (first instanceof HTMLInputElement && first.type === 'radio' && first.name) {
    return root.querySelector<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(first.name)}"]:checked`) ?? first;
  }
  return first;
}
