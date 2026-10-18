import { useEffect, useRef, useState } from 'preact/hooks';
import { i18n } from '#i18n';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import type { SwitcherState } from './switcher.ts';

// The quick switcher in the header's Translation popover (DESIGN.md §3, §4.3.3 B, plan M4-E11): the
// model profiles to translate this tab with. A choice applies to this tab only and the routing stays as it was,
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

export function ModelSwitcher({ state, model, onChoose, onMakeDefault }: Omit<ModelSwitcherProps, 'error'>) {
  const rule = state?.rule;
  if (rule) {
    // The rule is said in the notice strip (SwitcherNotices); here only its model.
    return (
      <span class="panel__model" data-slot="quick-switcher" data-testid="header-model" title={i18n.t('panel.switcher.ruleTitle', [rule.pattern])}>
        {rule.model}
      </span>
    );
  }
  if (!state || state.options.length <= 1) {
    return (
      <span class="panel__model" data-slot="quick-switcher" data-testid="header-model" title={model ? i18n.t('panel.switcher.model', [model]) : i18n.t('panel.switcher.modelBare')}>
        {model}
      </span>
    );
  }
  const current = state.currentId;
  const overridden = state.tabId !== undefined && state.tabId !== state.defaultId;
  const defaultOption = state.options.find((o) => o.id === state.defaultId);
  const chosen = overridden ? state.options.find((o) => o.id === state.tabId) : defaultOption;
  const selectedLabel = chosen ? `${chosen.model} · ${chosen.connection}` : model;
  return (
    <span class="panel__model panel__switcher" data-slot="quick-switcher" data-testid="header-model">
      <Select
        wrapClass="panel__switcher-select"
        data-testid="model-switcher"
        aria-label={i18n.t('panel.switcher.label')}
        title={i18n.t('panel.switcher.selectTitle', [selectedLabel])}
        aria-describedby={overridden ? 'switcher-note' : undefined}
        value={overridden ? state.tabId : DEFAULT_VALUE}
        onChange={(e) => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          onChoose(v === DEFAULT_VALUE ? undefined : v);
        }}
      >
        <option value={DEFAULT_VALUE}>{defaultOption ? i18n.t('panel.switcher.defaultOption', [defaultOption.model]) : model || i18n.t('panel.switcher.defaultModel')}</option>
        {state.options
          .filter((o) => o.id !== state.defaultId)
          .map((o) => (
            <option key={o.id} value={o.id} disabled={!o.usable && o.id !== current}>
              {o.model} · {o.connection}
              {o.local ? ` · ${i18n.t('panel.switcher.local')}` : ''}
              {o.usable ? '' : ` · ${i18n.t('panel.switcher.noKey')}`}
            </option>
          ))}
      </Select>
      {overridden && current ? (
        <span class="panel__tabonly-row">
          <span id="switcher-note" class="panel__tabonly" data-testid="switcher-tab-only">
            {i18n.t('panel.switcher.tabOnly')}
          </span>
          <Button variant="quiet" data-testid="make-default" aria-describedby="switcher-note" title={i18n.t('panel.switcher.makeDefaultTitle')} onClick={() => onMakeDefault(current)}>
            {i18n.t('panel.switcher.makeDefault')}
          </Button>
        </span>
      ) : null}
    </span>
  );
}

/**
 * What the switcher has to say, always visible under the header (never inside a popover): the site
 * rule that wins over a tab choice, a switch that failed, and the live region that says a switch landed.
 */
export function SwitcherNotices({ state, model, error }: Pick<ModelSwitcherProps, 'state' | 'model' | 'error'>) {
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
  const switchable = state !== undefined && !rule && state.options.length > 1;
  const current = state?.currentId;
  const overridden = state?.tabId !== undefined && state.tabId !== state.defaultId;
  const defaultOption = state?.options.find((o) => o.id === state.defaultId);
  return (
    <>
      {rule ? (
        <p class="panel__notice" data-testid="switcher-site-rule" title={i18n.t('panel.switcher.ruleTitle', [rule.pattern])}>
          {rule.model} · {i18n.t(rule.localOnly ? 'panel.switcher.ruleLocal' : 'panel.switcher.rule', [rule.pattern])}
        </p>
      ) : null}
      {switchable ? (
        /* Said aloud when a switch lands: the page below changes, not the focus. */
        <span class="sr-only" role="status" aria-live="polite" data-testid="switcher-live">
          {!announce ? '' : overridden && current ? i18n.t('panel.switcher.announceTab', [options(state, current)]) : i18n.t('panel.switcher.announceDefault', [defaultOption?.model ?? model])}
        </span>
      ) : null}
      {error ? (
        <p class="panel__notice panel__notice--danger" role="alert" data-testid="switcher-error">
          {error}
        </p>
      ) : null}
    </>
  );
}
