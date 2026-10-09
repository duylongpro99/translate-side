import { useEffect, useRef, useState } from 'preact/hooks';
import type { SwitcherState } from './switcher.ts';

// The quick switcher in the panel header (DESIGN.md §3, §4.3.3 B, plan M4-E11): the model profiles
// to translate this tab with. A choice applies to this tab only and the routing stays as it was,
// until "Make default". A site rule wins over it (§4.3.5), so a page one covers says so instead.

export interface ModelSwitcherProps {
  state: SwitcherState | undefined;
  /** The model the job (or the route) names, while the switcher's own state is still being read. */
  model: string;
  /** undefined = back to the default model. */
  onChoose(profileId: string | undefined): void;
  onMakeDefault(profileId: string): void;
  error?: string | undefined;
}

const DEFAULT_VALUE = '';
const options = (state: SwitcherState, id: string) => state.options.find((o) => o.id === id)?.model ?? id;

export function ModelSwitcher({ state, model, onChoose, onMakeDefault, error }: ModelSwitcherProps) {
  const rule = state?.rule;
  // Said aloud only when the choice changes, not for the model the panel opens with.
  const choice = state ? `${state.tabId ?? ''}|${state.defaultId ?? ''}` : undefined;
  const seen = useRef<string | undefined>(undefined);
  const [announce, setAnnounce] = useState(false);
  useEffect(() => {
    if (choice === undefined) return;
    if (seen.current !== undefined && seen.current !== choice) setAnnounce(true);
    seen.current = choice;
  }, [choice]);
  if (rule) {
    return (
      <span class="panel__model panel__model--rule" data-slot="quick-switcher" data-testid="header-model" title={`The site rule for ${rule.pattern} sets the model, so a tab choice would not apply`}>
        {rule.model}
        <span class="panel__rule" data-testid="switcher-site-rule">
          {' '}
          · site rule {rule.pattern}
          {rule.localOnly ? ' (local only)' : ''}
        </span>
      </span>
    );
  }
  if (!state || state.options.length <= 1) {
    return (
      <span class="panel__model" data-slot="quick-switcher" data-testid="header-model" title={model ? `Model: ${model}` : 'Model'}>
        {model}
      </span>
    );
  }
  const current = state.currentId;
  const overridden = state.tabId !== undefined && state.tabId !== state.defaultId;
  const defaultOption = state.options.find((o) => o.id === state.defaultId);
  return (
    <span class="panel__model panel__switcher" data-slot="quick-switcher" data-testid="header-model">
      <select
        class="panel__select"
        data-testid="model-switcher"
        aria-label="Translate this tab with"
        title="Applies to this tab only. Your default stays the same."
        aria-describedby={overridden ? 'switcher-note' : undefined}
        value={overridden ? state.tabId : DEFAULT_VALUE}
        onChange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          onChoose(v === DEFAULT_VALUE ? undefined : v);
        }}
      >
        <option value={DEFAULT_VALUE}>{defaultOption ? `${defaultOption.model} (default)` : (model || 'Default model')}</option>
        {state.options
          .filter((o) => o.id !== state.defaultId)
          .map((o) => (
            <option key={o.id} value={o.id} disabled={!o.usable && o.id !== current}>
              {o.model} · {o.connection}
              {o.local ? ' · local' : ''}
              {o.usable ? '' : ' · no key'}
            </option>
          ))}
      </select>
      {overridden && current ? (
        <>
          <span id="switcher-note" class="panel__tabonly" data-testid="switcher-tab-only">
            This tab only
          </span>
          <button type="button" class="panel__action" data-testid="make-default" aria-describedby="switcher-note" title="Use this model for every page from now on" onClick={() => onMakeDefault(current)}>
            Make default
          </button>
        </>
      ) : null}
      {/* Said aloud when a switch lands: the page below changes, not the focus. */}
      <span class="panel__sr" role="status" aria-live="polite" data-testid="switcher-live">
        {!announce ? '' : overridden && current ? `This tab now translates with ${options(state, current)}, this tab only.` : `This tab translates with ${defaultOption?.model ?? model}, the default.`}
      </span>
      {error ? (
        <span class="panel__error" role="alert" data-testid="switcher-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
