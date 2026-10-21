// Onboarding (DESIGN.md §4.3.3 C, plan M4-E13): 1 your language → 2 how to translate → 3 connect
// (the Providers connection form with its Test connection, reused as it is) and translate a sample
// paragraph. It can be skipped at any step and opened again from Settings. The sample sends a
// paragraph to the chosen provider, so the privacy notice (M3-E10) gates it: nothing goes before
// it is acknowledged, and acknowledging here is the same acknowledgement the panel keeps.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { browser } from 'wxt/browser';
import { Button } from '@/ui/Button';
import { CheckIcon } from '@/ui/icons';
import { Notice } from '@/ui/Notice';
import { Select } from '@/ui/Select';
import { useReading } from '@/ui/use-reading';
import { isRtl } from '@/shared/language';
import { i18n } from '#i18n';
import type { Segment } from '@/engine/index';
import { languageName } from '@/shared/language-name';
import { createAdapter } from '@/llm/client';
import { chromeTranslator } from '@/llm/chrome-translator';
import { pickEngine, prepareOnDevice, type EngineChoice, type OnDeviceEngine } from '@/llm/on-device';
import { hasBasicFallback, onDeviceSettingOf } from '@/shared/providers';
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

export function Onboarding({ api, adapterFor = createAdapter, retestMs = RETEST_MS, jobs: injected, gate: injectedGate, scope = globalThis }: { api: Browser; adapterFor?: AdapterFor; retestMs?: number; jobs?: Jobs; gate?: PrivacyGate; scope?: object }) {
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
  /** Can the sample run on this device (Chrome's own models)? Undefined while it is checked. */
  const [builtin, setBuiltin] = useState<EngineChoice | undefined>();
  const pathChosen = useRef(false);
  const choosePath = (next: Path) => {
    pathChosen.current = true;
    setPath(next);
  };

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

  // On-device translation for the sample's pair, as the route would pick it (availability only, nothing is created).
  const routing = loaded?.settings.routing;
  useEffect(() => {
    if (lang === '') return;
    const from = sampleFor(lang).lang;
    let live = true;
    pickEngine(scope, { setting: routing ? onDeviceSettingOf(routing) : 'auto', from, to: lang, translator: routing ? hasBasicFallback(routing) : true }).then(
      (choice) => live && setBuiltin(choice),
      () => live && setBuiltin({ unavailable: 'no-api', from, to: lang }),
    );
    return () => void (live = false);
  }, [scope, lang, routing]);
  const builtinRuns = builtin !== undefined && !('unavailable' in builtin) && !('unknownSource' in builtin);
  // On-device first when it can run (no key to find); a choice the reader made stays.
  useEffect(() => {
    if (pathChosen.current || builtin === undefined) return;
    setPath(builtinRuns ? 'builtin' : (cur) => (cur === 'builtin' ? 'key' : cur));
  }, [builtin, builtinRuns]);

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
    <Button variant="quiet" class="onb__skip" data-testid="onboarding-skip" onClick={() => close('skipped')}>
      {i18n.t('onboarding.skip')}
    </Button>
  );

  return (
    <main class="onb" data-testid="onboarding">
      <h1>{i18n.t('onboarding.title')}</h1>
      <ol class="onb__steps" aria-label={i18n.t('onboarding.stepsLabel')}>
        {[i18n.t('onboarding.step1'), i18n.t('onboarding.step2'), i18n.t('onboarding.step3')].map((name, i) => (
          <li key={name} aria-current={Math.min(step, 3) === i + 1 ? 'step' : undefined} data-testid={`onboarding-step-${i + 1}`} class={Math.min(step, 3) > i + 1 ? 'onb__step--done' : undefined}>
            <span class="onb__num" aria-hidden="true">
              {Math.min(step, 3) > i + 1 ? <CheckIcon size={12} /> : i + 1}
            </span>
            <span class="sr-only">{i + 1}. </span>
            {name}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section data-testid="onboarding-language">
          <h2 ref={heading} tabIndex={-1}>{i18n.t('onboarding.langTitle')}</h2>
          <p class="opt__hint">{i18n.t('onboarding.langHint')}</p>
          <div class="opt__row">
            <label for="onb-lang">{i18n.t('onboarding.translateInto')}</label>
            <Select id="onb-lang" data-testid="onboarding-lang" value={lang} onChange={(e) => setLang((e.target as HTMLSelectElement).value)}>
              {(LANGUAGES.some((l) => l.code === lang) || lang === '' ? LANGUAGES : [{ code: lang, name: languageName(lang) }, ...LANGUAGES]).map((l) => (
                <option key={l.code} value={l.code}>
                  {languageName(l.code)}
                </option>
              ))}
            </Select>
          </div>
          {note ? <p class="opt__status opt__status--warn" role="alert">{note}</p> : null}
          <div class="onb__nav">
            <Button variant="primary" data-testid="onboarding-next" disabled={lang === ''} onClick={() => void saveLang()}>
              {i18n.t('onboarding.next')}
            </Button>
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
              <input type="radio" id="onb-path-key" name="onb-path" data-testid="path-key" aria-describedby="onb-path-key-sub" checked={path === 'key'} onChange={() => choosePath('key')} />
              <label for="onb-path-key" class="onb__title">{i18n.t('onboarding.pathKeyTitle')}</label>
              <p class="onb__sub" id="onb-path-key-sub">{i18n.t('onboarding.pathKeySub')}</p>
              {path === 'key' ? (
                <p class="onb__sub">
                  <label for="onb-cloud">{i18n.t('onboarding.provider')} </label>
                  <Select id="onb-cloud" data-testid="cloud-preset" value={cloud} onChange={(e) => setCloud((e.target as HTMLSelectElement).value as PresetId)}>
                    {CLOUD_CHOICES.map((id) => (
                      <option key={id} value={id}>
                        {id === 'anthropic' ? i18n.t('onboarding.recommended', { provider: presetLabel(id) }) : presetLabel(id)}
                      </option>
                    ))}
                  </Select>
                </p>
              ) : null}
            </div>
            <div class={`onb__card${path === 'local' ? ' onb__card--on' : ''}`}>
              <input type="radio" id="onb-path-local" name="onb-path" data-testid="path-local" aria-describedby="onb-path-local-sub" checked={path === 'local'} onChange={() => choosePath('local')} />
              <label for="onb-path-local" class="onb__title">{i18n.t('onboarding.pathLocalTitle')}</label>
              <p class="onb__sub" id="onb-path-local-sub">{i18n.t('onboarding.pathLocalSub')}</p>
              {path === 'local' ? (
                <p class="onb__sub">
                  <label for="onb-local">{i18n.t('onboarding.runsWith')} </label>
                  <Select id="onb-local" data-testid="local-preset" value={local} onChange={(e) => setLocal((e.target as HTMLSelectElement).value as PresetId)}>
                    {LOCAL_CHOICES.map((id) => (
                      <option key={id} value={id}>
                        {presetLabel(id)}
                      </option>
                    ))}
                  </Select>
                </p>
              ) : null}
            </div>
            <div class={`onb__card${path === 'builtin' ? ' onb__card--on' : ''}`} aria-disabled={builtinRuns ? undefined : 'true'} data-testid="path-builtin-card">
              <input type="radio" id="onb-path-builtin" name="onb-path" data-testid="path-builtin" aria-describedby="onb-path-builtin-sub" checked={path === 'builtin'} disabled={!builtinRuns} onChange={() => choosePath('builtin')} />
              <label for="onb-path-builtin" class="onb__title">{i18n.t('onboarding.pathBuiltinTitle')}</label>
              <p class="onb__sub" id="onb-path-builtin-sub">
                {builtin !== undefined && !builtinRuns
                  ? 'unknownSource' in builtin
                    ? i18n.t('panel.job.onDevice.noSource')
                    : 'unavailable' in builtin && builtin.unavailable === 'pair'
                      ? i18n.t('panel.job.onDevice.pair', [`${languageName(builtin.from)} → ${languageName(builtin.to)}`])
                      : 'unavailable' in builtin && builtin.unavailable === 'setting'
                        ? i18n.t('panel.job.onDevice.setting')
                        : i18n.t('panel.job.onDevice.noApi')
                  : i18n.t('onboarding.pathBuiltinSub')}
              </p>
            </div>
          </fieldset>
          <div class="onb__nav">
            <Button variant="quiet" onClick={() => setStep(1)} data-testid="onboarding-back">
              {i18n.t('onboarding.back')}
            </Button>
            <Button variant="primary" data-testid="onboarding-next" onClick={() => setStep(3)}>
              {i18n.t('onboarding.next')}
            </Button>
            {skip}
          </div>
        </section>
      ) : null}

      {step === 3 && loaded ? (
        <section data-testid="onboarding-try">
          <h2 ref={heading} tabIndex={-1}>{saved || path === 'builtin' ? i18n.t('onboarding.step3') : i18n.t('onboarding.connectTitle')}</h2>
          {path === 'builtin' ? (
            // Nothing to connect: with no provider set up, the route runs on this device (src/llm/on-device.ts).
            // The sample's own line says what translated it, so a provider set up earlier is named, not hidden.
            <Sample api={api} lang={lang} injected={injected} injectedGate={injectedGate} scope={scope} onDone={() => close('done')} onChange={() => setStep(2)} onSkip={() => close('skipped')} />
          ) : saved ? (
            <Sample api={api} lang={lang} saved={saved} injected={injected} injectedGate={injectedGate} scope={scope} onDone={() => close('done')} onChange={() => setSaved(undefined)} onSkip={() => close('skipped')} />
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
                // The sample translates through what was just set up, not a route chosen before.
                routeOnSave
                onDone={(text) => {
                  if (text === undefined) return setStep(2);
                  void reload();
                  setSaved(text);
                }}
              />
              <div class="onb__nav">
                <Button variant="quiet" onClick={() => setStep(2)} data-testid="onboarding-back">
                  {i18n.t('onboarding.back')}
                </Button>
                {skip}
              </div>
            </>
          )}
        </section>
      ) : null}
    </main>
  );
}

