// @vitest-environment jsdom
// Onboarding (plan M4-E13, DESIGN §4.3.3 C): language → how to translate → connect, test and
// translate a sample. Skippable, reopenable, and the sample respects the privacy notice.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderLines, translatorClient } from '@/engine/testing';
import { createAnthropicAdapter } from '@/llm/anthropic';
import { createOpenAIAdapter } from '@/llm/openai';
import { anthropicStream } from '@/llm/testing';
import type { Protocol } from '@/llm/types';
import { markOnboarding, ONBOARDING_KEY, ONBOARDING_PAGE, openOnboarding, readOnboarding } from '@/shared/onboarding';
import { PRIVACY_KEY } from '../sidepanel/privacy.ts';
import { Jobs } from '../sidepanel/jobs.ts';
import { resolveRoute } from '@/shared/providers';
import { Onboarding } from './Onboarding.tsx';

type Api = Parameters<typeof Onboarding>[0]['api'];

function fakeApi(opts: { local?: Record<string, unknown> } = {}) {
  const area = (init: Record<string, unknown>) => {
    const m = new Map(Object.entries(structuredClone(init)));
    const listeners = new Set<(c: Record<string, unknown>) => void>();
    const fire = (keys: string[]) => listeners.forEach((l) => l(Object.fromEntries(keys.map((k) => [k, { newValue: m.get(k) }]))));
    return {
      m,
      get: (k: string | string[] | null) => {
        const list = k === null ? [...m.keys()] : typeof k === 'string' ? [k] : k;
        return Promise.resolve(structuredClone(Object.fromEntries(list.filter((x) => m.has(x)).map((x) => [x, m.get(x)]))));
      },
      set: (o: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(structuredClone(o))) m.set(k, v);
        fire(Object.keys(o));
        return Promise.resolve();
      },
      remove: (k: string | string[]) => {
        const keys = typeof k === 'string' ? [k] : k;
        keys.forEach((x) => m.delete(x));
        fire(keys);
        return Promise.resolve();
      },
      getBytesInUse: () => Promise.resolve(0),
      onChanged: { addListener: (l: (c: Record<string, unknown>) => void) => listeners.add(l), removeListener: (l: (c: Record<string, unknown>) => void) => listeners.delete(l) },
    };
  };
  const sync = area({ prefs: { targetLang: 'vi', sourceLang: 'auto', style: 'natural' } });
  const local = area(opts.local ?? {});
  const perms = new Set<string>();
  const requested: string[][] = [];
  const tabs: string[] = [];
  const api = {
    storage: { sync, local, session: area({}) },
    permissions: {
      contains: ({ origins }: { origins: string[] }) => Promise.resolve(origins.every((o) => perms.has(o))),
      request: ({ origins }: { origins: string[] }) => {
        requested.push([...origins]);
        origins.forEach((o) => perms.add(o));
        return Promise.resolve(true);
      },
      remove: () => Promise.resolve(true),
      onAdded: { addListener: () => {}, removeListener: () => {} },
    },
    i18n: { getUILanguage: () => 'en' },
    runtime: { getURL: (p: string) => `chrome-extension://abc${p}` },
    tabs: { create: (o: { url: string }) => (tabs.push(o.url), Promise.resolve({})) },
  } as unknown as Api;
  return { api, sync: sync.m, local: local.m, tabs, requested };
}

