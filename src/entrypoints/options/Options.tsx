// Options v0 (plan M1-E9, user decision M1-D13): the provider key (APIBOX by default, M2-D11), the
// target language and a source-language override. The host-permission text and origin come from the
// connection's base URL. One hard-wired connection; providers, presets, Test connection and
// routing are M4 (DESIGN.md §4.3.3 A). M2-E6 adds the translation style, the gloss setting and
// the personal glossary editor (storage.sync, with the quota guard in shared/settings.ts).
import { useEffect, useState } from 'preact/hooks';
import type { browser } from 'wxt/browser';
import {
  DEFAULT_BUDGET_TOKENS,
  DEFAULT_CONNECTION,
  DEFAULT_HOST,
  DEFAULT_ORIGIN,
  DEFAULT_PROFILE,
  GLOSS_MODES,
  LANGUAGES,
  MAX_BUDGET_TOKENS,
  STYLES,
  cleanBudget,
  hasHostPermission,
  maskKey,
  readApiKey,
  readGlossary,
  readPreferences,
  removeApiKey,
  saveApiKey,
  saveGlossary,
  updatePreferences,
  type Preferences,
} from '@/shared/settings';
import { openTranslationCache, type CacheStats, type TranslationCache } from '@/shared/cache';
import { PERSONAL_GLOSSARY_PROMPT_TOKENS, personalGlossaryTokens } from '@/engine/context/budget';
import type { GlossaryEntry, GlossMode, StyleMode } from '@/engine/types';

type Browser = typeof browser;

/** Where to get a key, per connection preset. */
const KEY_URLS: Record<string, string> = { gemini: 'https://aistudio.google.com/apikey', apibox: 'https://api.ai-box.vn/' };
const KEY_URL = KEY_URLS[DEFAULT_CONNECTION.presetId];

