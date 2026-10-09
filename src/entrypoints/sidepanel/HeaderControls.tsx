import type { StyleMode } from '@/engine/types';
import { languageLabel } from '@/engine/index';
import { LANGUAGES, STYLES, type Preferences } from '@/shared/settings';
import type { JobActions } from './JobBar.tsx';
import type { JobView } from './jobs.ts';
import { ModelSwitcher } from './ModelSwitcher.tsx';
import type { SwitcherState } from './switcher.ts';

// The page controls in the panel header (plan M3-E6, DESIGN §3): the language pair with a
// target-language switch, the quick switcher for this tab's model (M4-E11),
// the style mode, and Cancel / Retranslate page. Settings and the scroll-follow toggle sit in the
// header's first row (App.tsx).

export const STYLE_LABELS: Record<StyleMode, string> = { natural: 'Natural', faithful: 'Faithful', simplified: 'Simplified' };
const STYLE_TITLES: Record<StyleMode, string> = {
  natural: 'Reads like it was written in your language',
  faithful: 'Closer to the source wording',
  simplified: 'Easier reading: shorter sentences, plain words',
};

export interface HeaderControlsProps {
  job: JobView | undefined;
  prefs: Preferences | undefined;
  /** The routed translate model (§4.3.5), until the job's own client names it. */
  routedModel?: string | undefined;
  actions: JobActions | undefined;
  /** The quick switcher (M4-E11); without it the model's name is shown. */
  switcher?: { state: SwitcherState | undefined; onChoose(profileId: string | undefined): void; onMakeDefault(profileId: string): void; error?: string | undefined } | undefined;
  /** Writes the switch to the settings; the page is translated again under them (translator.ts refresh). */
  onPrefs(patch: Partial<Preferences>): void;
  /** A switch that could not be saved (it was put back). */
  error?: string | undefined;
}

export function HeaderControls({ job, prefs, routedModel, actions, switcher, onPrefs, error }: HeaderControlsProps) {
  const target = prefs?.targetLang ?? job?.targetLang ?? '';
  const source = job?.sourceLang ?? '';
  const languages = LANGUAGES.some((l) => l.code === target) || target === '' ? LANGUAGES : [{ code: target, name: languageLabel(target) }, ...LANGUAGES];
  const style = prefs?.style ?? 'natural';
  const model = job?.model || routedModel || '';
  const running = job?.status === 'running';
  return (
    <div class="panel__controls" data-testid="header-controls">
      <span class="panel__pair" data-testid="lang-pair">
        <span class="panel__source" data-testid="source-lang" title={source ? `From ${languageLabel(source)}` : 'Source language: detected'}>
          {source ? source.toUpperCase() : 'Auto'}
        </span>
        <span aria-hidden="true">→</span>
        <select class="panel__select" data-testid="target-lang" aria-label="Translate into" value={target} disabled={!prefs} onChange={(e) => onPrefs({ targetLang: (e.currentTarget as HTMLSelectElement).value })}>
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </span>
      <ModelSwitcher state={switcher?.state} model={model} onChoose={switcher?.onChoose ?? (() => {})} onMakeDefault={switcher?.onMakeDefault ?? (() => {})} error={switcher?.error} />
      <select class="panel__select" data-testid="style-mode" aria-label="Style" title={STYLE_TITLES[style]} value={style} disabled={!prefs} onChange={(e) => onPrefs({ style: (e.currentTarget as HTMLSelectElement).value as StyleMode })}>
        {STYLES.map((s) => (
          <option key={s} value={s} title={STYLE_TITLES[s]}>
            {STYLE_LABELS[s]}
          </option>
        ))}
      </select>
      {actions && job ? (
        running ? (
          <button type="button" class="panel__action" data-testid="page-cancel" onClick={actions.cancel}>
            Cancel
          </button>
        ) : (
          <button type="button" class="panel__action" data-testid="page-retranslate" title="Translate the whole page again, skipping saved translations" onClick={actions.retranslatePage}>
            ↻ Retranslate page
          </button>
        )
      ) : null}
      {error ? (
        <p class="panel__error" role="alert" data-testid="prefs-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
