// Settings ▸ Providers (DESIGN.md §4.3.3 A, plan M4 sub-goal C): connections, models and routing,
// and the add / edit connection flow: pick a preset → key → Test connection (asks for that origin
// only, §8) → pick a discovered model → save. Failures say what to do (src/shared/connect.ts); a
// local server's CORS refusal opens its guide and the test runs again by itself (§4.3.6).
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { browser } from 'wxt/browser';
import { createAdapter } from '@/llm/client';
import type { ModelInfo, Protocol, ProtocolAdapter } from '@/llm/types';
import { connectMessage, corsGuide, displayModels, fixBaseUrl, isClaudeModel, preferredProtocol, testConnection, URL_FIX_TEXT, type ConnectMessage, type GuideKind, type GuideStep, type TestResult } from '@/shared/connect';
import { AUTH_LABELS, PICKER_GROUPS, presetFor, PROTOCOL_LABELS, ROLE_LABELS, type PresetId } from '@/shared/presets';
import { pricingFor } from '@/shared/pricing';
import { BASIC_FALLBACK, isProviderKey, readProviderSettings, removeConnection, removeProfile, revokeUnusedOrigin, saveConnectionStatus, saveProfile, saveRouting, saveSetup, type ProviderSettings } from '@/shared/providers';
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
    return `Chrome asks for access to ${u.protocol}//${u.hostname} only${u.port ? ' (all its ports, not just ' + u.port + ')' : ''}.`;
  } catch {
    return 'Chrome asks for access to this server only.';
  }
};
const newId = () => (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const perM = (n: number) => `$${Number(n.toFixed(3))}`;

interface Loaded {
  settings: ProviderSettings;
  /** Connection ids with a key on this device. */
  keyed: Set<string>;
}

async function load(api: Browser): Promise<Loaded> {
  const settings = await readProviderSettings(api);
  const keyed = new Set<string>();
  for (const c of settings.connections) if ((await readApiKey(api, c.id)) !== undefined) keyed.add(c.id);
  return { settings, keyed };
}

const isImplicit = (s: ProviderSettings, id: string) => s.implicit?.connections.includes(id) === true;
const routedIds = (s: ProviderSettings) => new Set([s.routing.translate, s.routing.analyze, ...(s.routing.fallback ?? [])].filter((x): x is string => x !== undefined));

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
  if (isImplicit(l.settings, c.id)) return needsKey ? { text: 'Built-in, no key', tone: 'muted' } : { text: 'Built-in · key saved', tone: 'muted' };
  if (needsKey) return { text: 'No key', tone: 'warn' };
  if (c.status === 'error') return { text: `⚠ ${c.lastError ?? 'Error'}`, tone: 'warn' };
  if (c.status === 'ok') return { text: '✓ Connected', tone: 'ok' };
  return { text: 'Not tested', tone: 'muted' };
}

const profileName = (p: ModelProfile, connections: readonly ProviderConnection[]) => `${p.model} · ${connections.find((c) => c.id === p.connectionId)?.label ?? '?'}`;

type View = { kind: 'list' } | { kind: 'add' } | { kind: 'edit'; id: string; guide?: boolean | undefined } | { kind: 'model' };