function KeySection({ api }: { api: Browser }) {
  const [saved, setSaved] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [access, setAccess] = useState<boolean | undefined>();
  const [note, setNote] = useState('');

  const refresh = async () => {
    setSaved(await readApiKey(api, DEFAULT_CONNECTION.id));
    setAccess(await hasHostPermission(api, DEFAULT_CONNECTION.baseUrl));
  };
  useEffect(() => {
    void refresh();
    // refresh() reads storage only; once on mount.
  }, []);

  // The permission request must be the first call in the click (a user gesture, §4.3.3 step 3):
  // no await before it.
  const requestAccess = () =>
    api.permissions.request({ origins: [DEFAULT_ORIGIN] }).then(
      (granted) => granted,
      () => false,
    );

  const onSave = (e: Event) => {
    e.preventDefault();
    const key = draft.trim();
    if (key === '') return;
    const granted = requestAccess();
    void (async () => {
      await saveApiKey(api, DEFAULT_CONNECTION.id, key);
      // The key is stored: show it (masked) now, not once the permission prompt is answered (review E-T1).
      setSaved(key);
      setDraft('');
      const ok = await granted;
      setNote(ok ? 'Saved.' : `Saved, but Translate Side has no access to ${DEFAULT_HOST} yet. Grant it below.`);
      await refresh();
    })();
  };
  const onGrant = () => {
    void requestAccess().then(() => refresh());
  };
  const onRemove = () => {
    void (async () => {
      await removeApiKey(api, DEFAULT_CONNECTION.id);
      // §4.3.4: removing the connection's key also gives back its host permission.
      await api.permissions.remove({ origins: [DEFAULT_ORIGIN] }).catch(() => false);
      setNote('Key removed.');
      await refresh();
    })();
  };

  return (
    <section class="opt__section" aria-labelledby="key-h">
      <h2 id="key-h">{DEFAULT_CONNECTION.label}</h2>
      <p class="opt__hint">
        Translations use <code>{DEFAULT_PROFILE.model}</code> through {DEFAULT_CONNECTION.label}'s OpenAI-compatible API at <code>{DEFAULT_HOST}</code>. Other providers come in a later
        version.
      </p>
      <form onSubmit={onSave} class="opt__row">
        <label for="key">API key</label>
        <input
          id="key"
          type="password"
          autocomplete="off"
          spellcheck={false}
          placeholder={saved ? `Saved: ${maskKey(saved)} (enter a new key to replace it)` : `Paste your ${DEFAULT_CONNECTION.label} API key`}
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
            {KEY_URL ? (
              <a href={KEY_URL} target="_blank" rel="noreferrer">
                Get a key ↗
              </a>
            ) : null}
          </>
        )}
      </p>
      {saved && access === false ? (
        <p class="opt__status opt__status--warn" data-testid="access-status">
          No access to {DEFAULT_HOST}.{' '}
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
  // Queued on what was stored last: the other section writes the same item.
  const update = (patch: Partial<Preferences>) => {
    setPrefs({ ...prefs, ...patch });
    void updatePreferences(api, patch);
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

const STYLE_TEXT: Record<StyleMode, { label: string; hint: string }> = {
  natural: { label: 'Natural', hint: 'Reads as if written in your language.' },
  faithful: { label: 'Faithful', hint: 'Closer to the original wording and sentence structure.' },
  simplified: { label: 'Simplified', hint: 'Short sentences and plain words, for easier reading.' },
};
const GLOSS_TEXT: Record<GlossMode, string> = {
  first: 'Explain a term once, where it first appears',
  off: 'Never explain terms in parentheses',
};

function StyleSection({ api }: { api: Browser }) {
  const [prefs, setPrefs] = useState<Preferences | undefined>();
  useEffect(() => {
    void readPreferences(api).then(setPrefs);
  }, []);
  if (!prefs) return null;
  // Queued on what was stored last: the other section writes the same item.
  const update = (patch: Partial<Preferences>) => {
    setPrefs({ ...prefs, ...patch });
    void updatePreferences(api, patch);
  };
  return (
    <section class="opt__section" aria-labelledby="style-h">
      <h2 id="style-h">Translation style</h2>
      <div class="opt__row">
        <label for="style">Style</label>
        <select id="style" value={prefs.style} onChange={(e) => update({ style: (e.target as HTMLSelectElement).value as StyleMode })}>
          {STYLES.map((s) => (
            <option key={s} value={s}>
              {STYLE_TEXT[s].label}
            </option>
          ))}
        </select>
      </div>
      <p class="opt__hint" data-testid="style-hint">
        {STYLE_TEXT[prefs.style].hint}
      </p>
      <div class="opt__row">
        <label for="gloss">Terms</label>
        <select id="gloss" value={prefs.gloss} onChange={(e) => update({ gloss: (e.target as HTMLSelectElement).value as GlossMode })}>
          {GLOSS_MODES.map((g) => (
            <option key={g} value={g}>
              {GLOSS_TEXT[g]}
            </option>
          ))}
        </select>
      </div>
      <p class="opt__hint">A change retranslates the page open in the panel.</p>
      <div class="opt__row">
        <label for="budget">Token budget per page</label>
        <input
          id="budget"
          type="number"
          min={0}
          max={MAX_BUDGET_TOKENS}
          step={10000}
          value={prefs.budgetTokens}
          // An emptied field is the default, not 0 (no limit): review D-N7.
          onChange={(e) => {
            const raw = (e.target as HTMLInputElement).value.trim();
            update({ budgetTokens: raw === '' ? DEFAULT_BUDGET_TOKENS : cleanBudget(Number(raw)) });
          }}
        />
      </div>
      <p class="opt__hint" data-testid="budget-hint">
        Input and output tokens for one page, every model call included; 0 for no limit, empty for the default. What is left untranslated when it runs out is marked as skipped.
      </p>
    </section>
  );
}

interface Draft {
  term: string;
  rendering: string;
  keep: boolean;
  /** An entry's note has no field here; an edit carries it over unchanged. */
  note?: string;
}
const emptyDraft: Draft = { term: '', rendering: '', keep: true };
const draftOf = (e: GlossaryEntry): Draft => ({ term: e.term, rendering: e.rendering === e.term ? '' : e.rendering, keep: e.rendering === e.term, ...(e.note ? { note: e.note } : {}) });
const entryOf = (d: Draft): GlossaryEntry => ({
  term: d.term.trim(),
  rendering: d.keep || d.rendering.trim() === '' ? d.term.trim() : d.rendering.trim(),
  ...(d.note?.trim() ? { note: d.note.trim() } : {}),
});

function GlossarySection({ api }: { api: Browser }) {
  const [entries, setEntries] = useState<GlossaryEntry[] | undefined>();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  /** Index of the entry being edited; undefined while adding. */
  const [editing, setEditing] = useState<number | undefined>();
  const [note, setNote] = useState<{ text: string; warn: boolean } | undefined>();
  useEffect(() => {
    void readGlossary(api).then(setEntries);
  }, []);
  if (!entries) return null;

  const save = async (next: GlossaryEntry[]): Promise<boolean> => {
    const result = await saveGlossary(api, next);
    if (!result.ok) {
      setNote({ text: result.message, warn: true });
      return false;
    }
    setEntries(result.entries);
    setNote(result.warning ? { text: result.warning, warn: true } : undefined);
    return true;
  };
  const onSubmit = (e: Event) => {
    e.preventDefault();
    const entry = entryOf(draft);
    if (entry.term === '') return;
    const key = entry.term.toLowerCase();
    const clash = entries.findIndex((x, i) => i !== editing && x.term.toLowerCase() === key);
    if (clash >= 0) {
      setNote({ text: `"${entries[clash]?.term}" is already in the glossary.`, warn: true });
      return;
    }
    const next = editing === undefined ? [...entries, entry] : entries.map((x, i) => (i === editing ? entry : x));
    void save(next).then((ok) => {
      if (!ok) return;
      setDraft(emptyDraft);
      setEditing(undefined);
    });
  };
  const onEdit = (i: number) => {
    const e = entries[i];
    if (!e) return;
    setEditing(i);
    setDraft(draftOf(e));
  };
  const onCancel = () => {
    setEditing(undefined);
    setDraft(emptyDraft);
  };
  const onRemove = (i: number) => {
    void save(entries.filter((_, k) => k !== i)).then((ok) => {
      if (ok && editing !== undefined) onCancel();
    });
  };

  return (
    <section class="opt__section" aria-labelledby="glossary-h">
      <h2 id="glossary-h">Personal glossary</h2>
      <p class="opt__hint">Terms you always want rendered one way, for example keep “deploy” in English. Your entries take priority over the terms Translate Side finds in each page.</p>
      {entries.length ? (
        <ul class="opt__glossary" data-testid="glossary-list">
          {entries.map((e, i) => (
            <li key={e.term} data-testid="glossary-entry">
              <span class="opt__term">{e.term}</span> →{' '}
              {e.rendering === e.term ? <em>keep as is</em> : <span class="opt__term">{e.rendering}</span>}
              {e.note ? <span class="opt__hint"> · {e.note}</span> : null}{' '}
              <button type="button" class="opt__link" onClick={() => onEdit(i)} aria-label={`Edit ${e.term}`}>
                Edit
              </button>{' '}
              <button type="button" class="opt__link" onClick={() => onRemove(i)} aria-label={`Remove ${e.term}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="opt__status" data-testid="glossary-empty">
          No entries yet.
        </p>
      )}
      <form onSubmit={onSubmit} class="opt__row" data-testid="glossary-form">
        <label for="g-term">Term</label>
        <input id="g-term" value={draft.term} maxLength={120} onInput={(e) => setDraft({ ...draft, term: (e.target as HTMLInputElement).value })} />
        <label class="opt__check">
          <input type="checkbox" id="g-keep" checked={draft.keep} onChange={(e) => setDraft({ ...draft, keep: (e.target as HTMLInputElement).checked })} /> Keep as is
        </label>
        <label for="g-rendering">Translate as</label>
        <input
          id="g-rendering"
          value={draft.keep ? '' : draft.rendering}
          maxLength={200}
          disabled={draft.keep}
          onInput={(e) => setDraft({ ...draft, rendering: (e.target as HTMLInputElement).value })}
        />
        <button type="submit" disabled={draft.term.trim() === ''}>
          {editing === undefined ? 'Add' : 'Save'}
        </button>
        {editing !== undefined ? (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </form>
      {personalGlossaryTokens(entries) > PERSONAL_GLOSSARY_PROMPT_TOKENS ? (
        <p class="opt__status opt__status--warn" data-testid="glossary-share">
          Your glossary is longer than fits in a translation request (about {personalGlossaryTokens(entries)} of {PERSONAL_GLOSSARY_PROMPT_TOKENS} tokens): the entries at the end of the list
          are left out. Keep the ones that matter most near the top.
        </p>
      ) : null}
      {note ? (
        <p class={note.warn ? 'opt__status opt__status--warn' : 'opt__note'} role="status" data-testid="glossary-note">
          {note.text}
        </p>
      ) : null}
    </section>
  );
}

const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(0, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** The translation cache (plan M3-E2): what it holds, and a way to empty it. */
function CacheSection({ cache }: { cache: TranslationCache | undefined }) {
  const [stats, setStats] = useState<CacheStats | undefined | null>();
  const load = () =>
    cache?.stats().then(setStats, () => setStats(null));
  useEffect(() => {
    void load();
    // Reads the cache once on mount.
  }, []);
  if (!cache || stats === null) return null;
  return (
    <section class="opt__section" aria-labelledby="cache-h">
      <h2 id="cache-h">Translation cache</h2>
      <p class="opt__hint" data-testid="cache-stats">
        {stats === undefined ? 'Reading…' : `${stats.entries} translated blocks and ${stats.briefs} document briefs, ${mb(stats.bytes)} of ${mb(stats.maxBytes)}.`}
      </p>
      <p class="opt__hint">Pages you translated again open from this cache at no cost. The oldest entries go first when it is full. It stays on this device.</p>
      <div class="opt__row">
        <button type="button" data-testid="cache-clear" onClick={() => void cache.clear().then(load, () => setStats(null))}>
          Clear cache
        </button>
      </div>
    </section>
  );
}

export function Options({ api, cache = openTranslationCache() }: { api: Browser; cache?: TranslationCache | undefined }) {
  return (
    <main class="opt">
      <h1>Translate Side settings</h1>
      <KeySection api={api} />
      <LanguageSection api={api} />
      <StyleSection api={api} />
      <GlossarySection api={api} />
      <CacheSection cache={cache} />
    </main>
  );
}
