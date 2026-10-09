// Onboarding (DESIGN.md §4.3.3 C, plan M4-E13): 1 your language → 2 how to translate → 3 connect
// (the Providers connection form with its Test connection, reused as it is) and translate a sample
// paragraph. It can be skipped at any step and opened again from Settings. The sample sends a
// paragraph to the chosen provider, so the privacy notice (M3-E10) gates it: nothing goes before
// it is acknowledged, and acknowledging here is the same acknowledgement the panel keeps.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { browser } from 'wxt/browser';
import type { Segment } from '@/engine/index';
import { languageLabel } from '@/engine/index';
import { createAdapter } from '@/llm/client';
import { PRESETS, type PresetId } from '@/shared/presets';
import { markOnboarding } from '@/shared/onboarding';
import { SpendLedger } from '@/shared/spend';
import { LANGUAGES, readPreferences, updatePreferences } from '@/shared/settings';
import { Jobs, type JobView } from '../sidepanel/jobs.ts';
import { PrivacyGate, type PrivacyState } from '../sidepanel/privacy.ts';
import { routedSummary, translateClient, type Routed } from '../sidepanel/route.ts';
import { ConnectionForm, load, RETEST_MS, type AdapterFor, type Loaded } from '../options/Providers.tsx';

type Browser = typeof browser;