export function ProvidersSection({ api, adapterFor = createAdapter, retestMs = RETEST_MS }: { api: Browser; adapterFor?: AdapterFor; retestMs?: number }) {
  const [loaded, setLoaded] = useState<Loaded | undefined>();
  const [view, setView] = useState<View>({ kind: 'list' });
  const [note, setNote] = useState<{ text: string; warn?: boolean | undefined } | undefined>();
  const reload = () => load(api).then(setLoaded, (err: unknown) => setNote({ text: `Could not read the provider settings (${String(err)})`, warn: true }));
  useEffect(() => {
    void reload();
    const onSync = (changes: Record<string, unknown>) => {
      if (Object.keys(changes).some(isProviderKey)) void reload();
    };
    const onLocal = (changes: Record<string, unknown>) => {
      if (Object.keys(changes).some((k) => k.startsWith(SECRET_PREFIX))) void reload();
    };
    api.storage.sync.onChanged.addListener(onSync);
    api.storage.local.onChanged.addListener(onLocal);
    return () => {
      api.storage.sync.onChanged.removeListener(onSync);
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
      <h2 id="providers-h">Providers</h2>
      {!loaded ? (
        <p class="opt__hint">Reading…</p>
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
        Keys are stored on this device only and are never synced; connections, models and routing sync to your other devices without them. Extra headers and query params (under Advanced) sync
        like other settings, so keep secrets in the key field. Anyone with access to this browser profile could read a key. Use keys with a spending limit.
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
        const access = revoked ? ` and access to ${hostOf(c.baseUrl)}` : '';
        // Name only what there was (a keyless local server has no key, tester C1 #4).
        const parts = [hasModels ? 'its models' : '', keyed ? 'its key' : '', revoked ? `access to ${hostOf(c.baseUrl)}` : ''].filter(Boolean);
        const what = parts.length > 1 ? `, ${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts.length === 1 ? ` and ${parts[0]}` : '';
        if (!builtIn) return onNote(`Removed ${c.label}${what}.`);
        // Say what the list will show: a built-in stays listed (keyless) only while a route uses it.
        const listed = visibleConnections(await load(api)).some((x) => x.id === c.id);
        onNote(
          `Removed the key${access} of ${c.label}. ${listed ? 'It is built in and a route still uses it, so it stays listed without a key.' : 'It is built in and now hidden; use + Add to set that provider up again.'}`,
        );
      },
      (err: unknown) => onNote(`Could not remove ${c.label} (${err instanceof Error ? err.message : String(err)})`, true),
    );
  };
  return (
    <div class="prov__block" data-testid="connections">
      <div class="prov__head">
        <h3>Connections</h3>
        <button type="button" onClick={onAdd} data-testid="add-connection">
          + Add
        </button>
      </div>
      {rows.length === 0 ? <p class="opt__hint">No connections yet.</p> : null}
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
              <span class={`prov__status prov__status--${status.tone}`} data-testid="connection-status">
                {status.text}
              </span>
              <span class="prov__actions">
                {c.lastErrorKind === 'cors-origin' && c.status === 'error' ? (
                  <button type="button" onClick={() => onEdit(c.id, true)} data-testid="fix-cors">
                    Fix…
                  </button>
                ) : null}
                <button type="button" onClick={() => onEdit(c.id)} aria-label={`Edit ${c.label}`}>
                  Edit
                </button>
                {implicit && !loaded.keyed.has(c.id) ? null : confirm === c.id ? (
                  <span class="prov__confirm" data-testid="confirm-remove">
                    {implicit || BUILTIN_IDS.has(c.id) ? 'Remove its key and settings?' : `Remove ${c.label}, its models and its key?`}{' '}
                    <button type="button" onClick={() => remove(c)} data-testid="confirm-remove-yes">
                      Remove
                    </button>{' '}
                    <button type="button" onClick={() => setConfirm(undefined)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirm(c.id)} aria-label={`Remove ${c.label}`} data-testid="remove-connection">
                    {implicit ? 'Remove key' : 'Remove'}
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

const BUILTIN_IDS = new Set(BUILTIN_CONNECTIONS.map((c) => c.id));

// ---- Models -----------------------------------------------------------------------------------

function priceText(p: ModelProfile, c: ProviderConnection | undefined): string {
  // Ollama and LM Studio run here; a gateway that merely listens on localhost may still bill.
  if (c && presetFor(c.presetId, c.protocol).local !== undefined) return 'free · local';
  const price = c ? pricingFor(p, c) : p.pricing;
  return price ? `${perM(price.inPerM)}/${perM(price.outPerM)} per M` : 'no price set';
}

function Models({ api, loaded, onAdd, onNote }: { api: Browser; loaded: Loaded; onAdd: () => void; onNote: (text: string, warn?: boolean) => void }) {
  const { settings } = loaded;
  const rows = visibleProfiles(loaded);
  const remove = (p: ModelProfile) =>
    removeProfile(api, p.id).then(
      () => onNote(`Removed ${p.model}.`),
      (err: unknown) => onNote(err instanceof Error ? err.message : String(err), true),
    );
  const setProtocol = (p: ModelProfile, protocol: Protocol) =>
    saveProfileProtocol(api, p, protocol).then(
      () => onNote(`${p.model} now uses the ${PROTOCOL_LABELS[protocol]} API.`),
      (err: unknown) => onNote(String(err), true),
    );
  return (
    <div class="prov__block" data-testid="models">
      <div class="prov__head">
        <h3>Models</h3>
        <button type="button" onClick={onAdd} data-testid="add-model">
          + Add
        </button>
      </div>
      <ul class="prov__list">
        {rows.map((p) => {
          const c = settings.connections.find((x) => x.id === p.connectionId);
          const roles = [settings.routing.translate === p.id ? ROLE_LABELS.translate : '', settings.routing.analyze === p.id ? ROLE_LABELS.analyze : ''].filter(Boolean);
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
                  <select value={p.protocolOverride ?? c.detectedProtocols?.[0]} onChange={(e) => void setProtocol(p, (e.target as HTMLSelectElement).value as Protocol)} aria-label={`API format for ${p.model}`}>
                    {(c.detectedProtocols ?? []).map((x) => (
                      <option key={x} value={x}>
                        {PROTOCOL_LABELS[x]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <span class="prov__actions">
                {implicit || settings.routing.translate === p.id ? null : (
                  <button type="button" onClick={() => void remove(p)} aria-label={`Remove ${p.model}`}>
                    Remove
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
      {selected !== undefined && !profiles.some((p) => p.id === selected) ? <option value={selected}>(missing model)</option> : null}
      {profiles.filter((p) => p.id === selected || !exclude.includes(p.id)).map((p) => (
        <option key={p.id} value={p.id}>
          {profileName(p, settings.connections)}
        </option>
      ))}
    </>
  );
  const save = (patch: { translate?: string; analyze?: string | undefined; fallback?: string[] }, said: string) => {
    const { analyze, fallback, ...rest } = { ...settings.routing, ...patch };
    const next: ProviderSettings['routing'] = { ...rest, ...(analyze === undefined ? {} : { analyze }), ...(fallback?.length ? { fallback } : {}) };
    saveRouting(api, next).then(
      () => onNote(said),
      (err: unknown) => onNote(err instanceof Error ? err.message : String(err), true),
    );
  };
  const sites = settings.routing.siteOverrides ?? [];
  return (
    <div class="prov__block" data-testid="routing">
      <h3>Routing</h3>
      <div class="opt__row">
        <label for="route-translate">{ROLE_LABELS.translate} with</label>
        <select id="route-translate" value={settings.routing.translate} onChange={(e) => save({ translate: (e.target as HTMLSelectElement).value }, 'Translate route saved.')}>
          {options(settings.routing.translate)}
        </select>
      </div>
      <div class="opt__row">
        <label for="route-analyze">{ROLE_LABELS.analyze}</label>
        <select
          id="route-analyze"
          value={settings.routing.analyze ?? ''}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            save({ analyze: v === '' ? undefined : v }, `${ROLE_LABELS.analyze} route saved.`);
          }}
        >
          <option value="">Same as translate</option>
          {options(settings.routing.analyze)}
        </select>
      </div>
      <p class="opt__hint">The document brief is one short call per page that finds its topic, tone and key terms; a cheaper model often does it well.</p>
      <FallbackChain settings={settings} profiles={profiles} options={options} onSave={(fallback, said) => save({ fallback }, said)} />
      {sites.length ? (
        <ul class="prov__list" data-testid="site-rules">
          {sites.map((r) => (
            <li key={r.pattern} class="opt__hint">
              Site rule: {r.pattern} → {profiles.find((p) => p.id === r.translate)?.model ?? '(missing model)'}
              {r.localOnly ? ' (local only)' : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * "If it fails" (DESIGN §4.3.3 A, plan M4-E9): the fallback chain, tried in order when the model
 * routed for a page is rate-limited, overloaded or unreachable. Entries that are not profiles
 * (the `basic` entry of M5-E7) are kept as they are and can only be removed.
 */
function FallbackChain({ settings, profiles, options, onSave }: { settings: ProviderSettings; profiles: readonly ModelProfile[]; options: (selected: string | undefined, exclude?: readonly string[]) => ComponentChildren; onSave: (fallback: string[], said: string) => void }) {
  const chain = settings.routing.fallback ?? [];
  const unused = profiles.filter((p) => p.id !== settings.routing.translate && !chain.includes(p.id));
  const named = (id: string) => (id === BASIC_FALLBACK ? 'Chrome built-in (basic)' : (profiles.find((p) => p.id === id)?.model ?? '(missing model)'));
  return (
    <div class="opt__row prov__fallback" data-testid="route-fallback">
      <span class="prov__label" id="route-fallback-label">
        If it fails
      </span>
      <ol class="prov__chain" aria-labelledby="route-fallback-label">
        {chain.map((id, i) => (
          <li key={`${i}:${id}`}>
            {i > 0 ? <span aria-hidden="true">→ </span> : null}
            {profiles.some((p) => p.id === id) ? (
              <select
                aria-label={`Fallback ${i + 1}`}
                value={id}
                onChange={(e) => {
                  const next = [...chain];
                  next[i] = (e.target as HTMLSelectElement).value;
                  onSave(next.filter((x, j) => next.indexOf(x) === j), 'Fallback saved.');
                }}
              >
                {/* Not the translate model itself, nor a model already in the chain (M4-D tester). */}
                {options(id, [settings.routing.translate, ...chain])}
              </select>
            ) : (
              <span>{named(id)}</span>
            )}{' '}
            <button type="button" class="prov__small" aria-label={`Remove fallback ${i + 1} (${named(id)})`} onClick={() => onSave(chain.filter((_, j) => j !== i), 'Fallback removed.')}>
              ×
            </button>
          </li>
        ))}
        {unused.length ? (
          <li>
            <button type="button" class="prov__small" data-testid="fallback-add" onClick={() => onSave([...chain, (unused[0] as ModelProfile).id], 'Fallback added.')}>
              {chain.length ? '+' : '+ Add a fallback model'}
            </button>
          </li>
        ) : chain.length === 0 ? (
          <li class="opt__hint">Add a second model to use one.</li>
        ) : null}
      </ol>
      <p class="opt__hint">
        Used when the routed model is rate-limited, overloaded or unreachable; never when its key is refused or out of credit, so text never goes to another provider for those. A site rule marked “local only” falls back only to
        models on this device.
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
      if (!conn) return setError('This connection has no key.');
      const result = await adapterFor(conn.protocol).probe(conn);
      if (result.ok) return setModels(displayModels(conn.quirks, result.models ?? []));
      const message = connectMessage(result.error, { preset: presetFor(connection.presetId, connection.protocol), baseUrl: connection.baseUrl, model });
      setError(message.text);
      setNeedsAccess(message.action === 'grant');
    })().catch((err: unknown) => setError(String(err)));
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
      ({ routed }) => onDone(`Added ${profile.model}${routed ? '; pages now translate with it' : ''}.`),
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );
  };
  if (usable.length === 0) {
    return (
      <div class="prov__block">
        <p class="opt__hint">Add a connection with a key first.</p>
        <button type="button" onClick={() => onDone()}>
          Back
        </button>
      </div>
    );
  }
  return (
    <form class="prov__block" onSubmit={save} data-testid="model-form">
      <h3>Add a model</h3>
      <div class="opt__row">
        <label for="m-conn">Connection</label>
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
              Grant access
            </button>
          ) : null}
        </p>
      ) : null}
      <div class="opt__row">
        <button type="submit" disabled={model.trim() === ''}>
          Save
        </button>
        <button type="button" onClick={() => onDone()}>
          Cancel
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
        <label for={id}>Model</label>
        <input id={id} list={`${id}-list`} value={model} placeholder={models.length ? `Search ${models.length} models, or type an id` : 'Type a model id'} onInput={(e) => onModel((e.target as HTMLInputElement).value)} autocomplete="off" spellcheck={false} />
        <datalist id={`${id}-list`} data-testid="model-list">
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {[m.displayName, m.contextWindow ? `${Math.round(m.contextWindow / 1000)}K context` : ''].filter(Boolean).join(' · ')}
            </option>
          ))}
        </datalist>
      </div>
      {info?.contextWindow ? (
        <p class="opt__hint" data-testid="model-context">
          {info.displayName ?? info.id}: {info.contextWindow.toLocaleString('en-US')} tokens of context.
        </p>
      ) : null}
    </>
  );
}

// ---- Add / edit connection --------------------------------------------------------------------

type TestState = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; result: TestResult; message?: ConnectMessage | undefined };

function ConnectionForm({
  api,
  adapterFor,
  loaded,
  editing,
  openGuide,
  retestMs,
  onDone,
}: {
  api: Browser;
  adapterFor: AdapterFor;
  loaded: Loaded;
  editing: ProviderConnection | undefined;
  openGuide: boolean;
  retestMs: number;
  onDone: (text?: string) => void;
}) {
  const routedModel = editing ? loaded.settings.profiles.find((p) => p.connectionId === editing.id && p.id === loaded.settings.routing.translate)?.model : undefined;
  const firstModel = editing ? loaded.settings.profiles.find((p) => p.connectionId === editing.id)?.model : undefined;
  const [draft, setDraft] = useState<ConnectionDraft | undefined>(editing ? draftFromConnection(editing, routedModel ?? firstModel ?? '') : undefined);
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
      setError('The base URL now points at another server: enter the key again, so this key never goes to a server it was not made for.');
      keyInput.current?.focus();
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
      onDone(`Saved ${connection.label}${profile ? ` with ${profile.model}` : ''}.${routed ? ` Pages now translate with ${profile?.model}.` : ''}`);
    })().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <form class="prov__block" onSubmit={onSave} data-testid="connection-form">
      <h3>{editing ? `Edit ${editing.label}` : `Add ${preset.label}`}</h3>
      {preset.note ? <p class="opt__hint">{preset.note}</p> : null}
      <div class="opt__row">
        <label for="c-label">Name</label>
        <input id="c-label" value={draft.label} placeholder={preset.custom ? 'e.g. Company gateway' : preset.label} onInput={(e) => set({ label: (e.target as HTMLInputElement).value })} />
      </div>
      {fields.baseUrl ? <BaseUrlField draft={draft} set={set} /> : null}
      {fields.apiFormat ? (
        <div class="opt__row">
          <label for="c-format">API format</label>
          <select id="c-format" value={draft.protocol} onChange={(e) => set({ protocol: (e.target as HTMLSelectElement).value as Protocol | 'auto' })}>
            {(['openai-chat', 'anthropic-messages', 'auto'] as const).map((p) => (
              <option key={p} value={p}>
                {PROTOCOL_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {fields.auth ? (
        <div class="opt__row">
          <label for="c-auth">Auth</label>
          <select id="c-auth" value={draft.authStyle} onChange={(e) => set({ authStyle: (e.target as HTMLSelectElement).value as ConnectionDraft['authStyle'] })}>
            {(preset.authChoices ?? [preset.auth]).map((a) => (
              <option key={a} value={a}>
                {AUTH_LABELS[a]}
              </option>
            ))}
          </select>
          {draft.authStyle === 'custom-header' ? <input aria-label="Header name" placeholder="Header name, e.g. api-key" value={draft.headerName} onInput={(e) => set({ headerName: (e.target as HTMLInputElement).value })} /> : null}
        </div>
      ) : null}
      {fields.key ? (
        <div class="opt__row">
          <label for="c-key">API key</label>
          <input
            id="c-key"
            ref={keyInput}
            type="password"
            autocomplete="off"
            spellcheck={false}
            value={draft.apiKey}
            placeholder={
              storedKey && moved
                ? 'Enter the key again for the new server'
                : storedKey
                  ? `Saved: ${maskKey(storedKey)} (enter a new key to replace it)`
                  : `Paste your ${preset.custom ? '' : `${preset.label} `}API key`
            }
            onInput={(e) => set({ apiKey: (e.target as HTMLInputElement).value })}
          />
          {preset.keyUrl ? (
            <a href={preset.keyUrl} target="_blank" rel="noreferrer">
              Get a key ↗
            </a>
          ) : null}
        </div>
      ) : null}
      <details class="prov__advanced" data-testid="advanced">
        <summary>Advanced</summary>
        <p class="opt__hint" data-testid="advanced-sync-note">
          Extra headers and query params sync to your other devices with the connection: don't put a key or other secret here.
        </p>
        {fields.baseUrl ? null : <BaseUrlField draft={draft} set={set} />}
        <div class="opt__row">
          <label for="c-headers">Extra headers</label>
          <textarea id="c-headers" rows={2} placeholder="Name: value, one per line" value={draft.extraHeaders} onInput={(e) => set({ extraHeaders: (e.target as HTMLTextAreaElement).value })} />
        </div>
        <div class="opt__row">
          <label for="c-query">Query params</label>
          <textarea id="c-query" rows={1} placeholder="api-version=2024-10-21, one per line" value={draft.queryParams} onInput={(e) => set({ queryParams: (e.target as HTMLTextAreaElement).value })} />
        </div>
        <div class="opt__row">
          {(
            [
              ['maxCompletionTokens', 'Send max_completion_tokens'],
              ['noTemperature', 'No temperature'],
              ['noSystemRole', 'No system role'],
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
          {test.kind === 'running' ? 'Testing…' : 'Test connection'}
        </button>
        <span class="opt__hint" data-testid="access-hint">{accessHint(fixBaseUrl(draft.baseUrl).url)}</span>
      </div>
      {test.kind === 'done' ? <TestOutcome draft={draft} protocol={protocol} test={test} onFixKey={() => keyInput.current?.focus()} onRetry={onTest} onUseUrl={(url) => set({ baseUrl: url })} onGuide={() => setGuide(true)} /> : null}
      {guide ? <CorsGuide local={preset.local ?? 'generic'} onClose={() => setGuide(false)} /> : null}
      <ModelPicker id="c-model" model={draft.model} models={models} onModel={(m) => set({ model: m })} />
      {dual ? (
        <fieldset class="prov__protocol" data-testid="protocol-switch">
          <legend>API for this model</legend>
          <div class="prov__radios">
            {(['anthropic-messages', 'openai-chat'] as const).map((p) => (
              <label key={p}>
                <input type="radio" name="c-protocol" checked={protocol === p} onChange={() => setProtocolChoice(p)} /> {PROTOCOL_LABELS[p]}
              </label>
            ))}
          </div>
          <p class="opt__hint">
            Both work here. Claude models default to Anthropic-compatible, so prompt caching works fully; others to OpenAI-compatible.
            {isClaudeModel(draft.model) && /haiku/i.test(draft.model) ? ' On Haiku caching brings little: its minimum cacheable prompt is longer than a typical translation prefix.' : ''}
          </p>
        </fieldset>
      ) : null}
      {error ? <p class="opt__status opt__status--warn">{error}</p> : null}
      <div class="opt__row">
        <button type="submit" data-testid="save-connection">
          Save
        </button>
        <button type="button" onClick={cancel} data-testid="cancel-connection">
          Cancel
        </button>
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
      <label for="c-base">Base URL</label>
      <input id="c-base" type="url" spellcheck={false} value={draft.baseUrl} placeholder="https://llm.example.com/v1" onInput={(e) => set({ baseUrl: (e.target as HTMLInputElement).value })} />
    </div>
  );
}

function PresetPicker({ onPick, onCancel }: { onPick: (id: PresetId) => void; onCancel: () => void }) {
  return (
    <div class="prov__block" data-testid="preset-picker">
      <h3>Add a connection</h3>
      {PICKER_GROUPS.map((g) => (
        <div key={g.title}>
          <p class="opt__hint">{g.title}</p>
          <ul class="prov__presets">
            {g.presets.map((p) => (
              <li key={p.id}>
                <button type="button" class="prov__preset" onClick={() => onPick(p.id)} data-preset={p.id}>
                  <strong>{p.label}</strong>
                  <span class="opt__hint">{p.blurb}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <button type="button" onClick={onCancel}>
        Cancel
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
          Base URL corrected to <code>{f.to}</code>: {URL_FIX_TEXT[f.reason]}
        </li>
      ))}
    </ul>
  ) : null;
  if (result.ok) {
    return (
      <div class="prov__outcome prov__outcome--ok" role="status" data-testid="test-result">
        <p>
          <strong>✓ Connected</strong> · {result.models.length ? `${result.models.length} models` : 'no model list'} · {result.detected.map((p) => PROTOCOL_LABELS[p]).join(' and ')}
          {/* The API named is the switch's below, so the two agree (tester C1 #2). */}
          {draft.protocol === 'auto' ? ` detected${result.detected.length > 1 && draft.model.trim() ? `; ${draft.model.trim()} uses ${PROTOCOL_LABELS[protocol]}` : ''}` : ''}
        </p>
        {result.modelUnchecked ? (
          <p class="opt__hint" data-testid="pick-model">
            No model was tried yet: pick one below and test again{result.keyUnchecked ? ' to check the key (this provider lists its models without one)' : ' to check it'}.
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
          Fix key
        </button>
      ) : m.action === 'grant' ? (
        <button type="button" onClick={onRetry}>
          Grant access
        </button>
      ) : m.action === 'cors-guide' ? (
        <button type="button" onClick={onGuide} data-testid="open-guide">
          Fix…
        </button>
      ) : m.action === 'use-url' && m.suggestion ? (
        <button type="button" onClick={() => onUseUrl(m.suggestion as string)}>
          Use {m.suggestion}
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
        {copied ? 'Copied' : 'Copy'}
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
        Testing again every few seconds; this closes when the connection works.
      </p>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
