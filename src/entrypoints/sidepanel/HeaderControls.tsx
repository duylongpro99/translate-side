import { useEffect, useState } from 'preact/hooks';
import type { StyleMode } from '@/engine/types';
import { i18n } from '#i18n';
import { featureAvailable } from '@/shared/features';
import { BEST_MODE_RELEASED, QUALITY_MODES, type Quality, type QualityMode, type QualityStrategy } from '@/shared/quality';
import { languageName } from '@/shared/language-name';
import { LANGUAGES, ON_DEVICE_CONNECTION, STYLES, type Preferences } from '@/shared/settings';
import { formatUsd } from '@/shared/cost';
import { ArrowRightIcon, ChevronDownIcon, SlidersIcon } from '@/ui/icons';
import { Popover } from '@/ui/Popover';
import { Select } from '@/ui/Select';
import type { JobView } from './jobs.ts';
import { ModelSwitcher, SwitcherNotices } from './ModelSwitcher.tsx';
import type { SwitcherState } from './switcher.ts';

// The page controls in the panel header (plan M3-E6, DESIGN §3): the language pair with a
// target-language switch, and the Translation popover with the style mode, the quality, the quick
// switcher for this tab's model (M4-E11) and the page line. The icons on the right of the row
// (reading settings, scroll follow, retranslate or stop, More) are App.tsx's.

const styleLabel = (style: StyleMode) => i18n.t(`panel.controls.style.${style}`);
const styleTitle = (style: StyleMode) => i18n.t(`panel.controls.styleTitle.${style}`);

const qualityLabel = (mode: QualityMode) => i18n.t(`panel.controls.quality.${mode}`);
const strategyLabel = (strategy: QualityStrategy) =>
  strategy === 'single-pass' ? i18n.t('options.quality.strategySinglePass') : strategy === 'contextual' ? i18n.t('options.quality.strategyContextual') : i18n.t('options.quality.strategyRefine');
const qualityTitle = (quality: Quality) => (quality.strategy ? i18n.t('panel.controls.qualityOverride', [strategyLabel(quality.strategy)]) : i18n.t(`panel.controls.qualityTitle.${quality.mode}`));

/**
 * Whether Best may be chosen, for display only: the job decides for itself when it starts
 * (jobs.ts). Available until the answer says otherwise, so the select does not flash a lock.
 */
function useBestAvailable(): boolean {
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    if (!BEST_MODE_RELEASED) return;
    let live = true;
    featureAvailable('best-mode').then(
      (ok) => live && setAvailable(ok),
      () => live && setAvailable(false),
    );
    return () => {
      live = false;
    };
  }, []);
  return available;
}

export interface HeaderControlsProps {
  job: JobView | undefined;
  prefs: Preferences | undefined;
  /** The routed translate model (§4.3.5), until the job's own client names it. */
  routedModel?: string | undefined;
  /** The quality setting; the select is shown once it is read. */
  quality?: Quality | undefined;
  /** The quick switcher (M4-E11); without it the model's name is shown. */
  switcher?: { state: SwitcherState | undefined; onChoose(profileId: string | undefined): void; onMakeDefault(profileId: string): void; error?: string | undefined } | undefined;
  /** Writes the switch to the settings; the page is translated again under them (translator.ts refresh). */
  onPrefs(patch: Partial<Preferences>): void;
  /** Writes a quality switch; choosing a mode clears the advanced override. */
  onQuality?(patch: Partial<Quality>): void;
  /** A switch that could not be saved (it was put back). */
  error?: string | undefined;
  /** While the privacy notice waits: the popover's trigger takes no focus or click. */
  inert?: boolean;
}

/** The page line in the Translation popover: model, blocks, time and, when a price is set, the cost. */
function PageLine({ job, model }: { job: JobView | undefined; model: string }) {
  if (!job && !model) return null;
  const parts: string[] = [];
  if (model) parts.push(i18n.t('panel.header.page.model', [model]));
  if (job) parts.push(i18n.t('panel.header.page.blocks', [String(job.counts.final), String(job.counts.total)]));
  // The on-device route (Chrome's own models): where the text goes, which is nowhere.
  if (job?.connection?.id === ON_DEVICE_CONNECTION.id) parts.push(i18n.t('panel.header.page.onDevice'));
  if (job?.endedAt !== undefined) parts.push(i18n.t('panel.job.seconds', [((job.endedAt - job.startedAt) / 1000).toFixed(1)]));
  return (
    <p class="pop__meta" data-testid="page-line">
      {parts.join(' · ')}
      {job?.cost !== undefined ? (
        <>
          {' · '}
          <span class="job__cost" data-testid="job-cost" title={i18n.t('panel.job.costTitle', [String(job.usage.input), String(job.usage.cachedInput), String(job.usage.output)])}>
            {formatUsd(job.cost)}
            {job.unmetered > 0 ? <span class="job__cost-note"> · {i18n.t('panel.job.excludesCancelled')}</span> : null}
          </span>
        </>
      ) : null}
    </p>
  );
}

const lockNote = (
  <span id="quality-lock-note" class="panel__tabonly" data-testid="quality-lock-note">
    {i18n.t('panel.controls.qualityLocked')}
  </span>
);

/**
 * The left of the header's control row: the language pair and the Translation button, whose popover
 * holds the style, the quality, the model and the page line.
 */
