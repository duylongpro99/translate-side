// Onboarding (DESIGN.md §4.3.3 C, plan M4-E13): 1 your language → 2 how to translate → 3 connect
// (the Providers connection form with its Test connection, reused as it is) and translate a sample
// paragraph. It can be skipped at any step and opened again from Settings. The sample sends a
// paragraph to the chosen provider, so the privacy notice (M3-E10) gates it: nothing goes before
// it is acknowledged, and acknowledging here is the same acknowledgement the panel keeps.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { browser } from 'wxt/browser';
import { i18n } from '#i18n';
import type { Segment } from '@/engine/index';
import { languageLabel } from '@/engine/index';
import { createAdapter } from '@/llm/client';
import { PRESETS, presetTitle, type PresetId } from '@/shared/presets';
import { markOnboarding } from '@/shared/onboarding';
import { SpendLedger } from '@/shared/spend';
import { LANGUAGES, readPreferences, updatePreferences } from '@/shared/settings';
import { Jobs, type JobView } from '../sidepanel/jobs.ts';
import { PrivacyGate, type PrivacyState } from '../sidepanel/privacy.ts';
import { routedSummary, translateClient, type Routed } from '../sidepanel/route.ts';
import { failureText } from '../sidepanel/status.ts';
import { slots } from '../sidepanel/slots.tsx';
import { ConnectionForm, load, RETEST_MS, type AdapterFor, type Loaded } from '../options/Providers.tsx';

type Browser = typeof browser;

/** What step 2 offers (§4.3.3 C): where the translation runs. */
type Path = 'key' | 'local' | 'builtin';
const CLOUD_CHOICES: readonly PresetId[] = ['anthropic', 'openai', 'gemini', 'openrouter', 'ollama-cloud', 'apibox'];
const LOCAL_CHOICES: readonly PresetId[] = ['ollama', 'lmstudio'];
const presetLabel = (id: PresetId) => {
  const preset = PRESETS.find((p) => p.id === id);
  return preset ? presetTitle(preset) : id;
};

const SAMPLES: Record<string, { lang: string; text: string }> = {
  en: { lang: 'en', text: 'The library is open late on Fridays. If you bring a book back after closing, drop it in the box by the door and it will be checked in the next morning.' },
  // A reader whose own language is English gets a sample in another one.
  other: { lang: 'es', text: 'La biblioteca abre hasta tarde los viernes. Si devuelves un libro después del cierre, déjalo en el buzón junto a la puerta y lo registrarán a la mañana siguiente.' },
};
const sampleFor = (target: string) => (target.split('-')[0] === 'en' ? SAMPLES.other : SAMPLES.en) as { lang: string; text: string };
const SAMPLE_TAB = 0;

