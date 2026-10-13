// Settings ▸ Providers (DESIGN.md §4.3.3 A, plan M4 sub-goal C): connections, models and routing,
// and the add / edit connection flow: pick a preset → key → Test connection (asks for that origin
// only, §8) → pick a discovered model → save. Failures say what to do (src/shared/connect.ts); a
// local server's CORS refusal opens its guide and the test runs again by itself (§4.3.6).
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { browser } from 'wxt/browser';
import { i18n } from '#i18n';
import { slots } from '../sidepanel/slots.tsx';
import { createAdapter } from '@/llm/client';
import type { ModelInfo, Protocol, ProtocolAdapter } from '@/llm/types';
import { connectMessage, corsGuide, displayModels, fixBaseUrl, isClaudeModel, preferredProtocol, testConnection, urlFixText, type ConnectMessage, type GuideKind, type GuideStep, type TestResult } from '@/shared/connect';
import { authLabel, pickerGroups, presetBlurb, presetFor, presetNote, presetTitle, protocolLabel, type PresetId } from '@/shared/presets';
import { pricingFor } from '@/shared/pricing';
import { overflowNotice } from '@/shared/sync-quota';
import { BASIC_FALLBACK, isLocalConnection, onProviderSettingsChanged, readProviderSettings, removeConnection, removeProfile, revokeUnusedOrigin, saveConnectionStatus, saveProfile, saveRouting, saveSetup, type ProviderSettings, type SiteRule } from '@/shared/providers';
import { sitePattern } from '@/shared/sites';
import { isPlainHttpRefused, isUnencryptedPrivate } from '@/llm/endpoint';
import { BUILTIN_CONNECTIONS, hasHostPermission, maskKey, originPattern, readApiKey, resolveConnection, SECRET_PREFIX, type ModelProfile, type ProviderConnection } from '@/shared/settings';
import { draftFromConnection, draftFromPreset, fieldsFor, originMoved, testInputOf, toConnection, toProfile, usableStoredKey, type ConnectionDraft, type TestStatus } from './form.ts';

type Browser = typeof browser;
export type AdapterFor = (protocol: Protocol) => ProtocolAdapter;

/** How often a test runs again while a CORS guide is open (§4.3.6 "the test re-runs automatically"), and for how long. */
export const RETEST_MS = 3000;
export const RETEST_FOR_MS = 5 * 60_000;

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
/** The host-permission pattern for a URL, or undefined when it does not parse. */
const safeOrigin = (url: string) => {
  try {
    return originPattern(url);
  } catch {
    return undefined;
  }
};
/** The host a permission covers: match patterns have no port (settings.ts originPattern). */
/**
 * What the Test click asks Chrome for: the origin pattern, which has no port, so every port on
 * that host (tester C1 #3).
 */
export const accessHint = (url: string) => {
  try {
    const u = new URL(url);
    const origin = `${u.protocol}//${u.hostname}`;
    return u.port ? i18n.t('options.providers.accessHintPorts', [origin, u.port]) : i18n.t('options.providers.accessHint', [origin]);
  } catch {
    return i18n.t('options.providers.accessHintServer');
  }
};
const newId = () => (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const perM = (n: number) => `$${Number(n.toFixed(3))}`;

export interface Loaded {
  settings: ProviderSettings;
  /** Connection ids with a key on this device. */
  keyed: Set<string>;
}

export async function load(api: Browser): Promise<Loaded> {
  const settings = await readProviderSettings(api);
  const keyed = new Set<string>();
  for (const c of settings.connections) if ((await readApiKey(api, c.id)) !== undefined) keyed.add(c.id);
  return { settings, keyed };
}

const isImplicit = (s: ProviderSettings, id: string) => s.implicit?.connections.includes(id) === true;
const routedIds = (s: ProviderSettings) => new Set([s.routing.translate, s.routing.analyze, s.routing.review, ...(s.routing.fallback ?? [])].filter((x): x is string => x !== undefined));

/**
 * The connections the list shows: every stored one, and a built-in one that applies only at read
 * time when it has a key here or a route uses it. A keyless, unused built-in is hidden: removing
 * it could not make it go away (carry-over B2).
 */
export function visibleConnections({ settings, keyed }: Loaded): ProviderConnection[] {
  const routed = routedIds(settings);
  return settings.connections.filter((c) => !isImplicit(settings, c.id) || keyed.has(c.id) || settings.profiles.some((p) => p.connectionId === c.id && routed.has(p.id)));
}

/** The models of the visible connections. */
const visibleProfiles = (l: Loaded) => {
  const shown = new Set(visibleConnections(l).map((c) => c.id));
  return l.settings.profiles.filter((p) => shown.has(p.connectionId));
};

const isLocal = (c: ProviderConnection) => presetFor(c.presetId, c.protocol).local !== undefined || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostOf(c.baseUrl).replace(/:\d+$/, ''));

/** What a connection's row says about it. */
function statusOf(c: ProviderConnection, l: Loaded): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  const needsKey = c.auth.style !== 'none' && !l.keyed.has(c.id);
  if (isImplicit(l.settings, c.id)) return needsKey ? { text: i18n.t('options.providers.builtInNoKey'), tone: 'muted' } : { text: i18n.t('options.providers.builtInKey'), tone: 'muted' };
  if (needsKey) return { text: i18n.t('options.providers.noKey'), tone: 'warn' };
  if (c.status === 'error') return { text: `⚠ ${c.lastError ?? i18n.t('options.providers.error')}`, tone: 'warn' };
  if (c.status === 'ok') return { text: `✓ ${i18n.t('options.providers.connected')}`, tone: 'ok' };
  return { text: i18n.t('options.providers.notTested'), tone: 'muted' };
}

const profileName = (p: ModelProfile, connections: readonly ProviderConnection[]) => `${p.model} · ${connections.find((c) => c.id === p.connectionId)?.label ?? '?'}`;

type View = { kind: 'list' } | { kind: 'add' } | { kind: 'edit'; id: string; guide?: boolean | undefined } | { kind: 'model' };