/** What step 2 offers (§4.3.3 C): where the translation runs. */
type Path = 'key' | 'local' | 'builtin';
const CLOUD_CHOICES: readonly PresetId[] = ['anthropic', 'openai', 'gemini', 'openrouter', 'ollama-cloud', 'apibox'];
const LOCAL_CHOICES: readonly PresetId[] = ['ollama', 'lmstudio'];
const presetLabel = (id: PresetId) => PRESETS.find((p) => p.id === id)?.label ?? id;

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
      setNote("Couldn't save your language. Try again, or set it later in settings.");
    }
  };

  if (closed) {
    return (
      <main class="onb" data-testid="onboarding-closed">
        <h1>{closed === 'done' ? "You're set" : 'Skipped for now'}</h1>
        <p>
          {closed === 'done'
            ? 'Open any page and click the Translate Side icon in the toolbar (or press Alt+T): the page is translated in the side panel.'
            : 'You can set things up later: Settings ▸ Providers, or "Set up guide" at the top of the settings page.'}
        </p>
      </main>
    );
  }

  const presetId = path === 'key' ? cloud : local;
  const skip = (
    <button type="button" class="onb__skip" data-testid="onboarding-skip" onClick={() => close('skipped')}>
      Skip for now
    </button>
  );

  return (
    <main class="onb" data-testid="onboarding">
      <h1>Set up Translate Side</h1>
      <ol class="onb__steps" aria-label="Steps">
        {['Your language', 'How to translate', 'Try it'].map((name, i) => (
          <li key={name} aria-current={Math.min(step, 3) === i + 1 ? 'step' : undefined} data-testid={`onboarding-step-${i + 1}`}>
            {i + 1}. {name}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section data-testid="onboarding-language">
          <h2>What is your language?</h2>
          <p class="opt__hint">Pages are translated into it. You can change it any time in the panel.</p>
          <div class="opt__row">
            <label for="onb-lang">Translate into</label>
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
              Next
            </button>
            {skip}
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section data-testid="onboarding-how">
          <h2>How do you want to translate?</h2>
          <div class="onb__cards" role="radiogroup" aria-label="How to translate">
            <label class={`onb__card${path === 'key' ? ' onb__card--on' : ''}`}>
              <input type="radio" name="onb-path" data-testid="path-key" checked={path === 'key'} onChange={() => setPath('key')} />
              <span class="onb__title">Best quality: an API key</span>
              <p class="onb__sub">Anthropic (Claude) is recommended. Pages are sent to the provider you pick, and you pay it per use.</p>
              {path === 'key' ? (
                <p class="onb__sub">
                  <label for="onb-cloud">Provider </label>
                  <select id="onb-cloud" data-testid="cloud-preset" value={cloud} onChange={(e) => setCloud((e.target as HTMLSelectElement).value as PresetId)}>
                    {CLOUD_CHOICES.map((id) => (
                      <option key={id} value={id}>
                        {presetLabel(id)}
                        {id === 'anthropic' ? ' (recommended)' : ''}
                      </option>
                    ))}
                  </select>
                </p>
              ) : null}
            </label>
            <label class={`onb__card${path === 'local' ? ' onb__card--on' : ''}`}>
              <input type="radio" name="onb-path" data-testid="path-local" checked={path === 'local'} onChange={() => setPath('local')} />
              <span class="onb__title">Private and free: a model on this computer</span>
              <p class="onb__sub">Runs with Ollama or LM Studio, so the text never leaves this device. Needs one of them installed; the next step walks you through the setup.</p>
              {path === 'local' ? (
                <p class="onb__sub">
                  <label for="onb-local">Runs with </label>
                  <select id="onb-local" data-testid="local-preset" value={local} onChange={(e) => setLocal((e.target as HTMLSelectElement).value as PresetId)}>
                    {LOCAL_CHOICES.map((id) => (
                      <option key={id} value={id}>
                        {presetLabel(id)}
                      </option>
                    ))}
                  </select>
                </p>
              ) : null}
            </label>
            <label class="onb__card" aria-disabled="true" data-testid="path-builtin-card">
              <input type="radio" name="onb-path" data-testid="path-builtin" disabled />
              <span class="onb__title">Just try it: Chrome's built-in translator</span>
              <p class="onb__sub">Coming soon. It is not available in this version.</p>
            </label>
          </div>
          <div class="onb__nav">
            <button type="button" onClick={() => setStep(1)} data-testid="onboarding-back">
              Back
            </button>
            <button type="button" data-testid="onboarding-next" onClick={() => setStep(3)}>
              Next
            </button>
            {skip}
          </div>
        </section>
      ) : null}

      {step === 3 && loaded ? (
        <section data-testid="onboarding-try">
          <h2>{saved ? 'Try it' : 'Connect and test'}</h2>
          {saved ? (
            <Sample api={api} lang={lang} saved={saved} injected={injected} injectedGate={injectedGate} onDone={() => close('done')} onChange={() => setSaved(undefined)} onSkip={() => close('skipped')} />
          ) : (
            <>
              <p class="opt__hint" data-testid="onboarding-key-note">
                {path === 'local' ? 'Nothing leaves this computer with a local model.' : 'Your key stays on this device: it is not synced to your other devices, and it is sent only to the provider you choose.'}
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
                onDone={(text) => {
                  if (text === undefined) return setStep(2);
                  void reload();
                  setSaved(text);
                }}
              />
              <div class="onb__nav">
                <button type="button" onClick={() => setStep(2)} data-testid="onboarding-back">
                  Back
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
  const sample = sampleFor(lang);
  useEffect(() => jobs.subscribe((id) => id === SAMPLE_TAB && setView(jobs.get(SAMPLE_TAB))), [jobs]);
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
  const failure = view?.stopError?.message ?? (state?.status === 'failed' ? state.error?.message : undefined);

  return (
    <div data-testid="onboarding-sample">
      <p class="opt__status" data-testid="onboarding-saved">{saved}</p>
      <div class="onb__sample">
        <strong>Sample paragraph ({languageLabel(sample.lang)})</strong>
        <blockquote data-testid="sample-original">{sample.text}</blockquote>
        {asked && privacy !== 'acknowledged' ? (
          <div class="onb__notice" role="alert" data-testid="onboarding-privacy">
            <p>
              Before this goes out: Translate Side sends the text of what you translate to the provider you chose
              {to ? (
                <>
                  , now <strong data-testid="onboarding-privacy-provider">{to.label}</strong> {to.host ? `(${to.host})` : ''}
                </>
              ) : null}
              . Here that is the sample paragraph above. Mail and sign-in pages, and anything you type into, are never read.
            </p>
            <button type="button" data-testid="onboarding-privacy-ok" onClick={() => void gate.acknowledge().catch(() => {})}>
              Got it, translate the sample
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
            Translated by {view.model}
            {view.connection ? ` (${view.connection.label})` : ''}.
          </p>
        ) : null}
        <div class="opt__row">
          <button type="button" data-testid="translate-sample" disabled={view?.status === 'running'} onClick={translate}>
            {view?.status === 'running' ? 'Translating…' : finished || failure ? 'Translate again' : 'Translate the sample'}
          </button>
          <button type="button" onClick={onChange} data-testid="onboarding-change">
            Change connection
          </button>
        </div>
      </div>
      <div class="onb__nav">
        <button type="button" data-testid="onboarding-finish" onClick={onDone}>
          {finished ? 'Finish' : 'Finish without the sample'}
        </button>
        <button type="button" class="onb__skip" onClick={onSkip}>
          Skip for now
        </button>
      </div>
    </div>
  );
}
