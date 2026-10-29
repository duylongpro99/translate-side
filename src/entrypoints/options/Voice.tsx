// Settings › Voice: which voice reads blocks aloud in the panel (the system voice, or a provider of
// the reader's own), the voice for Vietnamese and for English, read-on, and a test. Independent of
// the translation provider, and free: nothing here is behind featureAvailable. A provider's host
// permission is asked for in the Save click (a user gesture), for its origin only; a provider the
// translation side already holds a key for can reuse that key by reference instead of a copy.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { browser } from 'wxt/browser';
import { i18n } from '#i18n';
import { readProviderSettings } from '@/shared/providers';
import { originPattern, readApiKey } from '@/shared/settings';
import { engineFor } from '@/tts/engines';
import { isTtsError } from '@/tts/errors';
import { TTS_PRESETS, ttsPreset, type TtsPresetId } from '@/tts/presets';
import { readTtsConnections, readTtsSettings, removeTtsConnection, sameService, saveTtsConnection, ttsConnectionId, updateTtsSettings, VOICE_LANGS, type TtsConnection, type TtsSettings, type VoiceLang } from '@/tts/settings';
import type { Playback, TtsErrorKind, Voice } from '@/tts/types';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';

type Browser = typeof browser;

/** What a voice says when picked, and in the test: one sentence per language. */
export const SAMPLES: Record<VoiceLang, string> = {
  vi: 'Xin chào, đây là giọng đọc tiếng Việt.',
  en: 'Hello, this is the English voice.',
};

const LANG_NAME: Record<VoiceLang, () => string> = { vi: () => i18n.t('options.voice.langVi'), en: () => i18n.t('options.voice.langEn') };

export function errorText(kind: TtsErrorKind, message: string): string {
  switch (kind) {
    case 'no-voice':
      return i18n.t('options.voice.errors.noVoice');
    case 'auth':
      return i18n.t('options.voice.errors.auth');
    case 'quota':
      return i18n.t('options.voice.errors.quota', [message]);
    case 'rate_limit':
      return i18n.t('options.voice.errors.rateLimit');
    case 'network':
      return i18n.t('options.voice.errors.network');
    case 'overloaded':
      return i18n.t('options.voice.errors.overloaded');
    default:
      return i18n.t('options.voice.errors.other', [message]);
  }
}

/** A translation connection whose key a voice provider can reuse: the same service. */
interface Reusable {
  presetId: TtsPresetId;
  connectionId: string;
  label: string;
}

async function reusableKeys(api: Browser): Promise<Reusable[]> {
  const { connections } = await readProviderSettings(api);
  const out: Reusable[] = [];
  for (const c of connections) {
    const presetId = (['gemini', 'openai'] as const).find((p) => sameService(p, c));
    if (presetId && (await readApiKey(api, c.id))) out.push({ presetId, connectionId: c.id, label: c.label });
  }
  return out;
}

type TestResult = Partial<Record<VoiceLang, { ok: true } | { ok: false; text: string }>>;

