import { describe, expect, it } from 'vitest';
import {
  BROAD_ORIGINS,
  excludedMatches,
  listenForSelectionEverywhere,
  reconcileSelectionScript,
  requestBroadAccess,
  SELECTION_EVERYWHERE_KEY,
  SELECTION_SCRIPT_FILE,
  SELECTION_SCRIPT_ID,
  setSelectionEverywhere,
} from './selection-button.ts';

type Api = Parameters<typeof reconcileSelectionScript>[0];
type Script = { id: string; matches: string[]; excludeMatches: string[]; js: string[]; allFrames: boolean; persistAcrossSessions: boolean };
type Listener = (...args: never[]) => void;

/** A worker-side fake: storage (the option is local, the site lists sync), permissions and registered content scripts, with their events. */
function fakeApi({ sync = {}, local = {}, granted = [] as string[], deny = false } = {}) {
  const store: Record<string, unknown> = { ...sync };
  const localStore: Record<string, unknown> = { ...local };
  const perms = new Set(granted);
  const scripts = new Map<string, Script>();
  const calls: string[] = [];
  const listeners: Record<string, Listener[]> = {};
  const on = (name: string) => ({ addListener: (fn: Listener) => (listeners[name] ??= []).push(fn) });
  const fire = (name: string, ...args: unknown[]) => listeners[name]?.forEach((fn) => (fn as (...a: unknown[]) => void)(...args));
  const area = (data: Record<string, unknown>, event: string) => ({
    get: (k: string | string[]) => Promise.resolve(Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in data).map((x) => [x, data[x]]))),
    set: (o: Record<string, unknown>) => {
      const changes = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { oldValue: data[k], newValue: v }]));
      Object.assign(data, o);
      fire(event, changes);
      return Promise.resolve();
    },
    onChanged: on(event),
  });
  const api = {
    storage: { sync: area(store, 'syncChanged'), local: area(localStore, 'localChanged') },
    permissions: {
      contains: (p: { origins: string[] }) => Promise.resolve(p.origins.every((o) => perms.has(o))),
      request: (p: { origins: string[] }) => {
        calls.push(`request:${p.origins.join()}`);
        if (deny) return Promise.resolve(false);
        p.origins.forEach((o) => perms.add(o));
        return Promise.resolve(true);
      },
      onAdded: on('permAdded'),
      onRemoved: on('permRemoved'),
    },
    scripting: {
      getRegisteredContentScripts: (f: { ids: string[] }) => Promise.resolve([...scripts.values()].filter((s) => f.ids.includes(s.id))),
      registerContentScripts: (list: Script[]) => {
        for (const s of list) {
          if (scripts.has(s.id)) return Promise.reject(new Error(`Duplicate script ID '${s.id}'`));
          scripts.set(s.id, s);
          calls.push(`register:${s.id}`);
        }
        return Promise.resolve();
      },
      updateContentScripts: (list: Script[]) => {
        for (const s of list) {
          scripts.set(s.id, s);
          calls.push(`update:${s.id}`);
        }
        return Promise.resolve();
      },
      unregisterContentScripts: (f: { ids: string[] }) => {
        for (const id of f.ids) {
          scripts.delete(id);
          calls.push(`unregister:${id}`);
        }
        return Promise.resolve();
      },
    },
  } as unknown as Api;
  return { api, store, localStore, perms, scripts, calls, fire };
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('reconcileSelectionScript', () => {
  it('registers nothing by default: the option is off and no broad permission is held', async () => {
    const f = fakeApi();
    expect(await reconcileSelectionScript(f.api)).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it('registers the script on every http(s) page, top frame only, when the option is on and the permission held', async () => {
    const f = fakeApi({ local: { [SELECTION_EVERYWHERE_KEY]: true }, sync: { siteNever: ['bank.example'] }, granted: BROAD_ORIGINS });
    expect(await reconcileSelectionScript(f.api)).toBe(true);
    const script = f.scripts.get(SELECTION_SCRIPT_ID) as Script;
    expect(script).toMatchObject({ matches: BROAD_ORIGINS, js: [SELECTION_SCRIPT_FILE], allFrames: false, persistAcrossSessions: true });
    expect(script.excludeMatches).toContain('*://bank.example/*');
    expect(script.excludeMatches).toContain('*://*.mail.google.com/*');
  });

  it('an option on without the permission (refused, removed in chrome://extensions, or imported) registers nothing', async () => {
    const f = fakeApi({ local: { [SELECTION_EVERYWHERE_KEY]: true }, granted: ['https://*/*'] });
    expect(await reconcileSelectionScript(f.api)).toBe(false);
    expect(f.scripts.size).toBe(0);
  });

  it('leaves a matching registration alone, updates a changed one instead of registering it twice, and unregisters when either side goes', async () => {
    const f = fakeApi({ local: { [SELECTION_EVERYWHERE_KEY]: true }, granted: BROAD_ORIGINS });
    await reconcileSelectionScript(f.api);
    await reconcileSelectionScript(f.api);
    expect(f.calls).toEqual([`register:${SELECTION_SCRIPT_ID}`]);
    f.store.siteNever = ['bank.example'];
    await reconcileSelectionScript(f.api);
    expect(f.calls).toEqual([`register:${SELECTION_SCRIPT_ID}`, `update:${SELECTION_SCRIPT_ID}`]);
    f.perms.delete('http://*/*');
    expect(await reconcileSelectionScript(f.api)).toBe(false);
    expect(f.scripts.size).toBe(0);
  });
});

describe('the option', () => {
  it('turning it on asks for both broad patterns; turning it off unregisters but keeps the permission', async () => {
    const f = fakeApi();
    listenForSelectionEverywhere(f.api);
    expect(await requestBroadAccess(f.api)).toBe(true);
    expect(f.calls).toEqual([`request:${BROAD_ORIGINS.join()}`]);
    await setSelectionEverywhere(f.api, true);
    await flush();
    expect(f.scripts.has(SELECTION_SCRIPT_ID)).toBe(true);
    // Per device, like the access: nothing is synced.
    expect(f.localStore[SELECTION_EVERYWHERE_KEY]).toBe(true);
    expect(SELECTION_EVERYWHERE_KEY in f.store).toBe(false);
    await setSelectionEverywhere(f.api, false);
    await flush();
    expect(f.scripts.size).toBe(0);
    // S9: removing the broad patterns could not be shown to leave narrower grants alone.
    expect([...f.perms]).toEqual(BROAD_ORIGINS);
  });

  it('a refused prompt grants nothing', async () => {
    const f = fakeApi({ deny: true });
    expect(await requestBroadAccess(f.api)).toBe(false);
    expect(f.perms.size).toBe(0);
  });

  it('the worker follows the permission being removed and granted again', async () => {
    const f = fakeApi({ local: { [SELECTION_EVERYWHERE_KEY]: true }, granted: BROAD_ORIGINS });
    listenForSelectionEverywhere(f.api);
    await flush();
    expect(f.scripts.has(SELECTION_SCRIPT_ID)).toBe(true);
    f.perms.clear();
    f.fire('permRemoved', { origins: BROAD_ORIGINS });
    await flush();
    expect(f.scripts.size).toBe(0);
    BROAD_ORIGINS.forEach((o) => f.perms.add(o));
    f.fire('permAdded', { origins: BROAD_ORIGINS });
    f.fire('permAdded', { origins: BROAD_ORIGINS });
    await flush();
    // Two events at once register it once.
    expect(f.calls.filter((c) => c.startsWith('register'))).toHaveLength(2);
    expect(f.scripts.has(SELECTION_SCRIPT_ID)).toBe(true);
  });

  it('the exclusions follow the never-translate list', async () => {
    const f = fakeApi({ local: { [SELECTION_EVERYWHERE_KEY]: true }, granted: BROAD_ORIGINS });
    listenForSelectionEverywhere(f.api);
    await flush();
    await f.api.storage.sync.set({ siteNever: ['*.bank.example'] });
    await flush();
    expect(f.scripts.get(SELECTION_SCRIPT_ID)?.excludeMatches).toContain('*://*.bank.example/*');
  });
});

describe('excludedMatches', () => {
  it('turns site patterns into match patterns for the built-in denylist and the never list', () => {
    expect(excludedMatches(['example.com', '*.bank.example'])).toEqual(expect.arrayContaining(['*://*.accounts.google.com/*', '*://example.com/*', '*://*.bank.example/*']));
  });
});
