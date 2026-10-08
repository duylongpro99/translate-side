// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAnthropicAdapter } from '@/llm/anthropic';
import { createOpenAIAdapter } from '@/llm/openai';
import { anthropicStream, openaiStream } from '@/llm/testing';
import type { Protocol } from '@/llm/types';
import { ProvidersSection } from './Providers.tsx';

type Api = Parameters<typeof ProvidersSection>[0]['api'];

/** chrome.storage and chrome.permissions as the options page uses them; `log` records writes and permission calls in order. */
function fakeApi({ sync = {}, local = {}, granted = [] as string[], grant = true } = {} as { sync?: Record<string, unknown>; local?: Record<string, unknown>; granted?: string[]; grant?: boolean }) {
  const log: string[] = [];
  const perms = new Set(granted);
  const area = (name: string, init: Record<string, unknown>) => {
    const m = new Map(Object.entries(structuredClone(init)));
    const listeners = new Set<(c: Record<string, unknown>) => void>();
    const fire = (keys: string[]) => listeners.forEach((l) => l(Object.fromEntries(keys.map((k) => [k, {}]))));
    return {
      m,
      get: (k: string | string[] | null) => {
        const list = k === null ? [...m.keys()] : typeof k === 'string' ? [k] : k;
        return Promise.resolve(structuredClone(Object.fromEntries(list.filter((x) => m.has(x)).map((x) => [x, m.get(x)]))));
      },
      set: (o: Record<string, unknown>) => {
        log.push(`${name}.set ${Object.keys(o).join(',')}`);
        for (const [k, v] of Object.entries(structuredClone(o))) m.set(k, v);
        fire(Object.keys(o));
        return Promise.resolve();
      },
      remove: (k: string | string[]) => {
        const keys = typeof k === 'string' ? [k] : k;
        log.push(`${name}.remove ${keys.join(',')}`);
        keys.forEach((x) => m.delete(x));
        fire(keys);
        return Promise.resolve();
      },
      onChanged: { addListener: (l: (c: Record<string, unknown>) => void) => listeners.add(l), removeListener: (l: (c: Record<string, unknown>) => void) => listeners.delete(l) },
    };
  };
  const s = area('sync', sync);
  const l = area('local', local);
  const api = {
    storage: { sync: s, local: l, session: area('session', {}) },
    permissions: {
      contains: ({ origins }: { origins: string[] }) => Promise.resolve(origins.every((o) => perms.has(o))),
      request: ({ origins }: { origins: string[] }) => {
        log.push(`request ${origins.join(',')}`);
        if (grant) origins.forEach((o) => perms.add(o));
        return Promise.resolve(grant);
      },
      remove: ({ origins }: { origins: string[] }) => {
        log.push(`revoke ${origins.join(',')}`);
        return Promise.resolve(origins.every((o) => perms.delete(o)));
      },
    },
  } as unknown as Api;
  return { api, sync: s.m, local: l.m, log, perms };
}

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
/** A provider by URL path; `handler` can be swapped mid-test (Ollama fixed while the guide is open). */
function server(handler: (path: string, headers: Record<string, string>, body: unknown) => Reply) {
  const s = { handler, hits: [] as string[] };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    s.hits.push(`${init?.method ?? 'GET'} ${url.host}${url.pathname}`);
    const r = s.handler(url.pathname, headers, typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status, headers: r.headers ?? { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  const adapterFor = (p: Protocol) => (p === 'anthropic-messages' ? createAnthropicAdapter({ fetch }) : createOpenAIAdapter({ fetch }));
  return Object.assign(s, { adapterFor });
}

const anthropicList = { status: 200, body: { data: ['claude-haiku-4-5', 'claude-sonnet-4-6'].map((id) => ({ id, type: 'model', display_name: id, created_at: '2025-01-01T00:00:00Z', max_input_tokens: 200000 })), has_more: false } };
const anthropicOk = { status: 200, body: anthropicStream({ text: ['H'], stop_reason: 'max_tokens' }), headers: { 'content-type': 'text/event-stream' } };
const openaiList = (...ids: string[]) => ({ status: 200, body: { object: 'list', data: ids.map((id) => ({ id, object: 'model', created: 0, owned_by: 'x' })) } });
const openaiOk = { status: 200, body: openaiStream({ text: ['H'], finish_reason: 'length' }), headers: { 'content-type': 'text/event-stream' } };

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
const $$ = (sel: string) => [...root.querySelectorAll(sel)];
const click = (el: Element | null) => act(() => void (el as HTMLElement).click());
const type = (sel: string, value: string) =>
  act(() => {
    const el = $<HTMLInputElement>(sel);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const byText = (sel: string, text: string) => $$(sel).find((e) => e.textContent?.trim() === text) ?? null;
const submit = () => act(() => void $('[data-testid=connection-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const rowOf = (label: string) => $$('[data-testid=connection-row]').find((r) => r.querySelector('.prov__name')?.textContent === label);

async function mount(f: ReturnType<typeof fakeApi>, srv: ReturnType<typeof server>, retestMs = 3000) {
  act(() => render(<ProvidersSection api={f.api} adapterFor={srv.adapterFor} retestMs={retestMs} />, root));
  await waitFor(() => $('[data-testid=connections]') !== null);
}

async function startAdd(presetId: string) {
  click($('[data-testid=add-connection]'));
  click($(`[data-preset=${presetId}]`));
  await flush();
}

describe('Settings ▸ Providers (DESIGN §4.3.3 A)', () => {
  it('lists connections, models and routing; a keyless built-in says so and has nothing to remove (carry-over B2)', async () => {
    const f = fakeApi({ sync: { schemaVersion: 1 } });
    await mount(f, server(() => openaiList()));
    expect($('[data-testid=models]')).not.toBeNull();
    expect($('[data-testid=routing]')).not.toBeNull();
    // Only the routed built-in shows: keyless Gemini and Anthropic are hidden.
    expect($$('[data-testid=connection-row]').map((r) => r.getAttribute('data-id'))).toEqual(['apibox']);
    expect(rowOf('APIBOX')?.querySelector('[data-testid=connection-status]')?.textContent).toBe('Built-in, no key');
    expect(rowOf('APIBOX')?.querySelector('[data-testid=remove-connection]')).toBeNull();
    // Carry-over B1: the analyze role is "Document brief".
    expect($('label[for=route-analyze]').textContent).toBe('Document brief');
    expect($<HTMLSelectElement>('#route-analyze').value).toBe('');
    expect(root.textContent).toContain('Same as translate');
    expect(root.textContent).toContain('never synced');
  });

  it('add flow: preset → key → Test connection (asks for that origin only, first in the click) → discovered model → save; the first one becomes the translate route', async () => {
    const f = fakeApi({ sync: { schemaVersion: 1 } });
    const srv = server((path) => (path === '/v1/models' ? anthropicList : anthropicOk));
    await mount(f, srv);
    await startAdd('anthropic');
    // A cloud preset: the base URL is under Advanced only.
    expect($$('#c-base').map((e) => e.closest('[data-testid=advanced]') !== null)).toEqual([true]);
    expect($('#c-format')).toBeNull();
    expect($<HTMLInputElement>('#c-key').type).toBe('password');
    expect(root.textContent).toContain('Get a key ↗');
    type('#c-key', ' sk-ant-api03-0123456789abcd ');
    const before = f.log.length;
    click($('[data-testid=test-connection]'));
    expect(f.log[before]).toBe('request https://api.anthropic.com/*');
    await waitFor(() => $('[data-testid=test-result]') !== null);
    expect($('[data-testid=test-result]').textContent).toContain('✓ Connected');
    expect($('[data-testid=test-result]').textContent).toContain('2 models');
    expect($$('[data-testid=model-list] option').map((o) => (o as HTMLOptionElement).value)).toEqual(['claude-haiku-4-5', 'claude-sonnet-4-6']);
    expect($<HTMLInputElement>('#c-model').value).toBe('claude-haiku-4-5');
    expect($('[data-testid=model-context]').textContent).toContain('200,000 tokens');
    expect(srv.hits).toEqual(['GET api.anthropic.com/v1/models', 'POST api.anthropic.com/v1/messages']);
    type('#c-model', 'claude-sonnet-4-6');
    submit();
    await waitFor(() => $('[data-testid=providers-note]') !== null);
    expect($('[data-testid=providers-note]').textContent).toContain('Pages now translate with claude-sonnet-4-6');
    const conn = [...f.sync.entries()].find(([k, v]) => k.startsWith('conn:') && (v as { presetId: string }).presetId === 'anthropic')?.[1] as { id: string; status: string };
    expect(conn.status).toBe('ok');
    expect(f.local.get(`secret:${conn.id}`)).toBe('sk-ant-api03-0123456789abcd');
    const profile = [...f.sync.values()].find((v) => (v as { model?: string }).model === 'claude-sonnet-4-6') as { id: string; maxConcurrency: number; contextWindow: number };
    expect(profile).toMatchObject({ maxConcurrency: 2, contextWindow: 200000 });
    expect(f.sync.get('routing')).toEqual({ translate: profile.id });
    expect(JSON.stringify([...f.sync.values()])).not.toContain('sk-ant');
    await waitFor(() => rowOf('Anthropic (Claude)') !== undefined);
    expect(rowOf('Anthropic (Claude)')?.querySelector('[data-testid=connection-status]')?.textContent).toBe('✓ Connected');
    expect($$('[data-testid=model-row]').find((r) => r.textContent?.includes('claude-sonnet-4-6'))?.textContent).toContain('Translate');
  });

  it('a bad key: "Key invalid" with Fix key, which focuses the key field', async () => {
    const f = fakeApi({ sync: { schemaVersion: 1 } });
    await mount(f, server(() => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } })));
    await startAdd('anthropic');
    type('#c-key', 'sk-bad-0123456789');
    click($('[data-testid=test-connection]'));
    await waitFor(() => $('[data-testid=test-status]') !== null);
    expect($('[data-testid=test-status]').textContent).toBe('Key invalid');
    click($('[data-testid=fix-key]'));
    expect(document.activeElement).toBe($('#c-key'));
  });

  it('Custom on Auto-detect: a pasted /chat/completions is fixed, both protocols are found, and the profile gets the switch', async () => {
    const f = fakeApi({ sync: { schemaVersion: 1 } });
    const srv = server((path, headers) => {
      if (path === '/api/v1/models') return headers['x-api-key'] || headers['anthropic-version'] ? { ...anthropicList, body: { ...anthropicList.body, data: [{ ...anthropicList.body.data[0], id: 'anthropic/claude-haiku-4.5' }] } } : openaiList('openai/gpt-5-mini', 'anthropic/claude-haiku-4.5');
      if (path === '/api/v1/chat/completions') return openaiOk;
      if (path === '/api/v1/messages') return anthropicOk;
      return { status: 404, body: { error: { message: 'Not Found' } } };
    });
    await mount(f, srv);
    await startAdd('custom-auto');
    expect($<HTMLSelectElement>('#c-format').value).toBe('auto');
    type('#c-label', 'OpenRouter both');
    type('#c-base', 'https://openrouter.ai/api/v1/chat/completions');
    type('#c-key', 'sk-or-0123456789');
    type('#c-model', 'anthropic/claude-haiku-4.5');
    click($('[data-testid=test-connection]'));
    expect(f.log.at(-1)).toBe('request https://openrouter.ai/*');
    await waitFor(() => $('[data-testid=test-result]') !== null);
    const result = $('[data-testid=test-result]').textContent ?? '';
    expect(result).toContain('Anthropic-compatible and OpenAI-compatible detected; using Anthropic-compatible');
    expect($('[data-testid=url-fixes]').textContent).toContain('https://openrouter.ai/api/v1');
    expect($('[data-testid=protocol-switch]').textContent).toContain('little');
    submit();
    await waitFor(() => $('[data-testid=providers-note]') !== null);
    const conn = [...f.sync.values()].find((v) => (v as { label?: string }).label === 'OpenRouter both') as { baseUrl: string; protocol: string; detectedProtocols: string[] };
    expect(conn).toMatchObject({ baseUrl: 'https://openrouter.ai/api/v1', protocol: 'auto', detectedProtocols: ['anthropic-messages', 'openai-chat'] });
    expect([...f.sync.values()].find((v) => (v as { model?: string }).model === 'anthropic/claude-haiku-4.5')).toMatchObject({ protocolOverride: 'anthropic-messages' });
  });

  it('Ollama with CORS blocked: "CORS blocked" and the Fix… guide (not Fix key); the test re-runs by itself and closes the guide once Ollama allows the origin', async () => {
    const f = fakeApi({ sync: { schemaVersion: 1 } });
    const srv = server(() => ({ status: 403, body: '', headers: { 'content-type': 'text/plain' } }));
    await mount(f, srv, 40);
    await startAdd('ollama');
    expect($('#c-key')).toBeNull();
    expect($<HTMLInputElement>('#c-base').value).toBe('http://localhost:11434/v1');
    click($('[data-testid=test-connection]'));
    expect(f.log.at(-1)).toBe('request http://localhost/*');
    await waitFor(() => $('[data-testid=test-status]') !== null);
    expect($('[data-testid=test-status]').textContent).toBe('CORS blocked');
    expect($('[data-testid=fix-key]')).toBeNull();
    expect($('[data-testid=cors-guide]')).not.toBeNull();
    for (const os of ['macOS', 'Windows', 'Linux']) {
      click(byText('[role=tab]', os));
      expect($('[data-testid=cors-guide] code').textContent).toContain('OLLAMA_ORIGINS');
    }
    expect($('[data-testid=retest-note]')).not.toBeNull();
    srv.handler = (path) => (path === '/v1/models' ? openaiList('qwen3:8b', 'gemma3:12b') : openaiOk);
    await waitFor(() => $('[data-testid=test-result]')?.textContent?.includes('✓ Connected') === true);
    expect($('[data-testid=cors-guide]')).toBeNull();
    submit();
    await waitFor(() => $('[data-testid=providers-note]') !== null);
    expect([...f.sync.values()].find((v) => (v as { model?: string }).model === 'qwen3:8b')).toMatchObject({ maxConcurrency: 1, chunkTokens: 600 });
  });

  it('a saved Ollama connection that is CORS blocked shows the status and Fix… in the list', async () => {
    const conn = { id: 'o1', label: 'Home Ollama', presetId: 'ollama', protocol: 'openai-chat', baseUrl: 'http://localhost:11434/v1', auth: { style: 'none' }, quirks: {}, status: 'error', lastError: 'CORS blocked', lastErrorKind: 'cors-origin' };
    const f = fakeApi({ sync: { schemaVersion: 1, 'conn:o1': conn } });
    await mount(f, server(() => ({ status: 403, body: '' })));
    const row = rowOf('Home Ollama') as Element;
    expect(row.querySelector('[data-testid=connection-status]')?.textContent).toBe('⚠ CORS blocked');
    expect(row.textContent).toContain('localhost:11434');
    click(row.querySelector('[data-testid=fix-cors]'));
    await flush();
    expect($('[data-testid=cors-guide]')).not.toBeNull();
  });

  it('a model Ollama has not pulled: "Model not pulled" with the ollama pull command', async () => {
    const f = fakeApi({ sync: { schemaVersion: 1 } });
    await mount(f, server((path) => (path === '/v1/models' ? openaiList('llama3.2') : { status: 404, body: { error: { message: 'model "qwen3:8b" not found, try pulling it first' } } })));
    await startAdd('ollama');
    click($('[data-testid=test-connection]'));
    await waitFor(() => $('[data-testid=test-status]') !== null);
    expect($('[data-testid=test-status]').textContent).toBe('Model not pulled');
    expect($('[data-testid=command]').textContent).toBe('ollama pull qwen3:8b');
  });

  it('a wrong base URL says so', async () => {
    const f = fakeApi({ sync: { schemaVersion: 1 } });
    await mount(f, server(() => ({ status: 404, body: { error: { message: 'Not Found' } } })));
    await startAdd('custom-openai');
    type('#c-base', 'https://gw.example.com/llm/v1');
    type('#c-key', 'k-0123456789');
    click($('[data-testid=test-connection]'));
    await waitFor(() => $('[data-testid=test-status]') !== null);
    expect($('[data-testid=test-status]').textContent).toBe('Wrong base URL');
  });

  it('editing shows that connection’s own saved key, masked (carry-over B3)', async () => {
    const conn = { id: 'c9', label: 'Work gateway', presetId: 'custom-openai', protocol: 'openai-chat', baseUrl: 'https://gw.example.com/v1', auth: { style: 'bearer' }, quirks: {}, status: 'ok' };
    const f = fakeApi({ sync: { schemaVersion: 1, 'conn:c9': conn }, local: { 'secret:c9': 'sk-work-0123456789wxyz', 'secret:apibox': 'sk-apibox-0123456789' } });
    await mount(f, server(() => openaiList()));
    click(rowOf('Work gateway')?.querySelector('[aria-label="Edit Work gateway"]') ?? null);
    await waitFor(() => $<HTMLInputElement>('#c-key')?.placeholder.includes('Saved') === true);
    expect($<HTMLInputElement>('#c-key').placeholder).toContain('sk-…wxyz');
    expect(root.innerHTML).not.toContain('sk-work-0123456789wxyz');
  });

  it('removing a connection deletes its key and revokes its host permission (plan M4 §3 #8)', async () => {
    const conn = { id: 'c9', label: 'Work gateway', presetId: 'custom-openai', protocol: 'openai-chat', baseUrl: 'https://gw.example.com/v1', auth: { style: 'bearer' }, quirks: {}, status: 'ok' };
    const prof = { id: 'p9', connectionId: 'c9', model: 'm', maxConcurrency: 2, chunkTokens: 1200 };
    const f = fakeApi({ sync: { schemaVersion: 1, 'conn:c9': conn, 'profile:p9': prof }, local: { 'secret:c9': 'sk-work-0123456789' }, granted: ['https://gw.example.com/*'] });
    await mount(f, server(() => openaiList()));
    click(rowOf('Work gateway')?.querySelector('[data-testid=remove-connection]') ?? null);
    expect($('[data-testid=confirm-remove]').textContent).toContain('its models and its key');
    click($('[data-testid=confirm-remove-yes]'));
    await waitFor(() => rowOf('Work gateway') === undefined);
    expect(f.local.has('secret:c9')).toBe(false);
    expect(f.sync.has('conn:c9') || f.sync.has('profile:p9')).toBe(false);
    expect(f.log).toContain('revoke https://gw.example.com/*');
    expect(f.perms.has('https://gw.example.com/*')).toBe(false);
    expect($('[data-testid=providers-note]').textContent).toBe('Removed Work gateway, its key and access to gw.example.com.');
  });

  it('removing a built-in with a key: its key goes, and it stays listed as built in without one when routed', async () => {
    const f = fakeApi({ sync: { schemaVersion: 1 }, local: { 'secret:apibox': 'sk-apibox-0123456789' }, granted: ['https://api.ai-box.vn/*'] });
    await mount(f, server(() => openaiList()));
    expect(rowOf('APIBOX')?.querySelector('[data-testid=connection-status]')?.textContent).toBe('Built-in · key saved');
    click(rowOf('APIBOX')?.querySelector('[data-testid=remove-connection]') ?? null);
    click($('[data-testid=confirm-remove-yes]'));
    await waitFor(() => rowOf('APIBOX')?.querySelector('[data-testid=connection-status]')?.textContent === 'Built-in, no key');
    expect(f.local.has('secret:apibox')).toBe(false);
    expect(f.perms.has('https://api.ai-box.vn/*')).toBe(false);
    expect($('[data-testid=providers-note]').textContent).toContain('It is built in, so it stays available without a key.');
  });

  it('routing: choosing the Document brief model saves it', async () => {
    const conn = { id: 'o1', label: 'Home Ollama', presetId: 'ollama', protocol: 'openai-chat', baseUrl: 'http://localhost:11434/v1', auth: { style: 'none' }, quirks: {}, status: 'ok' };
    const f = fakeApi({ sync: { schemaVersion: 1, 'conn:o1': conn, 'profile:q': { id: 'q', connectionId: 'o1', model: 'qwen3:8b', maxConcurrency: 1, chunkTokens: 600 } } });
    await mount(f, server(() => openaiList()));
    expect($$('[data-testid=model-row]').find((r) => r.textContent?.includes('qwen3:8b'))?.textContent).toContain('free · local');
    act(() => {
      const sel = $<HTMLSelectElement>('#route-analyze');
      sel.value = 'q';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => f.sync.has('routing'));
    expect(f.sync.get('routing')).toEqual({ translate: 'apibox-qwen3.8-flash', analyze: 'q' });
    expect($('[data-testid=providers-note]').textContent).toBe('Document brief route saved.');
  });
});