export function Onboarding({ api, adapterFor = createAdapter, retestMs = RETEST_MS, jobs: injected, gate: injectedGate }: { api: Browser; adapterFor?: AdapterFor; retestMs?: number; jobs?: Jobs; gate?: PrivacyGate }) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [lang, setLang] = useState('');
  const [path, setPath] = useState<Path>('key');
  const [cloud, setCloud] = useState<PresetId>('anthropic');
  const [local, setLocal] = useState<PresetId>('ollama');
  const [loaded, setLoaded] = useState<Loaded | undefined>();
  const [saved, setSaved] = useState<string | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const [closed, setClosed] = useState<'done' | 'skipped' | undefined>();
  const heading = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);

  // A step change moves focus to the new step's heading, so a keyboard or screen-reader user lands on it.
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    heading.current?.focus();
  }, [step, saved === undefined, loaded !== undefined]);

  useEffect(() => {
    // What is stored (or the browser's language) is only the start: a choice already made stays.
    readPreferences(api).then((p) => setLang((cur) => cur || p.targetLang), () => setLang((cur) => cur || 'en'));
  }, [api]);

  const reload = () => load(api).then(setLoaded, () => {});
  useEffect(() => void reload(), [api]);

  const close = (status: 'done' | 'skipped') => {
    void markOnboarding(api, status).catch(() => {});
    setClosed(status);
  };

  const saveLang = async () => {
    setNote(undefined);
    try {
      await updatePreferences(api, { targetLang: lang });
      setStep(2);
    } catch (err) {
      console.error('[translate-side] onboarding: could not save the language', err);
      setNote(i18n.t('onboarding.saveLangFailed'));
    }
  };

  if (closed) {
    return (
      <main class="onb" data-testid="onboarding-closed">
        <h1>{closed === 'done' ? i18n.t('onboarding.doneTitle') : i18n.t('onboarding.skippedTitle')}</h1>
        <p>{closed === 'done' ? i18n.t('onboarding.doneText') : i18n.t('onboarding.skippedText')}</p>
        {closed === 'done' ? (
          <p class="opt__hint" data-testid="onboarding-shortcut-note">
            {i18n.t('onboarding.rebindNote', { url: 'chrome://extensions/shortcuts' })}
          </p>
        ) : null}
      </main>
    );
  }

  const presetId = path === 'key' ? cloud : local;
  const skip = (
    <button type="button" class="onb__skip" data-testid="onboarding-skip" onClick={() => close('skipped')}>
      {i18n.t('onboarding.skip')}
    </button>
  );

  return (
    <main class="onb" data-testid="onboarding">
      <h1>{i18n.t('onboarding.title')}</h1>
      <ol class="onb__steps" aria-label={i18n.t('onboarding.stepsLabel')}>
        {[i18n.t('onboarding.step1'), i18n.t('onboarding.step2'), i18n.t('onboarding.step3')].map((name, i) => (
          <li key={name} aria-current={Math.min(step, 3) === i + 1 ? 'step' : undefined} data-testid={`onboarding-step-${i + 1}`}>
            {i + 1}. {name}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section data-testid="onboarding-language">
          <h2 ref={heading} tabIndex={-1}>{i18n.t('onboarding.langTitle')}</h2>
          <p class="opt__hint">{i18n.t('onboarding.langHint')}</p>
          <div class="opt__row">
            <label for="onb-lang">{i18n.t('onboarding.translateInto')}</label>
            <select id="onb-lang" data-testid="onboarding-lang" value={lang} onChange={(e) => setLang((e.target as HTMLSelectElement).value)}>
              {(LANGUAGES.some((l) => l.code === lang) || lang === '' ? LANGUAGES : [{ code: lang, name: languageLabel(lang) }, ...LANGUAGES]).map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          {note ? <p class="opt__status opt__status--warn" role="alert">{note}</p> : null}
          <div class="onb__nav">
            <button type="button" data-testid="onboarding-next" disabled={lang === ''} onClick={() => void saveLang()}>
              {i18n.t('onboarding.next')}
            </button>
            {skip}
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section data-testid="onboarding-how">
          <h2 ref={heading} tabIndex={-1}>{i18n.t('onboarding.howTitle')}</h2>
          <fieldset class="onb__cards">
            <legend class="onb__legend">{i18n.t('onboarding.howLegend')}</legend>
            <div class={`onb__card${path === 'key' ? ' onb__card--on' : ''}`}>
              <input type="radio" id="onb-path-key" name="onb-path" data-testid="path-key" aria-describedby="onb-path-key-sub" checked={path === 'key'} onChange={() => setPath('key')} />
              <label for="onb-path-key" class="onb__title">{i18n.t('onboarding.pathKeyTitle')}</label>
              <p class="onb__sub" id="onb-path-key-sub">{i18n.t('onboarding.pathKeySub')}</p>
              {path === 'key' ? (
                <p class="onb__sub">
                  <label for="onb-cloud">{i18n.t('onboarding.provider')} </label>
                  <select id="onb-cloud" data-testid="cloud-preset" value={cloud} onChange={(e) => setCloud((e.target as HTMLSelectElement).value as PresetId)}>
                    {CLOUD_CHOICES.map((id) => (
                      <option key={id} value={id}>
                        {id === 'anthropic' ? i18n.t('onboarding.recommended', { provider: presetLabel(id) }) : presetLabel(id)}
                      </option>
                    ))}
                  </select>
                </p>
              ) : null}
            </div>
            <div class={`onb__card${path === 'local' ? ' onb__card--on' : ''}`}>
              <input type="radio" id="onb-path-local" name="onb-path" data-testid="path-local" aria-describedby="onb-path-local-sub" checked={path === 'local'} onChange={() => setPath('local')} />
              <label for="onb-path-local" class="onb__title">{i18n.t('onboarding.pathLocalTitle')}</label>
              <p class="onb__sub" id="onb-path-local-sub">{i18n.t('onboarding.pathLocalSub')}</p>
              {path === 'local' ? (
                <p class="onb__sub">
                  <label for="onb-local">{i18n.t('onboarding.runsWith')} </label>
                  <select id="onb-local" data-testid="local-preset" value={local} onChange={(e) => setLocal((e.target as HTMLSelectElement).value as PresetId)}>
                    {LOCAL_CHOICES.map((id) => (
                      <option key={id} value={id}>
                        {presetLabel(id)}
                      </option>
                    ))}
                  </select>
                </p>
              ) : null}
            </div>
            <div class="onb__card" aria-disabled="true" data-testid="path-builtin-card">
              <input type="radio" id="onb-path-builtin" name="onb-path" data-testid="path-builtin" aria-describedby="onb-path-builtin-sub" disabled />
              <label for="onb-path-builtin" class="onb__title">{i18n.t('onboarding.pathBuiltinTitle')}</label>
              <p class="onb__sub" id="onb-path-builtin-sub">{i18n.t('onboarding.pathBuiltinSub')}</p>
            </div>
          </fieldset>
          <div class="onb__nav">
            <button type="button" onClick={() => setStep(1)} data-testid="onboarding-back">
              {i18n.t('onboarding.back')}
            </button>
            <button type="button" data-testid="onboarding-next" onClick={() => setStep(3)}>
              {i18n.t('onboarding.next')}
            </button>
            {skip}
          </div>
        </section>
      ) : null}

      {step === 3 && loaded ? (
        <section data-testid="onboarding-try">
          <h2 ref={heading} tabIndex={-1}>{saved ? i18n.t('onboarding.step3') : i18n.t('onboarding.connectTitle')}</h2>
          {saved ? (
            <Sample api={api} lang={lang} saved={saved} injected={injected} injectedGate={injectedGate} onDone={() => close('done')} onChange={() => setSaved(undefined)} onSkip={() => close('skipped')} />
          ) : (
            <>
              <p class="opt__hint" data-testid="onboarding-key-note">
                {path === 'local' ? i18n.t('onboarding.noteLocal') : i18n.t('onboarding.noteKey')}
              </p>
              <ConnectionForm
                key={presetId}
                api={api}
                adapterFor={adapterFor}
                loaded={loaded}
                editing={undefined}
                openGuide={false}
                retestMs={retestMs}
                initialPreset={presetId}
                hideCancel
                onDone={(text) => {
                  if (text === undefined) return setStep(2);
                  void reload();
                  setSaved(text);
                }}
              />
              <div class="onb__nav">
                <button type="button" onClick={() => setStep(2)} data-testid="onboarding-back">
                  {i18n.t('onboarding.back')}
                </button>
                {skip}
              </div>
            </>
          )}
        </section>
      ) : null}
    </main>
  );
}

function usePrivacy(gate: PrivacyGate): PrivacyState {
  const [state, setState] = useState(gate.state);
  useEffect(() => {
    setState(gate.state);
    return gate.subscribe(setState);
  }, [gate]);
  return state;
}

/** Step 3b: one paragraph, translated through the route that was just saved. */
function Sample({ api, lang, saved, injected, injectedGate, onDone, onChange, onSkip }: { api: Browser; lang: string; saved: string; injected?: Jobs | undefined; injectedGate?: PrivacyGate | undefined; onDone: () => void; onChange: () => void; onSkip: () => void }) {
  const gate = useRef(injectedGate ?? new PrivacyGate(api)).current;
  const privacy = usePrivacy(gate);
  const jobs = useRef(
    injected ??
      (() => {
        const ledger = new SpendLedger(api);
        return new Jobs({ translateClient: (target) => translateClient(api, target), strategy: 'single-pass', cache: undefined, onSpend: (delta) => void ledger.add(delta) });
      })(),
  ).current;
  const [view, setView] = useState<JobView | undefined>(() => jobs.get(SAMPLE_TAB));
  const [asked, setAsked] = useState(false);
  const [to, setTo] = useState<Routed | undefined>();
  const noticeButton = useRef<HTMLButtonElement>(null);
  const sample = sampleFor(lang);
  useEffect(() => jobs.subscribe((id) => id === SAMPLE_TAB && setView(jobs.get(SAMPLE_TAB))), [jobs]);
  // The notice is an alert: its button takes focus when it appears, so Enter acknowledges it.
  useEffect(() => {
    if (asked && privacy !== 'acknowledged') noticeButton.current?.focus();
  }, [asked, privacy]);
  useEffect(() => {
    routedSummary(api).then(setTo, () => {});
  }, [api]);
  const segment: Segment = { id: 's0', kind: 'p', text: sample.text, inlineMarkup: sample.text, domPath: '/p[1]', translate: true };

  const run = () => {
    // The sample is this page's one "tab": it is in front, so its requests go out (jobs.ts D14).
    jobs.setActive(SAMPLE_TAB);
    void jobs.start(SAMPLE_TAB, `sample-${Date.now()}`, { url: 'about:onboarding', title: 'Sample', sourceLang: sample.lang, targetLang: lang, segments: [segment] });
  };
  const translate = () => {
    setAsked(true);
    routedSummary(api).then(setTo, () => {});
    // Nothing is sent before the notice is acknowledged (§8); once it is, this runs.
    gate.whenAcknowledged('sample', run);
  };
  const state = view?.segs.get('s0');
  const finished = view?.status === 'done' && state?.status === 'final';
  const failureError = view?.stopError ?? (state?.status === 'failed' ? state.error : undefined);
  const failure = failureError ? failureText(failureError) : undefined;

  return (
    <div data-testid="onboarding-sample">
      <p class="opt__status" data-testid="onboarding-saved">{saved}</p>
      <div class="onb__sample">
        <strong>{i18n.t('onboarding.sampleTitle', { language: languageLabel(sample.lang) })}</strong>
        <blockquote data-testid="sample-original">{sample.text}</blockquote>
        {asked && privacy !== 'acknowledged' ? (
          <div class="onb__notice" role="alert" data-testid="onboarding-privacy">
            <p>
              {to
                ? slots(i18n.t('onboarding.privacyNow', { provider: '{provider}', host: '{host}' }), { provider: <strong data-testid="onboarding-privacy-provider">{to.label}</strong>, host: to.host ? ` (${to.host})` : '' })
                : i18n.t('onboarding.privacy')}
            </p>
            <button type="button" ref={noticeButton} data-testid="onboarding-privacy-ok" onClick={() => void gate.acknowledge().catch(() => {})}>
              {i18n.t('onboarding.privacyOk')}
            </button>
          </div>
        ) : null}
        {state?.status === 'final' || state?.status === 'streaming' ? (
          <>
            <strong>{languageLabel(lang)}</strong>
            <blockquote data-testid="sample-translation">{state.text}</blockquote>
          </>
        ) : null}
        {failure ? (
          <p class="opt__status opt__status--warn" role="alert" data-testid="sample-error">
            {failure}
          </p>
        ) : null}
        {finished && view ? (
          <p class="opt__hint" data-testid="sample-model">
            {view.connection ? i18n.t('onboarding.translatedByVia', [view.model, view.connection.label]) : i18n.t('onboarding.translatedBy', [view.model])}
          </p>
        ) : null}
        <div class="opt__row">
          <button type="button" data-testid="translate-sample" disabled={view?.status === 'running'} onClick={translate}>
            {view?.status === 'running' ? i18n.t('onboarding.translating') : finished || failure ? i18n.t('onboarding.translateAgain') : i18n.t('onboarding.translateSample')}
          </button>
          <button type="button" onClick={onChange} data-testid="onboarding-change">
            {i18n.t('onboarding.changeConnection')}
          </button>
        </div>
      </div>
      <div class="onb__nav">
        <button type="button" data-testid="onboarding-finish" onClick={onDone}>
          {finished ? i18n.t('onboarding.finish') : i18n.t('onboarding.finishNoSample')}
        </button>
        <button type="button" class="onb__skip" onClick={onSkip}>
          {i18n.t('onboarding.skip')}
        </button>
      </div>
    </div>
  );
}
