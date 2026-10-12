// The options page (plan M1-E9, user decision M1-D13): Providers (connections, models, routing,
// each connection's key and host permission; plan M4 sub-goal C, ./Providers.tsx), the target
// language and a source-language override. M2-E6 adds the translation style, the gloss setting
// and the personal glossary editor (storage.sync, with the quota guard in shared/settings.ts).
import { useEffect, useState } from 'preact/hooks';
import { i18n } from '#i18n';
import { slots } from '../sidepanel/slots.tsx';
import type { browser } from 'wxt/browser';
import {
  DEFAULT_BUDGET_TOKENS,
  DEFAULT_CONNECTION,
  DEFAULT_PROFILE,
  GLOSS_MODES,
  LANGUAGES,
  MAX_BUDGET_TOKENS,
  SECRET_PREFIX,
  STYLES,
  cleanBudget,
  GLOSSARY_KEY,
  readGlossary,
  readPreferences,
  saveGlossary,
  updatePreferences,
  type ModelProfile,
  type Preferences,
  type ProviderConnection,
} from '@/shared/settings';
import { onProviderSettingsChanged, readProviderSettings, resolveRoute, type ProviderSettings } from '@/shared/providers';
import { isOverflowed, onListChanged, OVERFLOW_NOTICE } from '@/shared/sync-quota';
import { openOnboarding } from '@/shared/onboarding';
import { ProvidersSection, type AdapterFor } from './Providers.tsx';
import { TransferSection } from './Transfer.tsx';
import { DiagnosticsSection } from './Diagnostics.tsx';
import { SCREEN_READER_NOTE, SHORTCUTS } from '@/shared/shortcuts';
import { openShortcutSettings, toggleRow, useToggleShortcut } from '@/shared/toggle-shortcut';
import { openTranslationCache, type CacheStats, type TranslationCache } from '@/shared/cache';
import { formatUsd } from '@/shared/cost';
import { pricingFor } from '@/shared/pricing';
import { estimateSpend, monthKey, readSpend, readSpendLimit, resetSpend, saveSpendLimit, SPEND_KEY, SPEND_LIMIT_KEY, type SpendLimit, type SpendTotals } from '@/shared/spend';
import { PERSONAL_GLOSSARY_PROMPT_TOKENS, personalGlossaryTokens } from '@/engine/context/budget';
import type { GlossaryEntry, GlossMode, StyleMode } from '@/engine/types';
import { addAllowlisted, addNever, MAX_SITES, readSiteLists, removeAllowlisted, removeNever, requestSitePermission, SITE_ALLOWLIST_KEY, SITE_NEVER_KEY, siteOrigins, sitePattern, type SiteLists } from '@/shared/sites';

type Browser = typeof browser;

interface TranslateRoute {
  connection: ProviderConnection;
  profile: ModelProfile;
}

/**
 * The connection and profile the default translate route uses (src/shared/providers.ts, no site
 * rule or tab override): the built-in default until storage answers.
 */
function useTranslateRoute(api: Browser): TranslateRoute {
  const [route, setRoute] = useState<TranslateRoute>({ connection: DEFAULT_CONNECTION, profile: DEFAULT_PROFILE });
  useEffect(() => {
    const load = () =>
      resolveRoute(api, 'translate').then(
        (r) => {
          if (r.ok) setRoute({ connection: r.connection, profile: r.profile });
        },
        () => {},
      );
    void load();
    // A route chosen or a key saved in Providers shows here at once (tester C1 #8).
    // A read already in flight may predate the change: wait for it, then read again.
    // Only provider records and keys: not the usage ledger or other settings (review C3 #3).
    const reload = () => void resolveRoute(api, 'translate').finally(load);
    const onLocal = (changes: Record<string, unknown>) => {
      if (Object.keys(changes).some((k) => k.startsWith(SECRET_PREFIX))) reload();
    };
    const stopProviders = onProviderSettingsChanged(api, reload);
    api.storage.local.onChanged.addListener(onLocal);
    return () => {
      stopProviders();
      api.storage.local.onChanged.removeListener(onLocal);
    };
  }, [api]);
  return route;
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
      <h2 id="lang-h">{i18n.t('options.languages.title')}</h2>
      <div class="opt__row">
        <label for="target">{i18n.t('options.languages.target')}</label>
        <select id="target" value={prefs.targetLang} onChange={(e) => update({ targetLang: (e.target as HTMLSelectElement).value })}>
          {options(prefs.targetLang)}
        </select>
      </div>
      <div class="opt__row">
        <label for="source">{i18n.t('options.languages.source')}</label>
        <select id="source" value={prefs.sourceLang} onChange={(e) => update({ sourceLang: (e.target as HTMLSelectElement).value })}>
          <option value="auto">{i18n.t('options.languages.auto')}</option>
          {options(prefs.sourceLang)}
        </select>
      </div>
      <p class="opt__hint">{i18n.t('options.languages.hint')}</p>
    </section>
  );
}

