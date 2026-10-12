import type { StyleMode } from '@/engine/types';
import { i18n } from '#i18n';
import { languageName } from '@/shared/language-name';
import { LANGUAGES, STYLES, type Preferences } from '@/shared/settings';
import type { JobActions } from './JobBar.tsx';
import type { JobView } from './jobs.ts';
import { ModelSwitcher } from './ModelSwitcher.tsx';
import type { SwitcherState } from './switcher.ts';

// The page controls in the panel header (plan M3-E6, DESIGN §3): the language pair with a
// target-language switch, the quick switcher for this tab's model (M4-E11),
// the style mode, and Cancel / Retranslate page. Settings and the scroll-follow toggle sit in the
// header's first row (App.tsx).

const styleLabel = (style: StyleMode) => i18n.t(`panel.controls.style.${style}`);
const styleTitle = (style: StyleMode) => i18n.t(`panel.controls.styleTitle.${style}`);

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
  const languages = LANGUAGES.some((l) => l.code === target) || target === '' ? LANGUAGES : [{ code: target, name: languageName(target) }, ...LANGUAGES];
  const style = prefs?.style ?? 'natural';
  const model = job?.model || routedModel || '';
  const running = job?.status === 'running';
  return (
    <div class="panel__controls" data-testid="header-controls">
      <span class="panel__pair" data-testid="lang-pair">
        <span class="panel__source" data-testid="source-lang" title={source ? i18n.t('panel.controls.from', [languageName(source)]) : i18n.t('panel.controls.sourceDetected')}>
          {source ? source.toUpperCase() : i18n.t('panel.controls.auto')}
        </span>
        <span aria-hidden="true">→</span>
        <select class="panel__select" data-testid="target-lang" aria-label={i18n.t('panel.controls.translateInto')} value={target} disabled={!prefs} onChange={(e) => onPrefs({ targetLang: (e.currentTarget as HTMLSelectElement).value })}>
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {languageName(l.code)}
            </option>
          ))}
        </select>
      </span>
      <ModelSwitcher state={switcher?.state} model={model} onChoose={switcher?.onChoose ?? (() => {})} onMakeDefault={switcher?.onMakeDefault ?? (() => {})} error={switcher?.error} />
      <select class="panel__select" data-testid="style-mode" aria-label={i18n.t('panel.controls.styleLabel')} title={styleTitle(style)} value={style} disabled={!prefs} onChange={(e) => onPrefs({ style: (e.currentTarget as HTMLSelectElement).value as StyleMode })}>
        {STYLES.map((s) => (
          <option key={s} value={s} title={styleTitle(s)}>
            {styleLabel(s)}
          </option>
        ))}
      </select>
      {actions && job ? (
        running ? (
          <button type="button" class="panel__action" data-testid="page-cancel" onClick={actions.cancel}>
            {i18n.t('panel.controls.cancel')}
          </button>
        ) : (
          <button type="button" class="panel__action" data-testid="page-retranslate" title={i18n.t('panel.controls.retranslatePageTitle')} onClick={actions.retranslatePage}>
            {i18n.t('panel.controls.retranslatePage')}
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