function server() {
  const hits: string[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    hits.push(`${init?.method ?? 'GET'} ${url.host}${url.pathname}`);
    if (url.pathname === '/v1/models') {
      return new Response(JSON.stringify({ data: ['claude-haiku-4-5'].map((id) => ({ id, type: 'model', display_name: id, created_at: '2025-01-01T00:00:00Z' })), has_more: false }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(anthropicStream({ text: ['H'], stop_reason: 'max_tokens' }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof globalThis.fetch;
  const adapterFor = (p: Protocol) => (p === 'anthropic-messages' ? createAnthropicAdapter({ fetch }) : createOpenAIAdapter({ fetch }));
  return { hits, adapterFor };
}

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
});
const flush = () => act(async () => new Promise((r) => setTimeout(r, 10)));
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out; page says: ${root.textContent}`);
    await flush();
  }
};
const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
const t = (id: string) => $(`[data-testid=${id}]`);
const click = (el: Element | null) => act(() => void (el as HTMLElement).click());
const type = (sel: string, value: string) =>
  act(() => {
    const el = $<HTMLInputElement>(sel);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const pickValue = (sel: string, value: string) =>
  act(() => {
    const el = $<HTMLSelectElement>(sel);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

/** A fake client the sample runs on, and how many requests it saw: the privacy gate must keep it at 0. */
function sampleJobs(f: ReturnType<typeof fakeApi>, fail = false) {
  const client = translatorClient((lines) => (fail ? { text: '', stopReason: 'error' as never } : renderLines(lines, (s) => `[vi] ${s}`)), { model: 'claude-haiku-4-5' });
  const jobs = new Jobs({
    translateClient: async (target) => {
      const route = await resolveRoute(f.api, 'translate', target);
      if (!route.ok) return { ok: false as const, error: { kind: 'bad_request' as const, message: route.message } };
      return { ok: true as const, client, profile: route.profile, connection: { id: route.connection.id, label: route.connection.label } };
    },
    strategy: 'single-pass',
    cache: undefined,
  });
  return { jobs, client };
}

async function mount(f: ReturnType<typeof fakeApi>, srv = server(), extra: Partial<Parameters<typeof Onboarding>[0]> = {}) {
  act(() => render(<Onboarding api={f.api} adapterFor={srv.adapterFor} retestMs={100000} {...extra} />, root));
  await waitFor(() => t('onboarding-lang') !== null && !$<HTMLButtonElement>('[data-testid=onboarding-next]').disabled);
  return srv;
}
const toStep3 = async () => {
  click(t('onboarding-next'));
  await waitFor(() => t('onboarding-how') !== null);
  click(t('onboarding-next'));
  await waitFor(() => t('connection-form') !== null);
};
/** Step 3 with Anthropic: key, Test connection, the discovered model, Save. */
async function connectAnthropic() {
  await type('#c-key', 'sk-ant-test-0123456789');
  click(t('test-connection'));
  await waitFor(() => $<HTMLInputElement>('#c-model')?.value === 'claude-haiku-4-5' || /connected|works|✓/i.test(root.textContent ?? ''));
  await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  if ($<HTMLInputElement>('#c-model').value === '') await type('#c-model', 'claude-haiku-4-5');
  await act(() => void $('[data-testid=connection-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await waitFor(() => t('onboarding-sample') !== null);
}

describe('onboarding (M4-E13)', () => {
  it('step 1 saves the native language and goes on', async () => {
    const f = fakeApi();
    await mount(f);
    expect($<HTMLSelectElement>('[data-testid=onboarding-lang]').value).toBe('vi');
    await pickValue('[data-testid=onboarding-lang]', 'fr');
    click(t('onboarding-next'));
    await waitFor(() => t('onboarding-how') !== null);
    expect((f.sync.get('prefs') as { targetLang: string }).targetLang).toBe('fr');
    expect(t('onboarding-step-2')?.getAttribute('aria-current')).toBe('step');
  });

  it('step 2 offers the key path (Anthropic recommended), a local model, and Chrome built-in as coming soon', async () => {
    await mount(fakeApi());
    click(t('onboarding-next'));
    await waitFor(() => t('onboarding-how') !== null);
    expect($<HTMLInputElement>('[data-testid=path-key]').checked).toBe(true);
    expect($<HTMLSelectElement>('[data-testid=cloud-preset]').value).toBe('anthropic');
    expect(t('cloud-preset')?.textContent).toContain('(recommended)');
    expect(t('path-local')).not.toBeNull();
    expect($<HTMLInputElement>('[data-testid=path-builtin]').disabled).toBe(true);
    expect(t('path-builtin-card')?.textContent).toContain('Coming soon');
  });

  it('asks the browser for the chosen provider\'s origin only, and for nothing wider', async () => {
    const f = fakeApi();
    await mount(f, server(), { jobs: sampleJobs(f).jobs });
    await toStep3();
    await connectAnthropic();
    const origins = f.requested.flat();
    expect(origins.length).toBeGreaterThan(0);
    expect(new Set(origins)).toEqual(new Set(['https://api.anthropic.com/*']));
  });

  it('step 2 cards keep their selects out of the radio labels, so names stay clean and a select click does not toggle', async () => {
    await mount(fakeApi());
    click(t('onboarding-next'));
    await waitFor(() => t('onboarding-how') !== null);
    expect(root.querySelector('fieldset legend')?.textContent).toBe('How to translate');
    expect(root.querySelector('label select, label label')).toBeNull();
    const label = root.querySelector('label[for=onb-path-key]');
    expect(label?.textContent).toBe('Best quality: an API key');
    expect(t('path-key')?.getAttribute('aria-describedby')).toBe('onb-path-key-sub');
    click(t('path-local'));
    await waitFor(() => t('local-preset') !== null);
    click($('[data-testid=local-preset]'));
    expect($<HTMLInputElement>('[data-testid=path-local]').checked).toBe(true);
  });

  it('focus follows the step: the new heading after Next, the privacy button when the notice appears', async () => {
    const f = fakeApi();
    await mount(f, server(), { jobs: sampleJobs(f).jobs });
    click(t('onboarding-next'));
    await waitFor(() => t('onboarding-how') !== null);
    expect(document.activeElement?.tagName).toBe('H2');
    expect(document.activeElement?.textContent).toBe('How do you want to translate?');
    click(t('onboarding-next'));
    await waitFor(() => t('connection-form') !== null);
    expect(document.activeElement?.tagName).toBe('H2');
    await connectAnthropic();
    click(t('translate-sample'));
    await waitFor(() => t('onboarding-privacy') !== null);
    await waitFor(() => document.activeElement === t('onboarding-privacy-ok'));
  });

  it('a local model goes to the Ollama form with no key field, and says nothing leaves the computer', async () => {
    await mount(fakeApi());
    click(t('onboarding-next'));
    await waitFor(() => t('onboarding-how') !== null);
    click(t('path-local'));
    await waitFor(() => t('local-preset') !== null);
    click(t('onboarding-next'));
    await waitFor(() => t('connection-form') !== null);
    expect(t('connection-form')?.textContent).toContain('Ollama');
    expect($('#c-key')).toBeNull();
    expect(t('onboarding-key-note')?.textContent).toContain('Nothing leaves this computer');
  });

  it('the key path says where the key stays, and reuses the Providers form and Test connection', async () => {
    const f = fakeApi();
    const srv = await mount(f);
    await toStep3();
    expect(t('connection-form')?.textContent).toContain('Add Anthropic');
    expect(t('onboarding-key-note')?.textContent).toContain('not synced');
    await type('#c-key', 'sk-ant-test-0123456789');
    click(t('test-connection'));
    await waitFor(() => srv.hits.length >= 1);
    expect(srv.hits[0]).toBe('GET api.anthropic.com/v1/models');
  });

  it('after Save the first route is this model; the sample waits for the privacy notice, then translates through that connection', async () => {
    const f = fakeApi();
    const { jobs, client } = sampleJobs(f);
    await mount(f, server(), { jobs });
    await toStep3();
    await connectAnthropic();
    const routing = f.sync.get('routing') as { translate: string };
    expect((f.sync.get(`profile:${routing.translate}`) as { model: string }).model).toBe('claude-haiku-4-5');
    expect((f.local.get('secret:' + (f.sync.get(`profile:${routing.translate}`) as { connectionId: string }).connectionId))).toBe('sk-ant-test-0123456789');
    // Vietnamese reader: an English sample.
    expect(t('sample-original')?.textContent).toContain('library');

    click(t('translate-sample'));
    await waitFor(() => t('onboarding-privacy') !== null);
    await waitFor(() => t('onboarding-privacy-provider') !== null);
    expect(t('onboarding-privacy-provider')?.textContent).toBe('Anthropic (Claude)');
    await flush();
    expect(client.requests.length).toBe(0);
    expect(f.local.has(PRIVACY_KEY)).toBe(false);

    click(t('onboarding-privacy-ok'));
    await waitFor(() => t('sample-translation') !== null && t('sample-model') !== null);
    expect(t('sample-translation')?.textContent).toContain('[vi]');
    expect(t('sample-model')?.textContent).toContain('claude-haiku-4-5');
    expect(client.requests.length).toBeGreaterThan(0);
    expect(f.local.has(PRIVACY_KEY)).toBe(true);
    await flush();
    expect(t('onboarding-privacy')).toBeNull();

    click(t('onboarding-finish'));
    await waitFor(() => t('onboarding-closed') !== null);
    expect(await readOnboarding(f.api)).toBe('done');
  });

  it('with the notice already acknowledged the sample translates at once; an English reader gets a Spanish sample', async () => {
    const f = fakeApi({ local: { [PRIVACY_KEY]: { version: 1, at: 1 } } });
    await f.api.storage.sync.set({ prefs: { targetLang: 'en', sourceLang: 'auto', style: 'natural' } });
    const { jobs, client } = sampleJobs(f);
    await mount(f, server(), { jobs });
    await toStep3();
    await connectAnthropic();
    expect(t('sample-original')?.textContent).toContain('biblioteca');
    click(t('translate-sample'));
    await waitFor(() => t('sample-translation') !== null);
    expect(t('onboarding-privacy')).toBeNull();
    expect(client.requests.length).toBeGreaterThan(0);
  });

  it('a sample that fails says why and can be tried again', async () => {
    const f = fakeApi({ local: { [PRIVACY_KEY]: { version: 1, at: 1 } } });
    const { jobs } = sampleJobs(f, true);
    await mount(f, server(), { jobs });
    await toStep3();
    await connectAnthropic();
    click(t('translate-sample'));
    await waitFor(() => t('sample-error') !== null);
    expect(t('translate-sample')?.textContent).toBe('Translate again');
    expect(t('onboarding-finish')?.textContent).toBe('Finish without the sample');
  });

  it('can be skipped from any step, and the choice is remembered', async () => {
    const f = fakeApi();
    await mount(f);
    click(t('onboarding-skip'));
    await waitFor(() => t('onboarding-closed') !== null);
    expect(await readOnboarding(f.api)).toBe('skipped');
    expect(f.local.get(ONBOARDING_KEY)).toMatchObject({ status: 'skipped' });
    // No key was saved, no route written.
    expect(f.sync.has('routing')).toBe(false);
  });

  it('Back from the connection form returns to step 2, and the form has no second Cancel', async () => {
    await mount(fakeApi());
    await toStep3();
    expect(t('cancel-connection')).toBeNull();
    click(t('onboarding-back'));
    await waitFor(() => t('onboarding-how') !== null);
  });

  it('can be opened again: a tab on the onboarding page', async () => {
    const f = fakeApi();
    await openOnboarding(f.api);
    expect(f.tabs).toEqual([`chrome-extension://abc${ONBOARDING_PAGE}`]);
    await markOnboarding(f.api, 'done');
    expect(await readOnboarding(f.api)).toBe('done');
  });
});
