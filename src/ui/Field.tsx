import type { ComponentChildren, VNode } from 'preact';
import { useId } from 'preact/hooks';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
}

export interface FieldProps {
  label: ComponentChildren;
  help?: ComponentChildren;
  /** Renders the control with the id the label points at and the help text's id. */
  children: (control: FieldControlProps) => VNode;
}

/** A label, a control and help text the control is described by. */
export function Field({ label, help, children }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div class="ui-field">
      <label class="ui-field__label" for={id}>
        {label}
      </label>
      {children(help === undefined ? { id } : { id, 'aria-describedby': helpId })}
      {help !== undefined && (
        <p class="ui-field__help" id={helpId}>
          {help}
        </p>
      )}
    </div>
  );
}