export function VoiceSection({ api }: { api: Browser }) {
  const [settings, setSettings] = useState<TtsSettings | undefined>();
  const [conns, setConns] = useState<TtsConnection[]>([]);
  const [voices, setVoices] = useState<Record<VoiceLang, Voice[]>>({ vi: [], en: [] });
  const [reusable, setReusable] = useState<Reusable[]>([]);
  const [adding, setAdding] = useState(false);
  const [test, setTest] = useState<{ running: boolean; result: TestResult }>({ running: false, result: {} });

  const reload = () =>
    Promise.all([readTtsSettings(api), readTtsConnections(api)]).then(([s, c]) => {
      setSettings(s);
      setConns(c);
    });
  useEffect(() => {
    void reload();
    void reusableKeys(api)
      .then(setReusable)
      .catch(() => setReusable([]));
  }, []);

  // The voices of the chosen engine, read again when it changes.
  const engineKey = settings ? `${settings.engine}:${settings.connectionId ?? ''}` : '';
  useEffect(() => {
    if (!settings) return;
    let live = true;
    void engineFor(api, settings)
      .then((e) => Promise.all(VOICE_LANGS.map((l) => e.voices(l).catch(() => []))))
      .then(([vi = [], en = []]) => live && setVoices({ vi, en }))
      .catch(() => live && setVoices({ vi: [], en: [] }));
    return () => {
      live = false;
    };
  }, [engineKey]);

  // One sample at a time: a new pick or the test stops the last one (each is a request on a paid voice).
  const sample = useRef<Playback | undefined>(undefined);
  useEffect(() => () => sample.current?.stop(), []);

  if (!settings) return null;

  const update = (patch: Partial<TtsSettings>) => {
    setTest({ running: false, result: {} });
    return updateTtsSettings(api, patch).then(setSettings);
  };

  const speak = async (s: TtsSettings, lang: VoiceLang) => {
    sample.current?.stop();
    const engine = await engineFor(api, s);
    const playback = engine.speak(SAMPLES[lang], { lang, voice: s.voices[lang] });
    sample.current = playback;
    return playback.done;
  };

  const pickVoice = (lang: VoiceLang, id: string) => {
    const next: TtsSettings['voices'] = Object.fromEntries(VOICE_LANGS.flatMap((l) => {
      const v = l === lang ? id : settings.voices[l];
      return v ? [[l, v]] : [];
    }));
    void update({ voices: next }).then(() => speak({ ...settings, voices: next }, lang).catch(() => undefined));
  };

  const runTest = async () => {
    setTest({ running: true, result: {} });
    const result: TestResult = {};
    for (const lang of VOICE_LANGS) {
      try {
        await speak(settings, lang);
        result[lang] = { ok: true };
      } catch (e) {
        result[lang] = { ok: false, text: isTtsError(e) ? errorText(e.kind, e.message) : errorText('unknown', e instanceof Error ? e.message : String(e)) };
      }
      setTest({ running: true, result: { ...result } });
    }
    setTest({ running: false, result });
  };

  const choice = settings.engine === 'cloud' && settings.connectionId ? `cloud:${settings.connectionId}` : settings.engine;
  const chosen = settings.engine === 'cloud' ? conns.find((c) => c.id === settings.connectionId) : undefined;
  const chosenPreset = chosen ? ttsPreset(chosen.presetId) : undefined;

  return (
    <section class="opt__section" id="voice" aria-labelledby="voice-h">
      <h2 id="voice-h">{i18n.t('options.voice.title')}</h2>
      <p class="opt__hint">{i18n.t('options.voice.hint')}</p>
      <div class="opt__row">
        <label for="voice-engine">{i18n.t('options.voice.engine')}</label>
        <Select
          id="voice-engine"
          data-testid="voice-engine"
          value={choice}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            void update(v.startsWith('cloud:') ? { engine: 'cloud', connectionId: v.slice(6) } : { engine: v as TtsSettings['engine'] });
          }}
        >
          <option value="system">{i18n.t('options.voice.engineSystem')}</option>
          {conns.map((c) => (
            <option key={c.id} value={`cloud:${c.id}`}>
              {ttsPreset(c.presetId)?.label ?? c.presetId}
            </option>
          ))}
        </Select>
      </div>
      {chosenPreset ? (
        <p class="opt__hint" data-testid="voice-sends">
          {i18n.t('options.voice.sendsText', [chosenPreset.label])}
          {chosenPreset.id === 'gemini' ? ` ${i18n.t('options.voice.geminiFreeTier')}` : ''}
        </p>
      ) : null}
      {VOICE_LANGS.map((lang) => (
        <div class="opt__row" key={lang}>
          <label for={`voice-${lang}`}>{i18n.t('options.voice.voiceFor', [LANG_NAME[lang]()])}</label>
          <Select id={`voice-${lang}`} data-testid={`voice-${lang}`} value={settings.voices[lang] ?? ''} onChange={(e) => pickVoice(lang, (e.target as HTMLSelectElement).value)}>
            <option value="">{voices[lang].length > 0 ? i18n.t('options.voice.automatic') : i18n.t('options.voice.errors.noVoice')}</option>
            {voices[lang].map((v) => (
              <option key={v.id} value={v.id}>
                {v.remote && settings.engine === 'system' ? i18n.t('options.voice.online', [v.name]) : v.name}
              </option>
            ))}
          </Select>
        </div>
      ))}
      <div class="opt__row">
        <input id="voice-read-on" type="checkbox" data-testid="voice-read-on" checked={settings.readOn} onChange={(e) => void update({ readOn: (e.target as HTMLInputElement).checked })} />
        <label for="voice-read-on">{i18n.t('options.voice.readOn')}</label>
      </div>
      <div class="opt__row">
        <Button data-testid="voice-test" disabled={test.running} onClick={() => void runTest()}>
          {test.running ? i18n.t('options.voice.testing') : i18n.t('options.voice.test')}
        </Button>
        <span role="status" data-testid="voice-test-result">
          {VOICE_LANGS.flatMap((l) => {
            const r = test.result[l];
            return r ? [r.ok ? i18n.t('options.voice.testOk', [LANG_NAME[l]()]) : i18n.t('options.voice.testFailed', [LANG_NAME[l](), r.text])] : [];
          }).join(' · ')}
        </span>
      </div>
      {conns.length > 0 ? (
        <ul class="opt__glossary" data-testid="voice-providers">
          {conns.map((c) => (
            <li key={c.id}>
              <span>{ttsPreset(c.presetId)?.label ?? c.presetId}</span>{' '}
              <Button data-testid={`voice-remove-${c.presetId}`} onClick={() => void removeTtsConnection(api, c.id).then(reload)}>
                {i18n.t('options.voice.remove')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {adding ? (
        <AddProvider
          api={api}
          reusable={reusable}
          onDone={(saved) => {
            setAdding(false);
            if (saved) void update({ engine: 'cloud', connectionId: saved.id }).then(reload);
          }}
        />
      ) : (
        <p>
          <Button data-testid="voice-add" onClick={() => setAdding(true)}>
            {i18n.t('options.voice.addProvider')}
          </Button>
        </p>
      )}
    </section>
  );
}

function AddProvider({ api, reusable, onDone }: { api: Browser; reusable: readonly Reusable[]; onDone(saved?: TtsConnection): void }) {
  const [presetId, setPresetId] = useState<TtsPresetId>('gemini');
  const [key, setKey] = useState('');
  const [region, setRegion] = useState('');
  const [appId, setAppId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [reuse, setReuse] = useState<string>('');
  const [error, setError] = useState('');
  const preset = ttsPreset(presetId) ?? TTS_PRESETS[0];
  if (!preset) return null;
  // A key is reused only at the service's own address: not with a server address of the reader's.
  const reusableHere = baseUrl.trim() ? [] : reusable.filter((r) => r.presetId === presetId);
  const reuseOn = reuse !== '' && reusableHere.some((r) => r.connectionId === reuse);

  const onSubmit = (e: Event) => {
    e.preventDefault();
    const missing = !reuseOn && key.trim() === '' ? i18n.t('options.voice.key') : preset.needsRegion && !region.trim() ? i18n.t('options.voice.region') : preset.needsAppId && !appId.trim() ? i18n.t('options.voice.appId') : '';
    if (missing) {
      setError(i18n.t('options.voice.missingField', [missing]));
      return;
    }
    const base = preset.editableBaseUrl && baseUrl.trim() ? baseUrl.trim() : preset.baseUrl;
    let origin = preset.origin;
    if (preset.editableBaseUrl && baseUrl.trim()) {
      try {
        origin = originPattern(base);
      } catch {
        setError(i18n.t('options.voice.badUrl'));
        return;
      }
    }
    // In the click, before any await: Chrome asks only during a user gesture.
    void api.permissions
      .request({ origins: [origin] })
      .catch(() => false)
      .then(async (granted) => {
        if (!granted) {
          setError(i18n.t('options.voice.permissionDenied', [preset.label]));
          return;
        }
        const conn: TtsConnection = {
          id: ttsConnectionId(preset.id),
          presetId: preset.id,
          baseUrl: base,
          ...(region.trim() ? { region: region.trim() } : {}),
          ...(appId.trim() ? { appId: appId.trim() } : {}),
          ...(model.trim() ? { model: model.trim() } : {}),
          ...(reuseOn ? { keyFrom: reuse } : {}),
        };
        onDone(await saveTtsConnection(api, conn, reuseOn ? undefined : key));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <form data-testid="voice-add-form" onSubmit={onSubmit}>
      <div class="opt__row">
        <label for="voice-preset">{i18n.t('options.voice.provider')}</label>
        <Select
          id="voice-preset"
          data-testid="voice-preset"
          value={presetId}
          onChange={(e) => {
            setPresetId((e.target as HTMLSelectElement).value as TtsPresetId);
            setReuse('');
            setError('');
          }}
        >
          {TTS_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.langs?.length === 1 ? i18n.t('options.voice.viOnly', [p.label]) : p.label}
            </option>
          ))}
        </Select>
      </div>
      {reusableHere.map((r) => (
        <div class="opt__row" key={r.connectionId}>
          <input id={`voice-reuse-${r.connectionId}`} type="checkbox" data-testid="voice-reuse" checked={reuse === r.connectionId} onChange={(e) => setReuse((e.target as HTMLInputElement).checked ? r.connectionId : '')} />
          <label for={`voice-reuse-${r.connectionId}`}>{i18n.t('options.voice.reuseKey', [r.label])}</label>
        </div>
      ))}
      {reuseOn ? null : (
        <div class="opt__row">
          <label for="voice-key">{i18n.t('options.voice.key')}</label>
          <input id="voice-key" data-testid="voice-key" type="password" autocomplete="off" value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value)} />
          <a href={preset.keyUrl} target="_blank" rel="noreferrer">
            {i18n.t('options.voice.keyHelp')}
          </a>
        </div>
      )}
      {preset.needsRegion ? (
        <div class="opt__row">
          <label for="voice-region">{i18n.t('options.voice.region')}</label>
          <input id="voice-region" data-testid="voice-region" placeholder="southeastasia" value={region} onInput={(e) => setRegion((e.target as HTMLInputElement).value)} />
        </div>
      ) : null}
      {preset.needsAppId ? (
        <div class="opt__row">
          <label for="voice-app-id">{i18n.t('options.voice.appId')}</label>
          <input id="voice-app-id" data-testid="voice-app-id" value={appId} onInput={(e) => setAppId((e.target as HTMLInputElement).value)} />
        </div>
      ) : null}
      {preset.editableBaseUrl ? (
        <div class="opt__row">
          <label for="voice-base">{i18n.t('options.voice.baseUrl')}</label>
          <input id="voice-base" data-testid="voice-base" placeholder={preset.baseUrl} value={baseUrl} onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)} />
        </div>
      ) : null}
      {preset.model ? (
        <div class="opt__row">
          <label for="voice-model">{i18n.t('options.voice.model')}</label>
          <input id="voice-model" data-testid="voice-model" placeholder={preset.model} value={model} onInput={(e) => setModel((e.target as HTMLInputElement).value)} />
        </div>
      ) : null}
      {error ? (
        <p class="opt__status opt__status--warn" role="alert" data-testid="voice-add-error">
          {error}
        </p>
      ) : null}
      <div class="opt__row">
        <Button type="submit" variant="primary" data-testid="voice-save">
          {i18n.t('options.voice.save')}
        </Button>
        <Button data-testid="voice-cancel" onClick={() => onDone()}>
          {i18n.t('options.voice.cancel')}
        </Button>
      </div>
    </form>
  );
}