export function HeaderControls({ job, prefs, routedModel, switcher, quality, onPrefs, onQuality, inert }: HeaderControlsProps) {
  const bestAvailable = useBestAvailable();
  const target = prefs?.targetLang ?? job?.targetLang ?? '';
  const source = job?.sourceLang ?? '';
  const languages = LANGUAGES.some((l) => l.code === target) || target === '' ? LANGUAGES : [{ code: target, name: languageName(target) }, ...LANGUAGES];
  const style = prefs?.style ?? 'natural';
  const model = job?.model || routedModel || '';
  const locked = BEST_MODE_RELEASED && !bestAvailable;
  // A locked Best that is still the stored choice is said in the notice strip (HeaderNotices), where it is always seen.
  const lockedPicked = locked && quality?.mode === 'best';
  return (
    <div class="panel__controls" data-testid="header-controls">
      <span class="panel__pair" data-testid="lang-pair">
        <span class="panel__source" data-testid="source-lang" title={source ? i18n.t('panel.controls.from', [languageName(source)]) : i18n.t('panel.controls.sourceDetected')}>
          {source ? source.toUpperCase() : i18n.t('panel.controls.auto')}
        </span>
        <span class="panel__arrow">
          <ArrowRightIcon size={12} />
        </span>
        <Select quiet wrapClass="panel__target" data-testid="target-lang" aria-label={i18n.t('panel.controls.translateInto')} value={target} disabled={!prefs} onChange={(e) => onPrefs({ targetLang: (e.currentTarget as HTMLSelectElement).value })}>
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {languageName(l.code)}
            </option>
          ))}
        </Select>
      </span>
      <Popover
        label={i18n.t('panel.header.translation')}
        align="start"
        testId="translation-popover"
        trigger={(p) => (
          <button type="button" class="ui-button ui-button--quiet panel__translation" data-testid="translation-button" aria-label={i18n.t('panel.header.translationButton', [styleLabel(style)])} title={i18n.t('panel.header.translationTitle')} inert={inert} {...p}>
            <span class="panel__translation-label">{styleLabel(style)}</span>
            <ChevronDownIcon size={12} />
            {/* In a narrow panel the button is this icon alone; its name still says the style. */}
            <span class="panel__translation-icon">
              <SlidersIcon />
            </span>
          </button>
        )}
      >
        <h2 class="pop__title">{i18n.t('panel.header.translation')}</h2>
        <label class="pop__field">
          <span class="pop__label">{i18n.t('panel.controls.styleLabel')}</span>
          <Select data-testid="style-mode" aria-label={i18n.t('panel.controls.styleLabel')} title={styleTitle(style)} value={style} disabled={!prefs} onChange={(e) => onPrefs({ style: (e.currentTarget as HTMLSelectElement).value as StyleMode })}>
            {STYLES.map((s) => (
              <option key={s} value={s} title={styleTitle(s)}>
                {styleLabel(s)}
              </option>
            ))}
          </Select>
        </label>
        {quality && onQuality ? (
          <label class="pop__field" data-testid="quality-control">
            <span class="pop__label">{i18n.t('panel.controls.qualityLabel')}</span>
            <Select
              data-testid="quality-mode"
              aria-label={i18n.t('panel.controls.qualityLabel')}
              title={qualityTitle(quality)}
              aria-describedby={locked ? 'quality-lock-note' : undefined}
              value={quality.mode === 'best' && !BEST_MODE_RELEASED ? 'balanced' : quality.mode}
              onChange={(e) => onQuality({ mode: (e.currentTarget as HTMLSelectElement).value as QualityMode, strategy: undefined })}
            >
              {QUALITY_MODES.filter((m) => m !== 'best' || BEST_MODE_RELEASED).map((m) => (
                <option key={m} value={m} title={i18n.t(`panel.controls.qualityTitle.${m}`)} disabled={m === 'best' && !bestAvailable}>
                  {m === 'best' && !bestAvailable ? i18n.t('panel.controls.proOption', [qualityLabel(m)]) : qualityLabel(m)}
                </option>
              ))}
            </Select>
            {locked && !lockedPicked ? lockNote : null}
          </label>
        ) : null}
        <div class="pop__field">
          <span class="pop__label">{i18n.t('panel.switcher.label')}</span>
          <ModelSwitcher state={switcher?.state} model={model} onChoose={switcher?.onChoose ?? (() => {})} onMakeDefault={switcher?.onMakeDefault ?? (() => {})} />
        </div>
        <PageLine job={job} model={model} />
      </Popover>
    </div>
  );
}

/**
 * The notice strip under the header row: what must stay in view, never inside a popover. The site
 * rule, a failed model switch and its live region, a locked Best that is still chosen, and a
 * setting that could not be saved.
 */
export function HeaderNotices({ job, routedModel, switcher, quality, error }: Pick<HeaderControlsProps, 'job' | 'routedModel' | 'switcher' | 'quality' | 'error'>) {
  const bestAvailable = useBestAvailable();
  const lockedPicked = BEST_MODE_RELEASED && !bestAvailable && quality?.mode === 'best';
  const model = job?.model || routedModel || '';
  return (
    <div class="panel__notices" data-testid="header-notices">
      <SwitcherNotices state={switcher?.state} model={model} error={switcher?.error} />
      {lockedPicked ? <p class="panel__notice">{lockNote}</p> : null}
      {error ? (
        <p class="panel__notice panel__notice--danger" role="alert" data-testid="prefs-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