const styleText = (style: StyleMode): { label: string; hint: string } =>
  style === 'natural'
    ? { label: i18n.t('options.style.natural'), hint: i18n.t('options.style.naturalHint') }
    : style === 'faithful'
      ? { label: i18n.t('options.style.faithful'), hint: i18n.t('options.style.faithfulHint') }
      : { label: i18n.t('options.style.simplified'), hint: i18n.t('options.style.simplifiedHint') };
const glossText = (gloss: GlossMode): string => (gloss === 'first' ? i18n.t('options.style.glossFirst') : i18n.t('options.style.glossOff'));

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
      <h2 id="style-h">{i18n.t('options.style.title')}</h2>
      <div class="opt__row">
        <label for="style">{i18n.t('options.style.label')}</label>
        <select id="style" value={prefs.style} onChange={(e) => update({ style: (e.target as HTMLSelectElement).value as StyleMode })}>
          {STYLES.map((s) => (
            <option key={s} value={s}>
              {styleText(s).label}
            </option>
          ))}
        </select>
      </div>
      <p class="opt__hint" data-testid="style-hint">
        {styleText(prefs.style).hint}
      </p>
      <div class="opt__row">
        <label for="gloss">{i18n.t('options.style.terms')}</label>
        <select id="gloss" value={prefs.gloss} onChange={(e) => update({ gloss: (e.target as HTMLSelectElement).value as GlossMode })}>
          {GLOSS_MODES.map((g) => (
            <option key={g} value={g}>
              {glossText(g)}
            </option>
          ))}
        </select>
      </div>
      <p class="opt__hint">{i18n.t('options.style.retranslates')}</p>
      <div class="opt__row">
        <label for="budget">{i18n.t('options.style.budget')}</label>
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
      <div class="opt__row">
        <input id="captions" type="checkbox" checked={prefs.captions} onChange={(e) => update({ captions: (e.target as HTMLInputElement).checked })} />
        <label for="captions">{i18n.t('options.style.captions')}</label>
      </div>
      <div class="opt__row">
        <input id="alt-text" type="checkbox" checked={prefs.altText} onChange={(e) => update({ altText: (e.target as HTMLInputElement).checked })} />
        <label for="alt-text">{i18n.t('options.style.altText')}</label>
      </div>
      <p class="opt__hint" data-testid="media-hint">
        {i18n.t('options.style.mediaHint')}
      </p>
      <p class="opt__hint" data-testid="budget-hint">
        {i18n.t('options.style.budgetHint')}
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
  /** Kept on this device: too large to sync (sync-quota.ts). */
  const [local, setLocal] = useState(false);
  useEffect(() => {
    void readGlossary(api).then(setEntries);
    void isOverflowed(api, GLOSSARY_KEY).then(setLocal, () => {});
  }, []);
  if (!entries) return null;

  const save = async (next: GlossaryEntry[]): Promise<boolean> => {
    const result = await saveGlossary(api, next);
    if (!result.ok) {
      setNote({ text: result.message, warn: true });
      return false;
    }
    setEntries(result.entries);
    setLocal(result.overflow);
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
      setNote({ text: i18n.t('options.glossary.duplicate', [entries[clash]?.term ?? '']), warn: true });
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
      <h2 id="glossary-h">{i18n.t('options.glossary.title')}</h2>
      <p class="opt__hint">{i18n.t('options.glossary.intro')}</p>
      {entries.length ? (
        <ul class="opt__glossary" data-testid="glossary-list">
          {entries.map((e, i) => (
            <li key={e.term} data-testid="glossary-entry">
              <span class="opt__term">{e.term}</span> →{' '}
              {e.rendering === e.term ? <em>{i18n.t('options.glossary.keepShort')}</em> : <span class="opt__term">{e.rendering}</span>}
              {e.note ? <span class="opt__hint"> · {e.note}</span> : null}{' '}
              <button type="button" class="opt__link" onClick={() => onEdit(i)} aria-label={i18n.t('options.glossary.editAria', [e.term])}>
                {i18n.t('options.glossary.edit')}
              </button>{' '}
              <button type="button" class="opt__link" onClick={() => onRemove(i)} aria-label={i18n.t('options.glossary.removeAria', [e.term])}>
                {i18n.t('options.glossary.remove')}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="opt__status" data-testid="glossary-empty">
          {i18n.t('options.glossary.empty')}
        </p>
      )}
      {local ? (
        <p class="opt__status opt__status--warn" role="status" data-testid="glossary-overflow">
          {OVERFLOW_NOTICE}
        </p>
      ) : null}
      <form onSubmit={onSubmit} class="opt__row" data-testid="glossary-form">
        <label for="g-term">{i18n.t('options.glossary.term')}</label>
        <input id="g-term" value={draft.term} maxLength={120} onInput={(e) => setDraft({ ...draft, term: (e.target as HTMLInputElement).value })} />
        <label class="opt__check">
          <input type="checkbox" id="g-keep" checked={draft.keep} onChange={(e) => setDraft({ ...draft, keep: (e.target as HTMLInputElement).checked })} /> {i18n.t('options.glossary.keep')}
        </label>
        <label for="g-rendering">{i18n.t('options.glossary.rendering')}</label>
        <input
          id="g-rendering"
          value={draft.keep ? '' : draft.rendering}
          maxLength={200}
          disabled={draft.keep}
          onInput={(e) => setDraft({ ...draft, rendering: (e.target as HTMLInputElement).value })}
        />
        <button type="submit" disabled={draft.term.trim() === ''}>
          {editing === undefined ? i18n.t('options.glossary.add') : i18n.t('options.glossary.save')}
        </button>
        {editing !== undefined ? (
          <button type="button" onClick={onCancel}>
            {i18n.t('options.glossary.cancel')}
          </button>
        ) : null}
      </form>
      {personalGlossaryTokens(entries) > PERSONAL_GLOSSARY_PROMPT_TOKENS ? (
        <p class="opt__status opt__status--warn" data-testid="glossary-share">
          {i18n.t('options.glossary.tooLong', [String(personalGlossaryTokens(entries)), String(PERSONAL_GLOSSARY_PROMPT_TOKENS)])}
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

/**
 * Site rules (plan M5-E6, DESIGN §7 "auto-translate when the panel is open / never translate",
 * §8): the sites whose pages translate by themselves while the panel is open (each one asks for
 * its host permission, plan §5), and the sites Translate Side never reads, like the built-in
 * denylist (D23). The model per site is under Providers › Routing.
 */
function SitesSection({ api }: { api: Browser }) {
  const [lists, setLists] = useState<SiteLists | undefined>();
  /**
   * Allowlisted sites missing a permission (refused, or removed in chrome://extensions), and which:
   * both schemes, or only one. A page is checked against its own scheme (sites.ts
   * hasSitePermission), so a site with only http granted does not translate its https pages by
   * itself, and says so here (review R3).
   */
  const [noAccess, setNoAccess] = useState<Record<string, 'all' | 'https' | 'http'>>({});
  const [allowInput, setAllowInput] = useState('');
  const [neverInput, setNeverInput] = useState('');
  const [note, setNote] = useState<{ text: string; warn: boolean } | undefined>();
  /** Lists kept on this device: too large to sync (sync-quota.ts). */
  const [local, setLocal] = useState(false);
  const load = () =>
    readSiteLists(api).then(
      async (l) => {
        setLists(l);
        void Promise.all([SITE_ALLOWLIST_KEY, SITE_NEVER_KEY].map((k) => isOverflowed(api, k))).then((o) => setLocal(o.includes(true)), () => {});
        const held = (origin: string) => api.permissions.contains({ origins: [origin] }).catch(() => false);
        const missing = await Promise.all(
          l.allow.map(async (p) => {
            const [https, http] = await Promise.all(siteOrigins(p).map(held));
            return [p, https && http ? null : !https && !http ? 'all' : https ? 'http' : 'https'] as const;
          }),
        );
        setNoAccess(Object.fromEntries(missing.filter((m): m is [string, 'all' | 'https' | 'http'] => m[1] !== null)));
      },
      () => setLists({ allow: [], never: [] }),
    );
  useEffect(() => {
    void load();
    return onListChanged(api, [SITE_ALLOWLIST_KEY, SITE_NEVER_KEY], () => void load());
  }, []);
  if (!lists) return null;

  const failed = (e: unknown) => setNote({ text: e instanceof Error ? e.message : String(e), warn: true });
  /** The click handler: the permission prompt must be its first await (S5). */
  const allow = async (input: string) => {
    const pattern = sitePattern(input);
    if (!pattern) return setNote({ text: i18n.t('options.sites.enterAllow'), warn: true });
    // Full: refuse before the browser asks for a permission that would then go unused (review N2).
    if (!lists.allow.includes(pattern) && lists.allow.length >= MAX_SITES) return setNote({ text: i18n.t('options.sites.full', [String(MAX_SITES)]), warn: true });
    const granted = await requestSitePermission(api, pattern);
    if (!granted) return setNote({ text: i18n.t('options.sites.notGranted', [pattern]), warn: true });
    try {
      await addAllowlisted(api, pattern);
    } catch (e) {
      return failed(e);
    }
    setAllowInput('');
    setNote({ text: lists.never.includes(pattern) ? i18n.t('options.sites.addedOffNever', [pattern]) : i18n.t('options.sites.added', [pattern]), warn: false });
    await load();
  };
  const never = async (input: string) => {
    const pattern = sitePattern(input);
    if (!pattern) return setNote({ text: i18n.t('options.sites.enterNever'), warn: true });
    try {
      await addNever(api, pattern);
    } catch (e) {
      return failed(e);
    }
    setNeverInput('');
    setNote({ text: lists.allow.includes(pattern) ? i18n.t('options.sites.addedOffAuto', [pattern]) : i18n.t('options.sites.added', [pattern]), warn: false });
    await load();
  };
  const run = (p: Promise<unknown>, said: string) =>
    p.then(
      () => (setNote({ text: said, warn: false }), load()),
      failed,
    );
  const list = (sites: string[], kind: 'allow' | 'never') =>
    sites.length ? (
      <ul class="opt__glossary" data-testid={`sites-${kind}`}>
        {sites.map((p) => (
          <li key={p} data-testid="site-entry">
            <span class="opt__term">{p}</span>{' '}
            {kind === 'allow' && noAccess[p] ? (
              <>
                <span class="opt__status--warn" data-testid="site-no-access">
                  {noAccess[p] === 'all' ? i18n.t('options.sites.noAccess') : i18n.t('options.sites.noSchemeAccess', [noAccess[p] as string])} ·{' '}
                </span>
                <button type="button" class="opt__link" onClick={() => void allow(p)} aria-label={i18n.t('options.sites.grantAria', [p])}>
                  {i18n.t('options.sites.grant')}
                </button>{' '}
              </>
            ) : null}
            <button type="button" class="opt__link" aria-label={i18n.t('options.sites.removeAria', [p])} onClick={() => void run(kind === 'allow' ? removeAllowlisted(api, p) : removeNever(api, p), i18n.t('options.sites.removed', [p]))}>
              {i18n.t('options.sites.remove')}
            </button>
          </li>
        ))}
      </ul>
    ) : (
      <p class="opt__status">{i18n.t('options.sites.none')}</p>
    );
  return (
    <section class="opt__section" id="sites" aria-labelledby="sites-h">
      <h2 id="sites-h">{i18n.t('options.sites.title')}</h2>
      {local ? (
        <p class="opt__status opt__status--warn" role="status" data-testid="sites-overflow">
          {OVERFLOW_NOTICE}
        </p>
      ) : null}
      <h3>{i18n.t('options.sites.allowTitle')}</h3>
      <p class="opt__hint">
        {i18n.t('options.sites.allowHint')}
      </p>
      {list(lists.allow, 'allow')}
      <form
        class="opt__row"
        data-testid="sites-allow-form"
        onSubmit={(e) => {
          e.preventDefault();
          void allow(allowInput);
        }}
      >
        <input aria-label={i18n.t('options.sites.allowAria')} placeholder={i18n.t('options.sites.allowPlaceholder')} value={allowInput} onInput={(e) => setAllowInput((e.target as HTMLInputElement).value)} />
        <button type="submit" disabled={allowInput.trim() === ''}>
          {i18n.t('options.sites.add')}
        </button>
      </form>
      <h3>{i18n.t('options.sites.neverTitle')}</h3>
      <p class="opt__hint">
        {i18n.t('options.sites.neverHint')}
      </p>
      {list(lists.never, 'never')}
      <form
        class="opt__row"
        data-testid="sites-never-form"
        onSubmit={(e) => {
          e.preventDefault();
          void never(neverInput);
        }}
      >
        <input aria-label={i18n.t('options.sites.neverAria')} placeholder={i18n.t('options.sites.neverPlaceholder')} value={neverInput} onInput={(e) => setNeverInput((e.target as HTMLInputElement).value)} />
        <button type="submit" disabled={neverInput.trim() === ''}>
          {i18n.t('options.sites.add')}
        </button>
      </form>
      <p class="opt__hint">{i18n.t('options.sites.modelHint')}</p>
      {note ? (
        <p class={note.warn ? 'opt__status opt__status--warn' : 'opt__note'} role="status" data-testid="sites-note">
          {note.text}
        </p>
      ) : null}
    </section>
  );
}

const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(0, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** The translation cache (plan M3-E2): what it holds, and a way to empty it. */
/** The panel's keyboard shortcuts (plan M5-E10): the same list the panel's ? button and the README show. */
function ShortcutsSection({ api }: { api: Browser }) {
  const shortcut = useToggleShortcut(api);
  const rows = SHORTCUTS.map((s, i) => (i === 0 ? { ...s, ...toggleRow(shortcut) } : s));
  return (
    <section class="opt__section" id="shortcuts" aria-labelledby="shortcuts-h">
      <h2 id="shortcuts-h">{i18n.t('options.shortcuts.title')}</h2>
      <table class="opt__table" data-testid="shortcuts-table" aria-labelledby="shortcuts-h">
        <thead>
          <tr>
            <th scope="col">{i18n.t('options.shortcuts.keys')}</th>
            <th scope="col">{i18n.t('options.shortcuts.what')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={i}>
              <th scope="row">
                <kbd>{s.keys}</kbd>
              </th>
              <td>{s.what}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="opt__hint">{i18n.t('options.shortcuts.focusHint')}</p>
      <p class="opt__hint">{SCREEN_READER_NOTE}</p>
      <p class="opt__hint">
        <button type="button" class="opt__link" data-testid="shortcut-settings" onClick={() => void openShortcutSettings(api)}>
          {i18n.t('options.shortcuts.change')}
        </button>{' '}
        {i18n.t('options.shortcuts.changeHint')}
      </p>
    </section>
  );
}

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
      <h2 id="cache-h">{i18n.t('options.cache.title')}</h2>
      <p class="opt__hint" data-testid="cache-stats">
        {stats === undefined ? i18n.t('options.reading') : i18n.t('options.cache.stats', [String(stats.entries), String(stats.briefs), mb(stats.bytes), mb(stats.maxBytes)])}
      </p>
      <p class="opt__hint">{i18n.t('options.cache.hint')}</p>
      <div class="opt__row">
        <button type="button" data-testid="cache-clear" onClick={() => void cache.clear().then(load, () => setStats(null))}>
          {i18n.t('options.cache.clear')}
        </button>
      </div>
    </section>
  );
}

const tokens = (n: number) => n.toLocaleString('en-US');
const perM = (usd: number) => `$${Number(usd.toFixed(4))}`;

/**
 * The running total of what translations cost (plan M3-E9), and the price it is computed with;
 * per model profile, today / this month / the month at this rate, and the monthly soft limit (M4-E10).
 */
function SpendSection({ api, now = Date.now }: { api: Browser; now?: () => number }) {
  const [spend, setSpend] = useState<SpendTotals | undefined | null>(null);
  const [limit, setLimit] = useState<SpendLimit | undefined>();
  const [providers, setProviders] = useState<ProviderSettings | undefined>();
  useEffect(() => {
    const load = () => void readSpend(api).then(setSpend, () => setSpend(undefined));
    const loadLimit = () => void readSpendLimit(api).then(setLimit, () => setLimit(undefined));
    const loadProviders = () => void readProviderSettings(api).then(setProviders, () => {});
    load();
    loadLimit();
    loadProviders();
    // Live: a panel translating in another window adds to it, or goes on past the limit.
    const onLocal = (changes: Record<string, unknown>) => {
      if (SPEND_KEY in changes) load();
      if (SPEND_LIMIT_KEY in changes) loadLimit();
    };
    const stopProviders = onProviderSettingsChanged(api, loadProviders);
    api.storage.local.onChanged.addListener(onLocal);
    return () => {
      api.storage.local.onChanged.removeListener(onLocal);
      stopProviders();
    };
  }, [api]);
  const { profile, connection } = useTranslateRoute(api);
  const pricing = pricingFor(profile, connection);
  const builtIn = pricing !== undefined && profile.pricing === undefined;
  const estimate = estimateSpend(spend ?? undefined, now());
  /** A profile by its settings name (model · connection), or its last model when it is gone. */
  const nameOf = (id: string, model: string) => {
    const p = providers?.profiles.find((x) => x.id === id);
    if (!p) return i18n.t('options.spend.removed', [model || id]);
    const c = providers?.connections.find((x) => x.id === p.connectionId);
    return c ? `${p.model} · ${c.label}` : p.model;
  };
  const rows = Object.entries(spend?.profiles ?? {}).sort(([, a], [, b]) => b.usd - a.usd || b.input + b.output - (a.input + a.output));
  return (
    <section class="opt__section" aria-labelledby="spend-h">
      <h2 id="spend-h">{i18n.t('options.spend.title')}</h2>
      <p class="opt__hint" data-testid="spend-price">
        {pricing
          ? i18n.t(builtIn ? 'options.spend.priceBuiltIn' : 'options.spend.price', [profile.model, perM(pricing.inPerM), perM(pricing.cachedInPerM), perM(pricing.outPerM)])
          : i18n.t('options.spend.noPrice', [profile.model])}
      </p>
      {spend === null ? (
        <p class="opt__hint">{i18n.t('options.reading')}</p>
      ) : spend === undefined ? (
        <p class="opt__hint" data-testid="spend-total">
          {i18n.t('options.spend.none')}
        </p>
      ) : (
        <>
          <p data-testid="spend-total">
            {slots(i18n.t('options.spend.total', { total: '{total}', date: new Date(spend.since).toLocaleDateString(), month: formatUsd(estimate.month) }), { total: <strong>{formatUsd(spend.usd)}</strong> })}
          </p>
          <p data-testid="spend-estimate">
            {i18n.t('options.spend.estimate', [formatUsd(estimate.today), formatUsd(estimate.perDay), formatUsd(estimate.monthProjected)])}
          </p>
          <p class="opt__hint" data-testid="spend-tokens">
            {i18n.t('options.spend.tokens', [tokens(spend.input), tokens(spend.cachedInput), tokens(spend.output)])}
            {spend.unpricedTokens > 0 ? ` · ${i18n.t('options.spend.unpriced', [tokens(spend.unpricedTokens)])}` : ''}.
          </p>
          {rows.length ? (
            <table class="opt__table" data-testid="spend-profiles">
              <caption class="opt__hint">{i18n.t('options.spend.byModel', [new Date(spend.since).toLocaleDateString()])}</caption>
              <thead>
                <tr>
                  <th scope="col">{i18n.t('options.spend.model')}</th>
                  <th scope="col">{i18n.t('options.spend.cost')}</th>
                  <th scope="col">{i18n.t('options.spend.tokensInOut')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([id, p]) => (
                  <tr key={id}>
                    <th scope="row">{nameOf(id, p.model)}</th>
                    <td>{p.usd > 0 || p.unpricedTokens === 0 ? formatUsd(p.usd) : i18n.t('options.spend.noPriceShort')}</td>
                    <td>
                      {tokens(p.input)} / {tokens(p.output)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      )}
      <p class="opt__hint">{i18n.t('options.spend.hint')}</p>
      <SpendLimitRow api={api} limit={limit} month={monthKey(now())} onSaved={setLimit} />
      {spend ? (
        <div class="opt__row">
          <button type="button" data-testid="spend-reset" onClick={() => void resetSpend(api).then(() => setSpend(undefined))}>
            {i18n.t('options.spend.reset')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** The monthly soft limit (M4-E10): set, change or remove it; says when "Continue anyway" holds it off. */
function SpendLimitRow({ api, limit, month, onSaved }: { api: Browser; limit: SpendLimit | undefined; month: string; onSaved: (limit: SpendLimit | undefined) => void }) {
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<{ text: string; warn?: boolean } | undefined>();
  useEffect(() => setDraft(limit ? String(limit.monthlyUsd) : ''), [limit?.monthlyUsd]);
  const save = (amount: number | undefined) =>
    void saveSpendLimit(api, amount).then(
      () => {
        onSaved(amount === undefined ? undefined : { monthlyUsd: amount });
        setNote({ text: amount === undefined ? i18n.t('options.spend.limitRemoved') : i18n.t('options.spend.limitSaved') });
      },
      (err: unknown) => setNote({ text: err instanceof Error ? err.message : String(err), warn: true }),
    );
  return (
    <>
      <div class="opt__row">
        <label for="spend-limit">{i18n.t('options.spend.limit')}</label>
        <input
          id="spend-limit"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder={i18n.t('options.spend.limitPlaceholder')}
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save(Number(draft));
          }}
        />
        <button type="button" data-testid="spend-limit-save" disabled={draft.trim() === ''} onClick={() => save(Number(draft))}>
          {i18n.t('options.spend.limitSave')}
        </button>
        {limit ? (
          <button type="button" data-testid="spend-limit-remove" onClick={() => save(undefined)}>
            {i18n.t('options.spend.limitRemove')}
          </button>
        ) : null}
      </div>
      {note ? (
        <p class={note.warn ? 'opt__hint opt__status--warn' : 'opt__hint'} role="status" data-testid="spend-limit-note">
          {note.text}
        </p>
      ) : null}
      {limit?.continuedFor === month ? (
        <p class="opt__hint" data-testid="spend-limit-continued">
          {i18n.t('options.spend.continued')}
        </p>
      ) : null}
      <p class="opt__hint">
        {i18n.t('options.spend.limitHint')}
      </p>
    </>
  );
}

export function Options({ api, cache = openTranslationCache(), adapterFor }: { api: Browser; cache?: TranslationCache | undefined; adapterFor?: AdapterFor }) {
  return (
    <main class="opt">
      <h1>{i18n.t('options.title')}</h1>
      <p class="opt__hint">
        <button type="button" data-testid="open-onboarding" onClick={() => void openOnboarding(api)}>
          {i18n.t('options.guide.button')}
        </button>{' '}
        {i18n.t('options.guide.text')}
      </p>
      <ProvidersSection api={api} {...(adapterFor ? { adapterFor } : {})} />
      <LanguageSection api={api} />
      <StyleSection api={api} />
      <GlossarySection api={api} />
      <SitesSection api={api} />
      <ShortcutsSection api={api} />
      <SpendSection api={api} />
      <CacheSection cache={cache} />
      <TransferSection api={api} />
      <DiagnosticsSection api={api} />
    </main>
  );
}