/** The notice's state as the sample shows it: `needed` only while the sample waits for it (a cloud route). */
function usePrivacy(gate: PrivacyGate): PrivacyState {
  const read = () => (gate.state === 'needed' && !gate.pending ? 'unknown' : gate.state);
  const [state, setState] = useState(read);
  useEffect(() => {
    setState(read());
    return gate.subscribe(() => setState(read()));
  }, [gate]);
  return state;
}

/** Step 3b: one paragraph, translated through the route that was just saved. */
function Sample({ api, lang, saved, injected, injectedGate, scope, onDone, onChange, onSkip }: { api: Browser; lang: string; saved?: string; injected?: Jobs | undefined; injectedGate?: PrivacyGate | undefined; scope: object; onDone: () => void; onChange: () => void; onSkip: () => void }) {
  const gate = useRef(injectedGate ?? new PrivacyGate(api)).current;
  const privacy = usePrivacy(gate);
  // Chrome's Translator as the panel has it: the on-device route runs on it, and the turn-on click creates its pair.
  const mt = useRef(chromeTranslator(scope)).current;
  const jobs = useRef(
    injected ??
      (() => {
        const ledger = new SpendLedger(api);
        // The notice is asked on the route the sample resolves: on the device it never is (jobs.ts).
        const privacy = { acknowledged: () => gate.state === 'acknowledged', whenAcknowledged: (key: string, run: () => void) => gate.whenAcknowledged(key, run), forget: (key: string) => gate.forget(key) };
        return new Jobs({ translateClient: (target) => translateClient(api, target, scope), privacy, strategy: 'single-pass', cache: undefined, mt, onSpend: (delta) => void ledger.add(delta) });
      })(),
  ).current;
  const [download, setDownload] = useState<{ loaded: number; error?: string } | undefined>();
  const downloadAbort = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => downloadAbort.current?.abort(), []);
  const [view, setView] = useState<JobView | undefined>(() => jobs.get(SAMPLE_TAB));
  const [asked, setAsked] = useState(false);
  const [to, setTo] = useState<Routed | undefined>();
  const noticeButton = useRef<HTMLButtonElement>(null);
  const reading = useReading(api);
  const sample = sampleFor(lang);
  useEffect(() => jobs.subscribe((id) => id === SAMPLE_TAB && setView(jobs.get(SAMPLE_TAB))), [jobs]);
  // The notice is an alert: its button takes focus when it appears, so Enter acknowledges it.
  useEffect(() => {
    if (asked && privacy === 'needed') noticeButton.current?.focus();
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
    // Nothing leaves the device before the notice is acknowledged (§8): the job waits on it for a cloud route.
    run();
  };
  /**
   * The turn-on click (on-device translation, a pair not created yet): the engine is created first,
   * in this click (Chrome's Translator needs the gesture), then the sample runs once it is ready.
   * Cancel (or leaving the page) stops the download and puts the turn-on back.
   */
  const turnOn = (engine: OnDeviceEngine, from: string, to: string) => {
    downloadAbort.current?.abort();
    const controller = new AbortController();
    downloadAbort.current = controller;
    const ready = prepareOnDevice(scope, mt, engine, from, to, { signal: controller.signal, progress: (loaded) => !controller.signal.aborted && setDownload({ loaded }) });
    setDownload({ loaded: 0 });
    ready.then(
      () => {
        if (controller.signal.aborted) return;
        downloadAbort.current = undefined;
        setDownload(undefined);
        translate();
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        downloadAbort.current = undefined;
        setDownload({ loaded: 0, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
      },
    );
  };
  const cancelDownload = () => {
    downloadAbort.current?.abort();
    downloadAbort.current = undefined;
    setDownload(undefined);
  };
  const state = view?.segs.get('s0');
  const finished = view?.status === 'done' && state?.status === 'final';
  const failureError = view?.stopError ?? (state?.status === 'failed' ? state.error : undefined);
  const setup = (failureError?.raw as { ui?: unknown; args?: string[] } | undefined)?.ui === 'onDeviceSetup' ? (failureError?.raw as { args: string[] }).args : undefined;
  const failure = failureError && !setup ? failureText(failureError) : undefined;

  return (
    <div data-testid="onboarding-sample">
      {saved ? <p class="opt__status" data-testid="onboarding-saved">{saved}</p> : null}
      <div class="onb__sample">
        <strong>{i18n.t('onboarding.sampleTitle', { language: languageName(sample.lang) })}</strong>
        <blockquote data-testid="sample-original">{sample.text}</blockquote>
        {asked && privacy === 'needed' ? (
          <Notice tone="warn" class="onb__notice" data-testid="onboarding-privacy">
            <p>
              {to
                ? slots(i18n.t('onboarding.privacyNow', { provider: '{provider}', host: '{host}' }), { provider: <strong data-testid="onboarding-privacy-provider">{to.label}</strong>, host: to.host ? ` (${to.host})` : '' })
                : i18n.t('onboarding.privacy')}
            </p>
            <button type="button" class="ui-button" ref={noticeButton} data-testid="onboarding-privacy-ok" onClick={() => void gate.acknowledge().catch(() => {})}>
              {i18n.t('onboarding.privacyOk')}
            </button>
          </Notice>
        ) : null}
        {state?.status === 'final' || state?.status === 'streaming' ? (
          <>
            <strong>{languageName(lang)}</strong>
            {/* The reader's own look: the panel's typeface and size, in the target language. */}
            <blockquote class="onb__reading" data-testid="sample-translation" data-typeface={reading.typeface} lang={lang} {...(isRtl(lang) ? { dir: 'rtl' } : {})} style={{ fontSize: `${reading.size}px` }}>
              {state.text}
            </blockquote>
          </>
        ) : null}
        {failure ? (
          <p class="opt__status opt__status--warn" role="alert" data-testid="sample-error">
            {failure}
          </p>
        ) : null}
        {setup && !finished ? (
          <p class="opt__row" data-testid="sample-on-device">
            <span class="opt__status" role="status">
              {download?.error !== undefined
                ? i18n.t('panel.job.onDevice.failed', [`${languageName(setup[1] ?? '')} → ${languageName(setup[2] ?? '')}`, download.error])
                : download
                  ? i18n.t(setup[0] === 'nano' ? 'panel.job.onDevice.downloadingNano' : 'panel.job.onDevice.downloading', [`${languageName(setup[1] ?? '')} → ${languageName(setup[2] ?? '')}`, String(Math.round(download.loaded * 100))])
                  : i18n.t(setup[0] === 'nano' ? 'panel.job.onDevice.setupNano' : 'panel.job.onDevice.setup', [`${languageName(setup[1] ?? '')} → ${languageName(setup[2] ?? '')}`])}
            </span>
            {download && download.error === undefined ? (
              <Button data-testid="sample-turn-on-cancel" onClick={cancelDownload}>
                {i18n.t('panel.job.cancel')}
              </Button>
            ) : (
              <Button variant="primary" data-testid="sample-turn-on" onClick={() => turnOn(setup[0] === 'nano' ? 'nano' : 'translator', setup[1] ?? '', setup[2] ?? '')}>
                {download?.error === undefined ? i18n.t('panel.job.onDevice.turnOn') : i18n.t('panel.job.tryAgain')}
              </Button>
            )}
          </p>
        ) : null}
        {finished && view ? (
          <p class="opt__hint" data-testid="sample-model">
            {view.connection ? i18n.t('onboarding.translatedByVia', [view.model, view.connection.label]) : i18n.t('onboarding.translatedBy', [view.model])}
          </p>
        ) : null}
        <div class="opt__row">
          <Button variant={finished ? 'default' : 'primary'} data-testid="translate-sample" disabled={view?.status === 'running'} onClick={translate}>
            {view?.status === 'running' ? i18n.t('onboarding.translating') : finished || failure ? i18n.t('onboarding.translateAgain') : i18n.t('onboarding.translateSample')}
          </Button>
          <Button onClick={onChange} data-testid="onboarding-change">
            {i18n.t('onboarding.changeConnection')}
          </Button>
        </div>
      </div>
      <div class="onb__nav">
        {/* One primary per step: Finish once the sample is done; until then Translate sample is it. */}
        <Button variant={finished ? 'primary' : 'default'} data-testid="onboarding-finish" onClick={onDone}>
          {finished ? i18n.t('onboarding.finish') : i18n.t('onboarding.finishNoSample')}
        </Button>
        <Button variant="quiet" class="onb__skip" onClick={onSkip}>
          {i18n.t('onboarding.skip')}
        </Button>
      </div>
    </div>
  );
}