export function ProvidersSection({ api, adapterFor = createAdapter, retestMs = RETEST_MS }: { api: Browser; adapterFor?: AdapterFor; retestMs?: number }) {
  const [loaded, setLoaded] = useState<Loaded | undefined>();
  const [view, setView] = useState<View>({ kind: 'list' });
  const [note, setNote] = useState<{ text: string; warn?: boolean | undefined } | undefined>();
  const reload = () => load(api).then(setLoaded, (err: unknown) => setNote({ text: i18n.t('options.providers.readFailed', [String(err)]), warn: true }));
  useEffect(() => {
    void reload();
    const onLocal = (changes: Record<string, unknown>) => {
      if (Object.keys(changes).some((k) => k.startsWith(SECRET_PREFIX))) void reload();
    };
    const stopProviders = onProviderSettingsChanged(api, () => void reload());
    api.storage.local.onChanged.addListener(onLocal);
    return () => {
      stopProviders();
      api.storage.local.onChanged.removeListener(onLocal);
    };
  }, [api]);

  /** A form replaces the list: the note about the last action goes with it. */
  const open = (next: View) => {
    setNote(undefined);
    setView(next);
  };
  const done = (text?: string) => {
    setView({ kind: 'list' });
    setNote(text ? { text } : undefined);
    void reload();
  };

  return (
    <section class="opt__section" aria-labelledby="providers-h" data-testid="providers">
      <h2 id="providers-h">{i18n.t('options.providers.title')}</h2>
      {!loaded ? (
        <p class="opt__hint">{i18n.t('options.reading')}</p>
      ) : view.kind === 'add' || view.kind === 'edit' ? (
        <ConnectionForm
          api={api}
          adapterFor={adapterFor}
          loaded={loaded}
          editing={view.kind === 'edit' ? loaded.settings.connections.find((c) => c.id === view.id) : undefined}
          openGuide={view.kind === 'edit' && view.guide === true}
          retestMs={retestMs}
          onDone={done}
        />
      ) : view.kind === 'model' ? (
        <ModelForm api={api} adapterFor={adapterFor} loaded={loaded} onDone={done} />
      ) : (
        <>
          <Connections api={api} loaded={loaded} onAdd={() => open({ kind: 'add' })} onEdit={(id, guide) => open({ kind: 'edit', id, guide })} onNote={(text, warn) => (setNote({ text, warn }), void reload())} />
          <Models api={api} loaded={loaded} onAdd={() => open({ kind: 'model' })} onNote={(text, warn) => (setNote({ text, warn }), void reload())} />
          <RoutingView api={api} loaded={loaded} onNote={(text, warn) => (setNote({ text, warn }), void reload())} />
        </>
      )}
      {note ? (
        <p class={note.warn ? 'opt__status opt__status--warn' : 'opt__note'} role="status" data-testid="providers-note">
          {note.text}
        </p>
      ) : null}
      <p class="opt__honest">
        {i18n.t('options.providers.honest')}
      </p>
    </section>
  );
}

// ---- Connections ------------------------------------------------------------------------------

