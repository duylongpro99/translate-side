// Options v0 (plan M1-E9, user decision M1-D13): the Gemini key, the target language and a
// source-language override. One hard-wired connection; providers, presets, Test connection and
// routing are M4 (DESIGN.md §4.3.3 A).
import { useEffect, useState } from 'preact/hooks';
import type { browser } from 'wxt/browser';
import {
  GEMINI_CONNECTION,
  GEMINI_ORIGIN,
  GEMINI_PROFILE,
  LANGUAGES,
  hasHostPermission,
  maskKey,
  readApiKey,
  readPreferences,
  removeApiKey,
  saveApiKey,
  savePreferences,
  type Preferences,
} from '@/shared/settings';

type Browser = typeof browser;

const KEY_URL = 'https://aistudio.google.com/apikey';

function KeySection({ api }: { api: Browser }) {
  const [saved, setSaved] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [access, setAccess] = useState<boolean | undefined>();
  const [note, setNote] = useState('');

  const refresh = async () => {
    setSaved(await readApiKey(api, GEMINI_CONNECTION.id));
    setAccess(await hasHostPermission(api, GEMINI_CONNECTION.baseUrl));
  };
  useEffect(() => {
    void refresh();
    // refresh() reads storage only; once on mount.
  }, []);

  // The permission request must be the first call in the click (a user gesture, §4.3.3 step 3):
  // no await before it.
  const requestAccess = () =>
    api.permissions.request({ origins: [GEMINI_ORIGIN] }).then(
      (granted) => granted,
      () => false,
    );

  const onSave = (e: Event) => {
    e.preventDefault();
    const key = draft.trim();
    if (key === '') return;
    const granted = requestAccess();
    void (async () => {
      await saveApiKey(api, GEMINI_CONNECTION.id, key);
      setDraft('');
      const ok = await granted;
      setNote(ok ? 'Saved.' : 'Saved, but Translate Side has no access to the Gemini API yet. Grant it below.');
      await refresh();
    })();
  };
  const onGrant = () => {
    void requestAccess().then(() => refresh());
  };
  const onRemove = () => {
    void (async () => {
      await removeApiKey(api, GEMINI_CONNECTION.id);
      // §4.3.4: removing the connection's key also gives back its host permission.
      await api.permissions.remove({ origins: [GEMINI_ORIGIN] }).catch(() => false);
      setNote('Key removed.');
      await refresh();
    })();
  };

  return (
    <section class="opt__section" aria-labelledby="key-h">
      <h2 id="key-h">Google Gemini</h2>
      <p class="opt__hint">
        Translations use <code>{GEMINI_PROFILE.model}</code> through Gemini's OpenAI-compatible API. Other providers come in a later version.
      </p>
      <form onSubmit={onSave} class="opt__row">
        <label for="key">API key</label>
        <input
          id="key"
          type="password"
          autocomplete="off"
          spellcheck={false}
          placeholder={saved ? `Saved: ${maskKey(saved)} (enter a new key to replace it)` : 'Paste your Gemini API key'}
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
        />
        <button type="submit" disabled={draft.trim() === ''}>
          Save
        </button>
      </form>
      <p class="opt__status" data-testid="key-status">
        {saved ? (
          <>
            Key saved: <code data-testid="masked-key">{maskKey(saved)}</code>{' '}
            <button type="button" class="opt__link" onClick={onRemove}>
              Remove
            </button>
          </>
        ) : (
          <>
            No key yet.{' '}
            <a href={KEY_URL} target="_blank" rel="noreferrer">
              Get a key ↗
            </a>
          </>
        )}
      </p>
      {saved && access === false ? (
        <p class="opt__status opt__status--warn" data-testid="access-status">
          No access to generativelanguage.googleapis.com.{' '}
          <button type="button" onClick={onGrant}>
            Grant access
          </button>
        </p>
      ) : null}
      {note ? (
        <p class="opt__note" role="status">
          {note}
        </p>
      ) : null}
      <p class="opt__honest">
        Your key is stored on this device only and is never synced. Anyone with access to this browser profile could read it. Use a key with a spending
        limit.
      </p>
    </section>
  );
}

function LanguageSection({ api }: { api: Browser }) {
  const [prefs, setPrefs] = useState<Preferences | undefined>();
  useEffect(() => {
    void readPreferences(api).then(setPrefs);
  }, []);
  if (!prefs) return null;
  const update = (patch: Partial<Preferences>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    void savePreferences(api, next);
  };
  /** The curated list, plus a stored code that is not on it, so it stays selected. */
  const options = (selected: string) => (
    <>
      {selected === 'auto' || LANGUAGES.some((l) => l.code === selected) ? null : <option value={selected}>{selected}</option>}
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.name}
        </option>
      ))}
    </>
  );
  return (
    <section class="opt__section" aria-labelledby="lang-h">
      <h2 id="lang-h">Languages</h2>
      <div class="opt__row">
        <label for="target">Translate into</label>
        <select id="target" value={prefs.targetLang} onChange={(e) => update({ targetLang: (e.target as HTMLSelectElement).value })}>
          {options(prefs.targetLang)}
        </select>
      </div>
      <div class="opt__row">
        <label for="source">Page language</label>
        <select id="source" value={prefs.sourceLang} onChange={(e) => update({ sourceLang: (e.target as HTMLSelectElement).value })}>
          <option value="auto">As the page declares it</option>
          {options(prefs.sourceLang)}
        </select>
      </div>
      <p class="opt__hint">Set the page language only if pages come out wrong: it overrides what every page says about itself.</p>
    </section>
  );
}

export function Options({ api }: { api: Browser }) {
  return (
    <main class="opt">
      <h1>Translate Side settings</h1>
      <KeySection api={api} />
      <LanguageSection api={api} />
    </main>
  );
}