function Connections({ api, loaded, onAdd, onEdit, onNote }: { api: Browser; loaded: Loaded; onAdd: () => void; onEdit: (id: string, guide?: boolean) => void; onNote: (text: string, warn?: boolean) => void }) {
  const [confirm, setConfirm] = useState<string | undefined>();
  const rows = visibleConnections(loaded);
  const remove = (c: ProviderConnection) => {
    setConfirm(undefined);
    const builtIn = isImplicit(loaded.settings, c.id) || BUILTIN_IDS.has(c.id);
    const keyed = loaded.keyed.has(c.id);
    const hasModels = loaded.settings.profiles.some((p) => p.connectionId === c.id);
    removeConnection(api, c.id).then(
      async ({ revoked }) => {
        // Name only what there was (a keyless local server has no key, tester C1 #4).
        const parts = [hasModels ? i18n.t('options.providers.itsModels') : '', keyed ? i18n.t('options.providers.itsKey') : '', revoked ? i18n.t('options.providers.accessTo', [hostOf(c.baseUrl)]) : ''].filter(Boolean);
        if (!builtIn) return onNote(removedText(c.label, parts));
        // Say what the list will show: a built-in stays listed (keyless) only while a route uses it.
        const listed = visibleConnections(await load(api)).some((x) => x.id === c.id);
        const removed = revoked ? i18n.t('options.providers.removedKeyAccess', [c.label, hostOf(c.baseUrl)]) : i18n.t('options.providers.removedKey', [c.label]);
        onNote(`${removed} ${listed ? i18n.t('options.providers.builtInListed') : i18n.t('options.providers.builtInHidden')}`);
      },
      (err: unknown) => onNote(i18n.t('options.providers.removeFailed', [c.label, err instanceof Error ? err.message : String(err)]), true),
    );
  };
  return (
    <div class="prov__block" data-testid="connections">
      <div class="prov__head">
        <h3>{i18n.t('options.providers.connections')}</h3>
        <button type="button" onClick={onAdd} data-testid="add-connection">
          {i18n.t('options.providers.add')}
        </button>
      </div>
      {rows.length === 0 ? <p class="opt__hint">{i18n.t('options.providers.noConnections')}</p> : null}
      <ul class="prov__list">
        {rows.map((c) => {
          const status = statusOf(c, loaded);
          const implicit = isImplicit(loaded.settings, c.id);
          const where = isLocal(c) ? hostOf(c.baseUrl) : presetFor(c.presetId, c.protocol).custom ? hostOf(c.baseUrl) : presetFor(c.presetId, c.protocol).label;
          return (
            <li key={c.id} class="prov__row" data-testid="connection-row" data-id={c.id}>
              <span class={`prov__dot prov__dot--${status.tone}`} aria-hidden="true">
                ●
              </span>
              <span class="prov__name">{c.label}</span>
              <span class="prov__where">{where}</span>
              {isUnencryptedPrivate(c.baseUrl) ? (
                <span class="prov__status prov__status--warn" data-testid="connection-unencrypted">
                  {i18n.t('options.providers.unencrypted')}
                </span>
              ) : null}
              <span class={`prov__status prov__status--${status.tone}`} data-testid="connection-status">
                {status.text}
              </span>
              <span class="prov__actions">
                {c.lastErrorKind === 'cors-origin' && c.status === 'error' ? (
                  <button type="button" onClick={() => onEdit(c.id, true)} data-testid="fix-cors">
                    {i18n.t('options.providers.fix')}
                  </button>
                ) : null}
                <button type="button" onClick={() => onEdit(c.id)} aria-label={i18n.t('options.providers.editAria', [c.label])}>
                  {i18n.t('options.providers.edit')}
                </button>
                {implicit && !loaded.keyed.has(c.id) ? null : confirm === c.id ? (
                  <span class="prov__confirm" data-testid="confirm-remove">
                    {implicit || BUILTIN_IDS.has(c.id) ? i18n.t('options.providers.confirmBuiltIn') : i18n.t('options.providers.confirm', [c.label])}{' '}
                    <button type="button" onClick={() => remove(c)} data-testid="confirm-remove-yes">
                      {i18n.t('options.providers.remove')}
                    </button>{' '}
                    <button type="button" onClick={() => setConfirm(undefined)}>
                      {i18n.t('options.providers.cancel')}
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirm(c.id)} aria-label={i18n.t('options.providers.removeAria', [c.label])} data-testid="remove-connection">
                    {implicit ? i18n.t('options.providers.removeKey') : i18n.t('options.providers.remove')}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The message for a removed connection: its label, then what went with it (up to three things), as one sentence. */
const removedText = (label: string, parts: string[]): string =>
  parts.length === 0
    ? i18n.t('options.providers.removed0', [label])
    : parts.length === 1
      ? i18n.t('options.providers.removed1', [label, parts[0] as string])
      : parts.length === 2
        ? i18n.t('options.providers.removed2', [label, parts[0] as string, parts[1] as string])
        : i18n.t('options.providers.removed3', [label, parts[0] as string, parts[1] as string, parts[2] as string]);

const BUILTIN_IDS = new Set(BUILTIN_CONNECTIONS.map((c) => c.id));

// ---- Models -----------------------------------------------------------------------------------

function priceText(p: ModelProfile, c: ProviderConnection | undefined): string {
  // Ollama and LM Studio run here; a gateway that merely listens on localhost may still bill.
  if (c && presetFor(c.presetId, c.protocol).local !== undefined) return i18n.t('options.providers.freeLocal');
  const price = c ? pricingFor(p, c) : p.pricing;
  return price ? i18n.t('options.providers.pricePerM', [perM(price.inPerM), perM(price.outPerM)]) : i18n.t('options.providers.noPrice');
}

function Models({ api, loaded, onAdd, onNote }: { api: Browser; loaded: Loaded; onAdd: () => void; onNote: (text: string, warn?: boolean) => void }) {
  const { settings } = loaded;
  const rows = visibleProfiles(loaded);
  const remove = (p: ModelProfile) =>
    removeProfile(api, p.id).then(
      () => onNote(i18n.t('options.providers.removed0', [p.model])),
      (err: unknown) => onNote(err instanceof Error ? err.message : String(err), true),
    );
  const setProtocol = (p: ModelProfile, protocol: Protocol) =>
    saveProfileProtocol(api, p, protocol).then(
      () => onNote(i18n.t('options.providers.usesApi', [p.model, protocolLabel(protocol)])),
      (err: unknown) => onNote(String(err), true),
    );
  return (
    <div class="prov__block" data-testid="models">
      <div class="prov__head">
        <h3>{i18n.t('options.providers.models')}</h3>
        <button type="button" onClick={onAdd} data-testid="add-model">
          {i18n.t('options.providers.add')}
        </button>
      </div>
      <ul class="prov__list">
        {rows.map((p) => {
          const c = settings.connections.find((x) => x.id === p.connectionId);
          const roles = [settings.routing.translate === p.id ? i18n.t('options.providers.roleTranslate') : '', settings.routing.analyze === p.id ? i18n.t('options.providers.brief') : '', settings.routing.review === p.id ? i18n.t('options.providers.roleReview') : ''].filter(Boolean);
          const dual = (c?.detectedProtocols?.length ?? 0) > 1;
          const implicit = settings.implicit?.profiles.includes(p.id) === true;
          return (
            <li key={p.id} class="prov__row" data-testid="model-row">
              <span class="prov__name">{p.model}</span>
              <span class="prov__where">{c?.label}</span>
              <span class="prov__status">{priceText(p, c)}</span>
              {roles.length ? <span class="prov__tag">{roles.join(' · ')}</span> : null}
              {dual && c ? (
                <label class="prov__switch">
                  API{' '}
                  <select value={p.protocolOverride ?? c.detectedProtocols?.[0]} onChange={(e) => void setProtocol(p, (e.target as HTMLSelectElement).value as Protocol)} aria-label={i18n.t('options.providers.apiFormatFor', [p.model])}>
                    {(c.detectedProtocols ?? []).map((x) => (
                      <option key={x} value={x}>
                        {protocolLabel(x)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <span class="prov__actions">
                {implicit || settings.routing.translate === p.id ? null : (
                  <button type="button" onClick={() => void remove(p)} aria-label={i18n.t('options.providers.removeAria', [p.model])}>
                    {i18n.t('options.providers.remove')}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const saveProfileProtocol = (api: Browser, p: ModelProfile, protocol: Protocol) => saveProfile(api, { ...p, protocolOverride: protocol });

// ---- Routing ----------------------------------------------------------------------------------

function RoutingView({ api, loaded, onNote }: { api: Browser; loaded: Loaded; onNote: (text: string, warn?: boolean) => void }) {
  const { settings } = loaded;
  const profiles = visibleProfiles(loaded);
  /** The profiles to choose from; `exclude` leaves some out (never the selected one). */
  const options = (selected: string | undefined, exclude: readonly string[] = []) => (
    <>
      {selected !== undefined && !profiles.some((p) => p.id === selected) ? <option value={selected}>{i18n.t('options.providers.missingModel')}</option> : null}
      {profiles.filter((p) => p.id === selected || !exclude.includes(p.id)).map((p) => (
        <option key={p.id} value={p.id}>
          {profileName(p, settings.connections)}
        </option>
      ))}
    </>
  );
  const save = (patch: { translate?: string; analyze?: string | undefined; review?: string | undefined; fallback?: string[] }, said: string) => {
    const { analyze, review, fallback, ...rest } = { ...settings.routing, ...patch };
    const next: ProviderSettings['routing'] = { ...rest, ...(analyze === undefined ? {} : { analyze }), ...(review === undefined ? {} : { review }), ...(fallback?.length ? { fallback } : {}) };
    saveRouting(api, next).then(
      () => onNote(said),
      (err: unknown) => onNote(err instanceof Error ? err.message : String(err), true),
    );
  };
  const saveSites = (siteOverrides: SiteRule[], said: string) => {
    saveRouting(api, { ...settings.routing, siteOverrides }).then(
      () => onNote(said),
      (err: unknown) => onNote(err instanceof Error ? err.message : String(err), true),
    );
  };
  return (
    <div class="prov__block" data-testid="routing">
      <h3>{i18n.t('options.providers.routing')}</h3>
      <div class="opt__row">
        <label for="route-translate">{i18n.t('options.providers.translateWith')}</label>
        <select id="route-translate" value={settings.routing.translate} onChange={(e) => save({ translate: (e.target as HTMLSelectElement).value }, i18n.t('options.providers.translateSaved'))}>
          {options(settings.routing.translate)}
        </select>
      </div>
      <div class="opt__row">
        <label for="route-analyze">{i18n.t('options.providers.brief')}</label>
        <select
          id="route-analyze"
          value={settings.routing.analyze ?? ''}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            save({ analyze: v === '' ? undefined : v }, i18n.t('options.providers.briefSaved'));
          }}
        >
          <option value="">{i18n.t('options.providers.sameAsTranslate')}</option>
          {options(settings.routing.analyze)}
        </select>
      </div>
      <p class="opt__hint">{i18n.t('options.providers.briefHint')}</p>
      <div class="opt__row">
        <label for="route-review">{i18n.t('options.providers.reviewWith')}</label>
        <select
          id="route-review"
          value={settings.routing.review ?? ''}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            save({ review: v === '' ? undefined : v }, i18n.t('options.providers.reviewSaved'));
          }}
        >
          <option value="">{i18n.t('options.providers.sameAsTranslate')}</option>
          {options(settings.routing.review)}
        </select>
      </div>
      <p class="opt__hint">{i18n.t('options.providers.reviewHint')}</p>
      <FallbackChain settings={settings} profiles={profiles} options={options} onSave={(fallback, said) => save({ fallback }, said)} />
      <SiteModelRules settings={settings} profiles={profiles} options={options} onSave={(siteOverrides, said) => saveSites(siteOverrides, said)} />
    </div>
  );
}

/**
 * Site rules for the model (DESIGN §4.3.1 siteOverrides, §4.3.5, plan M5-E6): a site that always
 * uses one model, and "local only" for a site whose text must not leave the machine (no cloud
 * fallback, §4.3.3 privacy rule). The first matching rule wins, in list order.
 */
function SiteModelRules({ settings, profiles, options, onSave }: { settings: ProviderSettings; profiles: readonly ModelProfile[]; options: (selected: string | undefined) => ComponentChildren; onSave: (rules: SiteRule[], said: string) => void }) {
  const rules = settings.routing.siteOverrides ?? [];
  const [site, setSite] = useState('');
  const [model, setModel] = useState('');
  const [localOnly, setLocalOnly] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const chosen = model || settings.routing.translate;
  const connectionOf = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    return p && settings.connections.find((x) => x.id === p.connectionId);
  };
  const cloud = (id: string) => {
    const c = connectionOf(id);
    return c ? !isLocalConnection(c) : false;
  };
  // A local-only rule runs only on a model on this device (review R2): routing refuses the other
  // combination (nothing is sent), so it is never saved. Ticking Local only picks the first local model.
  const firstLocal = profiles.find((p) => { const c = connectionOf(p.id); return c !== undefined && isLocalConnection(c); })?.id;
  const NEEDS_LOCAL = i18n.t('options.providers.needsLocal');
  const tidy = ({ localOnly: lo, ...r }: SiteRule): SiteRule => (lo ? { ...r, localOnly: true } : r);
  const edit = (pattern: string, patch: Partial<SiteRule>, said: string) => {
    const rule = rules.find((r) => r.pattern === pattern);
    if (!rule) return;
    const next = tidy({ ...rule, ...patch });
    if (next.localOnly && cloud(next.translate)) {
      // Ticked on a cloud model: move to a local one. A cloud model picked for a local-only rule: refused.
      if (patch.localOnly && firstLocal) next.translate = firstLocal;
      else return setProblem(patch.localOnly ? NEEDS_LOCAL : i18n.t('options.providers.localOnlyPick', [pattern]));
    }
    setProblem(undefined);
    onSave(rules.map((r) => (r.pattern === pattern ? next : r)), said);
  };
  const tickLocal = (on: boolean) => {
    setLocalOnly(on);
    if (on && cloud(chosen) && firstLocal) setModel(firstLocal);
  };
  const add = (e: Event) => {
    e.preventDefault();
    const pattern = sitePattern(site);
    if (!pattern) return setProblem(i18n.t('options.sites.enterAllow'));
    if (rules.some((r) => r.pattern === pattern)) return setProblem(i18n.t('options.providers.hasRule', [pattern]));
    if (localOnly && cloud(chosen)) return setProblem(firstLocal ? i18n.t('options.providers.pickLocal') : NEEDS_LOCAL);
    setProblem(undefined);
    onSave([...rules, { pattern, translate: chosen, ...(localOnly ? { localOnly: true } : {}) }], i18n.t('options.providers.siteRuleSaved', [pattern]));
    setSite('');
    setLocalOnly(false);
  };
  return (
    <div class="prov__sites" data-testid="site-rules">
      <h4>{i18n.t('options.providers.perSite')}</h4>
      {settings.siteRulesLocal ? (
        <p class="opt__status opt__status--warn" role="status" data-testid="site-rules-overflow">
          {overflowNotice()}
        </p>
      ) : null}
      {rules.length ? (
        <ul class="prov__list">
          {rules.map((r) => (
            <li key={r.pattern} class="prov__row" data-testid="site-rule">
              <span class="prov__name">{r.pattern}</span>
              <select value={r.translate} aria-label={i18n.t('options.providers.modelFor', [r.pattern])} onChange={(e) => edit(r.pattern, { translate: (e.target as HTMLSelectElement).value }, i18n.t('options.providers.siteRuleSaved', [r.pattern]))}>
                {options(r.translate)}
              </select>
              <label class="opt__check">
                <input type="checkbox" checked={r.localOnly === true} aria-label={i18n.t('options.providers.localOnlyFor', [r.pattern])} onChange={(e) => edit(r.pattern, { localOnly: (e.target as HTMLInputElement).checked }, i18n.t('options.providers.siteRuleSaved', [r.pattern]))} /> {i18n.t('options.providers.localOnly')}
              </label>
              <span class="prov__actions">
                <button type="button" aria-label={i18n.t('options.providers.removeRuleAria', [r.pattern])} onClick={() => onSave(rules.filter((x) => x.pattern !== r.pattern), i18n.t('options.providers.siteRuleRemoved', [r.pattern]))}>
                  {i18n.t('options.providers.remove')}
                </button>
              </span>
              {r.localOnly && cloud(r.translate) ? (
                <p class="opt__status opt__status--warn" data-testid="site-rule-cloud">
                  {i18n.t('options.providers.ruleCloud', [r.pattern])}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <form class="opt__row" onSubmit={add} data-testid="site-rule-form">
        <input aria-label={i18n.t('options.providers.site')} placeholder={i18n.t('options.sites.allowPlaceholder')} value={site} onInput={(e) => setSite((e.target as HTMLInputElement).value)} />
        <select aria-label={i18n.t('options.providers.modelForSite')} value={chosen} onChange={(e) => setModel((e.target as HTMLSelectElement).value)}>
          {options(chosen)}
        </select>
        <label class="opt__check">
          <input type="checkbox" checked={localOnly} aria-label={i18n.t('options.providers.localOnlyForSite')} onChange={(e) => tickLocal((e.target as HTMLInputElement).checked)} /> {i18n.t('options.providers.localOnly')}
        </label>
        <button type="submit" disabled={site.trim() === ''}>
          {i18n.t('options.providers.addRule')}
        </button>
      </form>
      {problem ? (
        <p class="opt__status opt__status--warn" role="status" data-testid="site-rule-problem">
          {problem}
        </p>
      ) : null}
      <p class="opt__hint">{i18n.t('options.providers.rulesHint')}</p>
    </div>
  );
}

/**
 * "If it fails" (DESIGN §4.3.3 A, plan M4-E9): the fallback chain, tried in order when the model
 * routed for a page is rate-limited, overloaded or unreachable. Entries that are not profiles
 * are kept as they are and can only be removed. The `basic` entry (M5-E7, Chrome's Translator)
 * is terminal: it is always last, models are added before it, and it can be added back.
 */
function FallbackChain({ settings, profiles, options, onSave }: { settings: ProviderSettings; profiles: readonly ModelProfile[]; options: (selected: string | undefined, exclude?: readonly string[]) => ComponentChildren; onSave: (fallback: string[], said: string) => void }) {
  const chain = settings.routing.fallback ?? [];
  const unused = profiles.filter((p) => p.id !== settings.routing.translate && !chain.includes(p.id));
  const named = (id: string) => (id === BASIC_FALLBACK ? i18n.t('options.providers.basic') : (profiles.find((p) => p.id === id)?.model ?? i18n.t('options.providers.missingModel')));
  const hasBasic = chain.includes(BASIC_FALLBACK);
  /** `id` added to the chain, before the terminal `basic` entry. */
  const withAdded = (id: string) => (hasBasic ? [...chain.filter((x) => x !== BASIC_FALLBACK), id, BASIC_FALLBACK] : [...chain, id]);
  return (
    <div class="opt__row prov__fallback" data-testid="route-fallback">
      <span class="prov__label" id="route-fallback-label">
        {i18n.t('options.providers.ifFails')}
      </span>
      <ol class="prov__chain" aria-labelledby="route-fallback-label">
        {chain.map((id, i) => (
          <li key={`${i}:${id}`}>
            {i > 0 ? <span aria-hidden="true">→ </span> : null}
            {profiles.some((p) => p.id === id) ? (
              <select
                aria-label={i18n.t('options.providers.fallbackN', [String(i + 1)])}
                value={id}
                onChange={(e) => {
                  const next = [...chain];
                  next[i] = (e.target as HTMLSelectElement).value;
                  onSave(next.filter((x, j) => next.indexOf(x) === j), i18n.t('options.providers.fallbackSaved'));
                }}
              >
                {/* Not the translate model itself, nor a model already in the chain (M4-D tester). */}
                {options(id, [settings.routing.translate, ...chain])}
              </select>
            ) : (
              <span>{named(id)}</span>
            )}{' '}
            <button type="button" class="prov__small" aria-label={i18n.t('options.providers.removeFallbackAria', [String(i + 1), named(id)])} onClick={() => onSave(chain.filter((_, j) => j !== i), i18n.t('options.providers.fallbackRemoved'))}>
              ×
            </button>
          </li>
        ))}
        {unused.length ? (
          <li>
            <button type="button" class="prov__small" data-testid="fallback-add" onClick={() => onSave(withAdded((unused[0] as ModelProfile).id), i18n.t('options.providers.fallbackAdded'))}>
              {chain.some((id) => id !== BASIC_FALLBACK) ? '+' : i18n.t('options.providers.addFallback')}
            </button>
          </li>
        ) : chain.length === 0 ? (
          <li class="opt__hint">{i18n.t('options.providers.needSecond')}</li>
        ) : null}
        {hasBasic ? null : (
          <li>
            <button type="button" class="prov__small" data-testid="fallback-add-basic" title={i18n.t('options.providers.basicTitle')} onClick={() => onSave([...chain, BASIC_FALLBACK], i18n.t('options.providers.basicAdded'))}>
              {i18n.t('options.providers.addBasic')}
            </button>
          </li>
        )}
      </ol>
      <p class="opt__hint">
        {i18n.t('options.providers.fallbackHint')}
      </p>
    </div>
  );
}

// ---- Add a model to an existing connection ----------------------------------------------------

function ModelForm({ api, adapterFor, loaded, onDone }: { api: Browser; adapterFor: AdapterFor; loaded: Loaded; onDone: (text?: string) => void }) {
  const usable = visibleConnections(loaded).filter((c) => c.auth.style === 'none' || loaded.keyed.has(c.id));
  const [connId, setConnId] = useState(usable[0]?.id ?? '');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [error, setError] = useState<string | undefined>();
  /** The listing failed for want of the host permission: offer Grant access (review C1 #7). */
  const [needsAccess, setNeedsAccess] = useState(false);
  const connection = usable.find((c) => c.id === connId);
  const discover = () => {
    if (!connection) return;
    setError(undefined);
    setNeedsAccess(false);
    void (async () => {
      const conn = await resolveConnection(api, connection);
      if (!conn) return setError(i18n.t('options.providers.noKeyError'));
      const result = await adapterFor(conn.protocol).probe(conn);
      if (result.ok) return setModels(displayModels(conn.quirks, result.models ?? []));
      const message = connectMessage(result.error, { preset: presetFor(connection.presetId, connection.protocol), baseUrl: connection.baseUrl, model });
      setError(message.text);
      setNeedsAccess(message.action === 'grant');
    })().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  useEffect(discover, [connId]);
  const grant = () => {
    const origin = connection && safeOrigin(connection.baseUrl);
    if (!origin) return;
    // First in the click: the request needs the gesture (§8), for this connection's origin only.
    void api.permissions
      .request({ origins: [origin] })
      .catch(() => false)
      .then((granted) => {
        if (granted) discover();
      });
  };
  const save = (e: Event) => {
    e.preventDefault();
    if (!connection || model.trim() === '') return;
    const dual = (connection.detectedProtocols?.length ?? 0) > 1;
    const profile = toProfile(connection, model.trim(), newId(), loaded.settings.profiles, models, dual ? preferredProtocol(model) : undefined);
    void saveSetup(api, { connection, profile }).then(
      ({ routed }) => onDone(routed ? i18n.t('options.providers.addedRouted', [profile.model]) : i18n.t('options.providers.added', [profile.model])),
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );
  };
  if (usable.length === 0) {
    return (
      <div class="prov__block">
        <p class="opt__hint">{i18n.t('options.providers.needConnection')}</p>
        <button type="button" onClick={() => onDone()}>
          {i18n.t('options.providers.back')}
        </button>
      </div>
    );
  }
  return (
    <form class="prov__block" onSubmit={save} data-testid="model-form">
      <h3>{i18n.t('options.providers.addModel')}</h3>
      <div class="opt__row">
        <label for="m-conn">{i18n.t('options.providers.connection')}</label>
        <select id="m-conn" value={connId} onChange={(e) => setConnId((e.target as HTMLSelectElement).value)}>
          {usable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <ModelPicker id="m-model" model={model} models={models} onModel={setModel} />
      {error ? (
        <p class="opt__status opt__status--warn" data-testid="model-form-error">
          {error}{' '}
          {needsAccess ? (
            <button type="button" onClick={grant} data-testid="model-form-grant">
              {i18n.t('options.providers.grant')}
            </button>
          ) : null}
        </p>
      ) : null}
      <div class="opt__row">
        <button type="submit" disabled={model.trim() === ''}>
          {i18n.t('options.providers.save')}
        </button>
        <button type="button" onClick={() => onDone()}>
          {i18n.t('options.providers.cancel')}
        </button>
      </div>
    </form>
  );
}

/** §4.3.3 step 4: a searchable list of discovered models; any id can still be typed. */
function ModelPicker({ id, model, models, onModel }: { id: string; model: string; models: readonly ModelInfo[]; onModel: (m: string) => void }) {
  const info = models.find((m) => m.id === model);
  return (
    <>
      <div class="opt__row">
        <label for={id}>{i18n.t('options.providers.model')}</label>
        <input id={id} list={`${id}-list`} value={model} placeholder={models.length ? i18n.t('options.providers.search', models.length) : i18n.t('options.providers.typeId')} onInput={(e) => onModel((e.target as HTMLInputElement).value)} autocomplete="off" spellcheck={false} />
        <datalist id={`${id}-list`} data-testid="model-list">
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {[m.displayName, m.contextWindow ? i18n.t('options.providers.contextK', [String(Math.round(m.contextWindow / 1000))]) : ''].filter(Boolean).join(' · ')}
            </option>
          ))}
        </datalist>
      </div>
      {info?.contextWindow ? (
        <p class="opt__hint" data-testid="model-context">
          {i18n.t('options.providers.contextTokens', [info.displayName ?? info.id, info.contextWindow.toLocaleString('en-US')])}
        </p>
      ) : null}
    </>
  );
}

// ---- Add / edit connection --------------------------------------------------------------------

type TestState = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; result: TestResult; message?: ConnectMessage | undefined };

/**
 * The add / edit connection form. `initialPreset` starts the form on that preset (no picker): the
 * onboarding's step 3 uses this same form and Test connection (plan M4-E13).
 */
export function ConnectionForm({
  api,
  adapterFor,
  loaded,
  editing,
  openGuide,
  retestMs,
  initialPreset,
  hideCancel = false,
  onDone,
}: {
  api: Browser;
  adapterFor: AdapterFor;
  loaded: Loaded;
  editing: ProviderConnection | undefined;
  openGuide: boolean;
  retestMs: number;
  initialPreset?: PresetId | undefined;
  /** Onboarding has its own Back: the form's Cancel would do the same. */
  hideCancel?: boolean;
  onDone: (text?: string) => void;
}) {
  const routedModel = editing ? loaded.settings.profiles.find((p) => p.connectionId === editing.id && p.id === loaded.settings.routing.translate)?.model : undefined;
  const firstModel = editing ? loaded.settings.profiles.find((p) => p.connectionId === editing.id)?.model : undefined;
  const [draft, setDraft] = useState<ConnectionDraft | undefined>(editing ? draftFromConnection(editing, routedModel ?? firstModel ?? '') : initialPreset ? draftFromPreset(initialPreset) : undefined);
  const [storedKey, setStoredKey] = useState<string | undefined>();
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [guide, setGuide] = useState(openGuide);
  const [protocolChoice, setProtocolChoice] = useState<Protocol | undefined>();
  const [error, setError] = useState<string | undefined>();
  const keyInput = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  /** Base URLs whose origin this form's Test was granted (not held before): given back unless saved (§8, review C1 #3). */
  const grantedHere = useRef(new Set<string>());
  useEffect(() => {
    if (editing) void readApiKey(api, editing.id).then(setStoredKey);
  }, [editing?.id]);

  const preset = draft ? presetFor(draft.presetId) : undefined;
  const set = (patch: Partial<ConnectionDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    if ('baseUrl' in patch || 'protocol' in patch || 'authStyle' in patch) setTest({ kind: 'idle' });
  };

  /** Runs the test (no permission prompt: the caller asked already). */
  const runTest = async (d: ConnectionDraft): Promise<TestResult> => {
    running.current = true;
    setTest({ kind: 'running' });
    setError(undefined);
    const p = presetFor(d.presetId);
    // §4.3.4: the stored key only while the origin is unchanged (review C1 #1).
    const input = testInputOf(d, usableStoredKey(d, editing, storedKey), editing?.quirks ?? p.quirks);
    const fixed = fixBaseUrl(d.baseUrl).url;
    try {
      const result = await testConnection(input, { adapter: adapterFor, hasHostPermission: () => hasHostPermission(api, fixed).catch(() => false) });
      // A preset whose base URL was edited: its own is the likely fix for a wrong one.
      const suggestion = !p.custom && p.baseUrl !== '' && fixed !== p.baseUrl ? p.baseUrl : undefined;
      const message = result.ok
        ? undefined
        : connectMessage(result.error, { preset: p, baseUrl: result.baseUrl, model: input.model ?? result.checks.find((c) => c.chatModel)?.chatModel, suggestion, noKey: input.apiKey === undefined && d.authStyle !== 'none' });
      setTest({ kind: 'done', result, message });
      if (result.ok) {
        setGuide(false);
        setDraft((cur) => (cur ? { ...cur, baseUrl: result.baseUrl, model: cur.model || (p.defaultModel && result.models.some((m) => m.id === p.defaultModel) ? p.defaultModel : '') } : cur));
      } else if (message?.action === 'cors-guide') setGuide(true);
      // An existing connection remembers the outcome, so the list shows it (and its Fix… button):
      // read fresh, written only when it changed (review C1 #5). Not while it is being moved.
      if (editing && !originMoved(d, editing)) await saveConnectionStatus(api, editing.id, statusFrom(result, message)).catch(() => false);
      return result;
    } finally {
      running.current = false;
    }
  };

  // The latest draft and test function, for the re-test timer: a model typed after the guide
  // opened is tested too (review C1 #5).
  const latest = useRef({ draft, runTest });
  latest.current = { draft, runTest };

  // §4.3.6: while a CORS guide is open, the test runs again by itself until it passes.
  useEffect(() => {
    if (!guide) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const { draft: d, runTest: run } = latest.current;
      if (!d || running.current || Date.now() - started > RETEST_FOR_MS) return;
      void run(d);
    }, retestMs);
    return () => clearInterval(timer);
  }, [guide]);

  /** Gives back what this form's tests were granted, except `keep`'s origin (the one saved). */
  const giveBack = async (keep?: string) => {
    const keepOrigin = keep === undefined ? undefined : safeOrigin(keep);
    for (const url of grantedHere.current) if (safeOrigin(url) !== keepOrigin) await revokeUnusedOrigin(api, url, '').catch(() => false);
    grantedHere.current.clear();
  };
  const cancel = () => void giveBack().finally(() => onDone());

  if (!draft || !preset) return <PresetPicker onPick={(id) => setDraft(draftFromPreset(id))} onCancel={() => onDone()} />;
  const moved = originMoved(draft, editing);
  const keyMissing = moved && draft.authStyle !== 'none' && draft.apiKey.trim() === '' && storedKey !== undefined;
  const fields = fieldsFor(preset, draft.authStyle);

  const onTest = () => {
    // The permission request goes out in the click, before any await (a user gesture, §4.3.3
    // step 3, §8): for this connection's origin only. `contains`, sent just before it, tells
    // whether the grant is new (given back on Cancel).
    const fixed = fixBaseUrl(draft.baseUrl).url;
    // Plain HTTP to the internet is refused with its message and no permission prompt (Test says why).
    if (isPlainHttpRefused(fixed)) {
      void runTest(draft);
      return;
    }
    const origin = safeOrigin(fixed);
    const held = origin ? api.permissions.contains({ origins: [origin] }).catch(() => true) : Promise.resolve(true);
    const asked = origin ? api.permissions.request({ origins: [origin] }).catch(() => false) : Promise.resolve(false);
    void Promise.all([held, asked]).then(([had, granted]) => {
      if (granted && !had) grantedHere.current.add(fixed);
      return runTest(draft);
    });
  };

  const result = test.kind === 'done' ? test.result : undefined;
  const passed = result?.ok ? result : undefined;
  const models = result?.models ?? [];
  const dual = (passed?.detected.length ?? 0) > 1;
  const protocol = protocolChoice ?? preferredProtocol(draft.model);

  const onSave = (e: Event) => {
    e.preventDefault();
    if (keyMissing) {
      setError(i18n.t('options.providers.keyAgain'));
      keyInput.current?.focus();
      return;
    }
    if (isPlainHttpRefused(fixBaseUrl(draft.baseUrl).url)) {
      setError(i18n.t('options.connect.httpsOnly'));
      return;
    }
    const id = editing?.id ?? newId();
    const status = result ? statusFrom(result, test.kind === 'done' ? test.message : undefined) : editing ? { status: editing.status, ...(editing.lastError ? { lastError: editing.lastError } : {}), ...(editing.lastErrorKind ? { lastErrorKind: editing.lastErrorKind } : {}) } : { status: 'unverified' as const };
    const connection = toConnection(draft, id, editing, result, status);
    const model = draft.model.trim();
    const profile = model ? toProfile(connection, model, newId(), loaded.settings.profiles, models, dual ? protocol : undefined) : undefined;
    const movedFrom = editing && editing.baseUrl !== connection.baseUrl ? editing.baseUrl : undefined;
    void (async () => {
      const { routed } = await saveSetup(api, { connection, apiKey: draft.authStyle === 'none' ? undefined : draft.apiKey, profile });
      // A connection moved to another origin gives back the old one's permission (§4.3.4), and
      // what a test of another URL was granted.
      if (movedFrom && safeOrigin(movedFrom) !== safeOrigin(connection.baseUrl)) await revokeUnusedOrigin(api, movedFrom, id);
      await giveBack(connection.baseUrl);
      const saved = profile ? i18n.t('options.providers.savedWith', [connection.label, profile.model]) : i18n.t('options.providers.saved', [connection.label]);
      onDone(routed && profile ? `${saved} ${i18n.t('options.providers.routedNow', [profile.model])}` : saved);
    })().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <form class="prov__block" onSubmit={onSave} data-testid="connection-form">
      <h3>{editing ? i18n.t('options.providers.editTitle', [editing.label]) : i18n.t('options.providers.addTitle', [presetTitle(preset)])}</h3>
      {presetNote(preset) ? <p class="opt__hint">{presetNote(preset)}</p> : null}
      <div class="opt__row">
        <label for="c-label">{i18n.t('options.providers.name')}</label>
        <input id="c-label" value={draft.label} placeholder={preset.custom ? i18n.t('options.providers.namePlaceholder') : preset.label} onInput={(e) => set({ label: (e.target as HTMLInputElement).value })} />
      </div>
      {fields.baseUrl ? <BaseUrlField draft={draft} set={set} /> : null}
      {fields.apiFormat ? (
        <div class="opt__row">
          <label for="c-format">{i18n.t('options.providers.apiFormat')}</label>
          <select id="c-format" value={draft.protocol} onChange={(e) => set({ protocol: (e.target as HTMLSelectElement).value as Protocol | 'auto' })}>
            {(['openai-chat', 'anthropic-messages', 'auto'] as const).map((p) => (
              <option key={p} value={p}>
                {protocolLabel(p)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {fields.auth ? (
        <div class="opt__row">
          <label for="c-auth">{i18n.t('options.providers.auth')}</label>
          <select id="c-auth" value={draft.authStyle} onChange={(e) => set({ authStyle: (e.target as HTMLSelectElement).value as ConnectionDraft['authStyle'] })}>
            {(preset.authChoices ?? [preset.auth]).map((a) => (
              <option key={a} value={a}>
                {authLabel(a)}
              </option>
            ))}
          </select>
          {draft.authStyle === 'custom-header' ? <input aria-label={i18n.t('options.providers.headerName')} placeholder={i18n.t('options.providers.headerNamePlaceholder')} value={draft.headerName} onInput={(e) => set({ headerName: (e.target as HTMLInputElement).value })} /> : null}
        </div>
      ) : null}
      {fields.key ? (
        <div class="opt__row">
          <label for="c-key">{i18n.t('options.providers.apiKey')}</label>
          <input
            id="c-key"
            ref={keyInput}
            type="password"
            autocomplete="off"
            spellcheck={false}
            value={draft.apiKey}
            placeholder={
              storedKey && moved
                ? i18n.t('options.providers.keyNewServer')
                : storedKey
                  ? i18n.t('options.providers.keySaved', [maskKey(storedKey)])
                  : preset.custom
                    ? i18n.t('options.providers.pasteKey')
                    : i18n.t('options.providers.pastePresetKey', [preset.label])
            }
            onInput={(e) => set({ apiKey: (e.target as HTMLInputElement).value })}
          />
          {preset.keyUrl ? (
            <a href={preset.keyUrl} target="_blank" rel="noreferrer">
              {i18n.t('options.providers.getKey')}
            </a>
          ) : null}
        </div>
      ) : null}
      <details class="prov__advanced" data-testid="advanced">
        <summary>{i18n.t('options.providers.advanced')}</summary>
        <p class="opt__hint" data-testid="advanced-sync-note">
          {i18n.t('options.providers.advancedSync')}
        </p>
        {fields.baseUrl ? null : <BaseUrlField draft={draft} set={set} />}
        <div class="opt__row">
          <label for="c-headers">{i18n.t('options.providers.extraHeaders')}</label>
          <textarea id="c-headers" rows={2} placeholder={i18n.t('options.providers.headersPlaceholder')} value={draft.extraHeaders} onInput={(e) => set({ extraHeaders: (e.target as HTMLTextAreaElement).value })} />
        </div>
        <div class="opt__row">
          <label for="c-query">{i18n.t('options.providers.queryParams')}</label>
          <textarea id="c-query" rows={1} placeholder={i18n.t('options.providers.queryPlaceholder')} value={draft.queryParams} onInput={(e) => set({ queryParams: (e.target as HTMLTextAreaElement).value })} />
        </div>
        <div class="opt__row">
          {(
            [
              ['maxCompletionTokens', i18n.t('options.providers.toggleMaxTokens')],
              ['noTemperature', i18n.t('options.providers.toggleNoTemperature')],
              ['noSystemRole', i18n.t('options.providers.toggleNoSystem')],
            ] as const
          ).map(([k, text]) => (
            <label key={k} class="opt__check">
              <input type="checkbox" checked={draft.toggles[k]} onChange={(e) => set({ toggles: { ...draft.toggles, [k]: (e.target as HTMLInputElement).checked } })} /> {text}
            </label>
          ))}
        </div>
      </details>
      <div class="opt__row">
        <button type="button" onClick={onTest} disabled={test.kind === 'running'} data-testid="test-connection">
          {test.kind === 'running' ? i18n.t('options.providers.testing') : i18n.t('options.providers.test')}
        </button>
        <span class="opt__hint" data-testid="access-hint">{accessHint(fixBaseUrl(draft.baseUrl).url)}</span>
      </div>
      {isUnencryptedPrivate(fixBaseUrl(draft.baseUrl).url) ? (
        <p class="opt__hint" data-testid="unencrypted-note">{i18n.t('options.providers.unencrypted')}</p>
      ) : null}
      {test.kind === 'done' ? <TestOutcome draft={draft} protocol={protocol} test={test} onFixKey={() => keyInput.current?.focus()} onRetry={onTest} onUseUrl={(url) => set({ baseUrl: url })} onGuide={() => setGuide(true)} /> : null}
      {guide ? <CorsGuide local={preset.local ?? 'generic'} onClose={() => setGuide(false)} /> : null}
      <ModelPicker id="c-model" model={draft.model} models={models} onModel={(m) => set({ model: m })} />
      {dual ? (
        <fieldset class="prov__protocol" data-testid="protocol-switch">
          <legend>{i18n.t('options.providers.apiForModel')}</legend>
          <div class="prov__radios">
            {(['anthropic-messages', 'openai-chat'] as const).map((p) => (
              <label key={p}>
                <input type="radio" name="c-protocol" checked={protocol === p} onChange={() => setProtocolChoice(p)} /> {protocolLabel(p)}
              </label>
            ))}
          </div>
          <p class="opt__hint">
            {i18n.t('options.providers.bothWork')}
            {isClaudeModel(draft.model) && /haiku/i.test(draft.model) ? ` ${i18n.t('options.providers.haiku')}` : ''}
          </p>
        </fieldset>
      ) : null}
      {error ? <p class="opt__status opt__status--warn">{error}</p> : null}
      <div class="opt__row">
        <button type="submit" data-testid="save-connection">
          {i18n.t('options.providers.save')}
        </button>
        {hideCancel ? null : (
          <button type="button" onClick={cancel} data-testid="cancel-connection">
            {i18n.t('options.providers.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}

function statusFrom(result: TestResult, message: ConnectMessage | undefined): TestStatus {
  if (result.ok) return { status: 'ok' };
  const kind = result.error.kind === 'cors' && result.error.cause === 'origin' ? 'cors-origin' : result.error.kind;
  return { status: 'error', lastError: message?.status ?? result.error.message, lastErrorKind: kind };
}

function BaseUrlField({ draft, set }: { draft: ConnectionDraft; set: (patch: Partial<ConnectionDraft>) => void }) {
  return (
    <div class="opt__row">
      <label for="c-base">{i18n.t('options.providers.baseUrl')}</label>
      <input id="c-base" type="url" spellcheck={false} value={draft.baseUrl} placeholder="https://llm.example.com/v1" onInput={(e) => set({ baseUrl: (e.target as HTMLInputElement).value })} />
    </div>
  );
}

function PresetPicker({ onPick, onCancel }: { onPick: (id: PresetId) => void; onCancel: () => void }) {
  return (
    <div class="prov__block" data-testid="preset-picker">
      <h3>{i18n.t('options.providers.addConnection')}</h3>
      {pickerGroups().map((g) => (
        <div key={g.title}>
          <p class="opt__hint">{g.title}</p>
          <ul class="prov__presets">
            {g.presets.map((p) => (
              <li key={p.id}>
                <button type="button" class="prov__preset" onClick={() => onPick(p.id)} data-preset={p.id}>
                  <strong>{presetTitle(p)}</strong>
                  <span class="opt__hint">{presetBlurb(p)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <button type="button" onClick={onCancel}>
        {i18n.t('options.providers.cancel')}
      </button>
    </div>
  );
}

function TestOutcome({ draft, protocol, test, onFixKey, onRetry, onUseUrl, onGuide }: { draft: ConnectionDraft; protocol: Protocol; test: Extract<TestState, { kind: 'done' }>; onFixKey: () => void; onRetry: () => void; onUseUrl: (url: string) => void; onGuide: () => void }) {
  const { result, message } = test;
  const fixes = result.fixes.length ? (
    <ul class="prov__fixes" data-testid="url-fixes">
      {result.fixes.map((f) => (
        <li key={f.reason}>
          {slots(i18n.t('options.providers.urlFixed', { to: '{to}', reason: urlFixText(f.reason) }), { to: <code>{f.to}</code> })}
        </li>
      ))}
    </ul>
  ) : null;
  const detectedNames = result.ok ? result.detected.map((p) => protocolLabel(p)).join(i18n.t('options.providers.and')) : '';
  if (result.ok) {
    return (
      <div class="prov__outcome prov__outcome--ok" role="status" data-testid="test-result">
        <p>
          <strong>✓ {i18n.t('options.providers.connected')}</strong> · {result.models.length ? i18n.t('options.providers.modelCount', result.models.length) : i18n.t('options.providers.noList')} ·{' '}
          {/* The API named is the switch's below, so the two agree (tester C1 #2). */}
          {draft.protocol === 'auto'
            ? result.detected.length > 1 && draft.model.trim()
              ? i18n.t('options.providers.detectedUses', [detectedNames, draft.model.trim(), protocolLabel(protocol)])
              : i18n.t('options.providers.detected', [detectedNames])
            : detectedNames}
        </p>
        {result.modelUnchecked ? (
          <p class="opt__hint" data-testid="pick-model">
            {result.keyUnchecked ? i18n.t('options.providers.pickModelKey') : i18n.t('options.providers.pickModel')}
          </p>
        ) : null}
        {fixes}
      </div>
    );
  }
  const m = message as ConnectMessage;
  return (
    <div class="prov__outcome prov__outcome--error" role="alert" data-testid="test-result">
      <p>
        <strong data-testid="test-status">{m.status}</strong> · {m.text}
      </p>
      {m.command ? <Command text={m.command} /> : null}
      {m.action === 'fix-key' ? (
        <button type="button" onClick={onFixKey} data-testid="fix-key">
          {i18n.t('options.providers.fixKey')}
        </button>
      ) : m.action === 'grant' ? (
        <button type="button" onClick={onRetry}>
          {i18n.t('options.providers.grant')}
        </button>
      ) : m.action === 'cors-guide' ? (
        <button type="button" onClick={onGuide} data-testid="open-guide">
          {i18n.t('options.providers.fix')}
        </button>
      ) : m.action === 'use-url' && m.suggestion ? (
        <button type="button" onClick={() => onUseUrl(m.suggestion as string)}>
          {i18n.t('options.providers.useUrl', [m.suggestion])}
        </button>
      ) : null}
      {fixes}
    </div>
  );
}

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div class="prov__command">
      <code data-testid="command">{text}</code>
      <button
        type="button"
        onClick={() =>
          void navigator.clipboard?.writeText(text).then(
            () => setCopied(true),
            () => {},
          )
        }
      >
        {copied ? i18n.t('options.providers.copied') : i18n.t('options.providers.copy')}
      </button>
    </div>
  );
}

const guessOs = (): GuideStep['os'] => {
  const p = (globalThis.navigator?.platform ?? '').toLowerCase();
  return p.startsWith('win') ? 'Windows' : p.startsWith('mac') ? 'macOS' : 'Linux';
};

/** §4.3.6 [Fix…]: the exact command for each OS; the form re-tests while it is open. */
export function CorsGuide({ local, onClose }: { local: GuideKind; onClose: () => void }) {
  const guide = corsGuide(local);
  const tabs = guide.steps.map((s) => s.os);
  const [os, setOs] = useState<GuideStep['os']>(tabs.includes(guessOs()) ? guessOs() : (tabs[0] as GuideStep['os']));
  const step = guide.steps.find((s) => s.os === os) ?? guide.steps[0];
  return (
    <div class="prov__guide" role="region" aria-label={guide.title} data-testid="cors-guide">
      <h4>{guide.title}</h4>
      {tabs.length > 1 ? (
        <div role="tablist" class="prov__tabs">
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={t === os} onClick={() => setOs(t)}>
              {t}
            </button>
          ))}
        </div>
      ) : null}
      {step ? (
        <>
          <p>{step.text}</p>
          {step.command ? <Command text={step.command} /> : null}
          {step.after ? <p class="opt__hint">{step.after}</p> : null}
        </>
      ) : null}
      <p class="opt__hint" data-testid="retest-note">
        {i18n.t('options.providers.retest')}
      </p>
      <button type="button" onClick={onClose}>
        {i18n.t('options.providers.close')}
      </button>
    </div>
  );
}
