import { describe, expect, it } from 'vitest';
import { createAnthropicAdapter } from '@/llm/anthropic';
import { createOpenAIAdapter } from '@/llm/openai';
import { anthropicStream, openaiStream } from '@/llm/testing';
import type { LLMError, Protocol } from '@/llm/types';
import { anthropicBase, connectMessage, corsGuide, endpointBase, fixBaseUrl, OLLAMA_ORIGINS, preferredProtocol, testConnection, type TestInput } from './connect.ts';
import { presetFor, type PresetId } from './presets.ts';

interface Hit {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}
type Reply = { status: number; body: unknown; headers?: Record<string, string> } | { throw: unknown };

/** A fetch that answers by URL, recording every request. */
function server(handler: (hit: Hit) => Reply) {
  const hits: Hit[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const hit: Hit = { url: String(input instanceof Request ? input.url : input), method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined };
    hits.push(hit);
    const reply = handler(hit);
    if ('throw' in reply) throw reply.throw;
    const body = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    return new Response(body, { status: reply.status, headers: reply.headers ?? { 'content-type': 'application/json' } });
  };
  return { fetch: fetch as typeof globalThis.fetch, hits };
}

const openaiList = (...ids: string[]) => ({ status: 200, body: { object: 'list', data: ids.map((id) => ({ id, object: 'model', created: 0, owned_by: 'x' })) } });
const anthropicList = (...ids: string[]) => ({
  status: 200,
  body: { data: ids.map((id) => ({ id, type: 'model', display_name: id, created_at: '2025-01-01T00:00:00Z', max_input_tokens: 200000 })), has_more: false, first_id: ids[0], last_id: ids.at(-1) },
});
const openaiOk = { status: 200, body: openaiStream({ text: ['H'], finish_reason: 'length' }), headers: { 'content-type': 'text/event-stream' } };
const anthropicOk = { status: 200, body: anthropicStream({ text: ['H'], stop_reason: 'max_tokens' }), headers: { 'content-type': 'text/event-stream' } };
const notFound = { status: 404, body: { error: { message: 'Not Found' } } };

function ports(fetch: typeof globalThis.fetch, permission = true) {
  return {
    adapter: (p: Protocol) => (p === 'anthropic-messages' ? createAnthropicAdapter({ fetch }) : createOpenAIAdapter({ fetch })),
    hasHostPermission: async () => permission,
  };
}

function input(presetId: PresetId, over: Partial<TestInput> = {}): TestInput {
  const preset = presetFor(presetId);
  return { preset, protocol: preset.protocol, baseUrl: preset.baseUrl, auth: { style: preset.auth }, ...(preset.auth === 'none' ? {} : { apiKey: 'sk-test-0123456789' }), quirks: preset.quirks, ...over };
}

const path = (url: string) => new URL(url).pathname;

describe('base URL fixer (§4.2.5, plan M4-E6)', () => {
  it('cuts a pasted endpoint path, a doubled /v1 and trailing slashes, and says why', () => {
    expect(fixBaseUrl('https://openrouter.ai/api/v1/chat/completions')).toEqual({
      url: 'https://openrouter.ai/api/v1',
      fixes: [{ reason: 'endpoint', from: 'https://openrouter.ai/api/v1/chat/completions', to: 'https://openrouter.ai/api/v1' }],
    });
    expect(fixBaseUrl(' https://gw.example.com/v1/v1/ ').url).toBe('https://gw.example.com/v1');
    expect(fixBaseUrl('https://gw.example.com/v1/v1').fixes.map((f) => f.reason)).toEqual(['double-v1']);
    expect(fixBaseUrl('https://api.anthropic.com/v1/messages').url).toBe('https://api.anthropic.com/v1');
    expect(fixBaseUrl('http://localhost:11434/v1/models/').url).toBe('http://localhost:11434/v1');
    expect(fixBaseUrl('https://api.openai.com/v1')).toEqual({ url: 'https://api.openai.com/v1', fixes: [] });
    // Not a URL: left for Test connection to call invalid.
    expect(fixBaseUrl('not a url/chat/completions').fixes).toEqual([]);
  });

  it('gives the Anthropic SDK its base without /v1 (it adds its own), the OpenAI one as is', () => {
    expect(anthropicBase('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api');
    expect(endpointBase('anthropic-messages', 'https://api.anthropic.com')).toBe('https://api.anthropic.com');
    expect(endpointBase('openai-chat', 'https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api/v1');
  });

  it('chooses Anthropic Messages for Claude models and OpenAI Chat otherwise (plan M4 §5)', () => {
    expect(preferredProtocol('claude-haiku-4-5')).toBe('anthropic-messages');
    expect(preferredProtocol('anthropic/claude-sonnet-4.6')).toBe('anthropic-messages');
    expect(preferredProtocol('openai/gpt-5-mini')).toBe('openai-chat');
    expect(preferredProtocol(undefined)).toBe('openai-chat');
  });
});

describe('Test connection (plan M4-E5)', () => {
  it('lists models, then sends a 1-token call with the chosen model; success is the status', async () => {
    const s = server((h) => (path(h.url) === '/v1/models' ? anthropicList('claude-haiku-4-5', 'claude-sonnet-4-6') : anthropicOk));
    const result = await testConnection(input('anthropic', { model: 'claude-haiku-4-5' }), ports(s.fetch));
    expect(result).toMatchObject({ ok: true, protocol: 'anthropic-messages', detected: ['anthropic-messages'], baseUrl: 'https://api.anthropic.com', fixes: [] });
    expect(result.ok && result.models.map((m) => m.id)).toEqual(['claude-haiku-4-5', 'claude-sonnet-4-6']);
    expect(result.ok && result.models[0]?.contextWindow).toBe(200000);
    expect(s.hits.map((h) => `${h.method} ${path(h.url)}`)).toEqual(['GET /v1/models', 'POST /v1/messages']);
    expect(s.hits[1]?.body).toMatchObject({ model: 'claude-haiku-4-5', max_tokens: 1 });
    expect(s.hits[0]?.headers['x-api-key']).toBe('sk-test-0123456789');
  });

  it('without a model, checks the key by the listing alone (no chat call) on a preset whose listing needs the key', async () => {
    const s = server(() => openaiList('gpt-5-mini'));
    const result = await testConnection(input('openai', { model: '' }), ports(s.fetch));
    expect(result).toMatchObject({ ok: true, protocol: 'openai-chat' });
    expect(s.hits).toHaveLength(1);
  });

  it('Ollama cloud: the listing is public, so the key is checked with a 1-token chat call (S4)', async () => {
    const s = server((h) => (path(h.url) === '/v1/models' ? openaiList('gpt-oss:120b') : { status: 401, body: { error: 'unauthorized' } }));
    const result = await testConnection(input('ollama-cloud'), ports(s.fetch));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('auth');
    expect(s.hits.map((h) => path(h.url))).toEqual(['/v1/models', '/v1/chat/completions']);
    expect(s.hits[1]?.body).toMatchObject({ model: 'gpt-oss:120b' });
    // With no model listed and none typed, it can't: the result says the key is unchecked.
    const empty = server(() => openaiList());
    expect(await testConnection(input('ollama-cloud'), ports(empty.fetch))).toMatchObject({ ok: true, keyUnchecked: true });
  });

  it('fixes a pasted /chat/completions and tries a missing /v1 on a 404', async () => {
    const s = server((h) => (path(h.url) === '/v1/models' ? openaiList('m1') : notFound));
    const result = await testConnection(input('custom-openai', { baseUrl: 'https://gw.example.com/chat/completions' }), ports(s.fetch));
    expect(result).toMatchObject({ ok: true, baseUrl: 'https://gw.example.com/v1' });
    expect(result.fixes.map((f) => f.reason)).toEqual(['endpoint', 'missing-v1']);
    expect(s.hits.map((h) => path(h.url))).toEqual(['/models', '/v1/models']);
  });

  it('strips /v1 from an Anthropic-compatible base URL (the SDK adds it) and says so', async () => {
    const s = server((h) => (path(h.url) === '/anthropic/v1/models' ? anthropicList('claude-haiku-4-5') : notFound));
    const result = await testConnection(input('custom-anthropic', { baseUrl: 'https://gw.example.com/anthropic/v1' }), ports(s.fetch));
    expect(result).toMatchObject({ ok: true, baseUrl: 'https://gw.example.com/anthropic' });
    expect(result.fixes.map((f) => f.reason)).toEqual(['anthropic-v1']);
  });
});

describe('auto-detect (§4.2.5, plan M4-E6)', () => {
  /** An OpenRouter-style gateway: OpenAI under /api/v1, Anthropic under /api (its /v1/messages). */
  const gateway = (h: Hit): Reply => {
    const p = path(h.url);
    if (p === '/api/v1/models' && h.headers['authorization']) return openaiList('openai/gpt-5-mini', 'anthropic/claude-haiku-4.5');
    if (p === '/api/v1/models' && h.headers['x-api-key']) return anthropicList('anthropic/claude-haiku-4.5');
    if (p === '/api/v1/chat/completions') return openaiOk;
    if (p === '/api/v1/messages') return anthropicOk;
    return notFound;
  };

  it('finds both protocols on a gateway that speaks both, and picks by model family', async () => {
    const s = server(gateway);
    const auto = (model: string) => input('custom-auto', { baseUrl: 'https://openrouter.ai/api/v1/chat/completions', model });
    const gpt = await testConnection(auto('openai/gpt-5-mini'), ports(s.fetch));
    expect(gpt).toMatchObject({ ok: true, detected: ['anthropic-messages', 'openai-chat'], protocol: 'openai-chat', baseUrl: 'https://openrouter.ai/api/v1' });
    expect(gpt.fixes.map((f) => f.reason)).toEqual(['endpoint']);
    const claude = await testConnection(auto('anthropic/claude-haiku-4.5'), ports(s.fetch));
    expect(claude).toMatchObject({ ok: true, detected: ['anthropic-messages', 'openai-chat'], protocol: 'anthropic-messages', baseUrl: 'https://openrouter.ai/api/v1' });
  });

  it('keeps only the protocol whose test call succeeds', async () => {
    const s = server((h) => {
      const p = path(h.url);
      if (p === '/v1/models') return h.headers['x-api-key'] ? anthropicList('claude-x') : openaiList('llama');
      if (p === '/v1/chat/completions') return openaiOk;
      return notFound;
    });
    const result = await testConnection(input('custom-auto', { baseUrl: 'https://llm.example.com/v1' }), ports(s.fetch));
    expect(result).toMatchObject({ ok: true, detected: ['openai-chat'], protocol: 'openai-chat' });
  });

  it('reports the failure that got furthest when neither works', async () => {
    const s = server((h) => (path(h.url).endsWith('/models') && h.headers['authorization'] ? openaiList('m') : path(h.url).endsWith('/chat/completions') ? { status: 401, body: { error: { message: 'bad key' } } } : notFound));
    const result = await testConnection(input('custom-auto', { baseUrl: 'https://llm.example.com/v1' }), ports(s.fetch));
    expect(result).toMatchObject({ ok: false, protocol: 'openai-chat' });
    expect(!result.ok && result.error.kind).toBe('auth');
  });
});

describe('Test connection messages (plan M4 §3 #5: 4 of 4)', () => {
  const message = async (presetId: PresetId, handler: (h: Hit) => Reply, over: Partial<TestInput> = {}, permission = true) => {
    const s = server(handler);
    const i = input(presetId, over);
    const result = await testConnection(i, ports(s.fetch, permission));
    if (result.ok) throw new Error('expected a failure');
    return { error: result.error, ...connectMessage(result.error, { preset: i.preset, baseUrl: result.baseUrl, model: i.model }) };
  };

  it('bad key → "Key invalid" with Fix key', async () => {
    const m = await message('anthropic', () => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }));
    expect(m).toMatchObject({ status: 'Key invalid', action: 'fix-key' });
    expect(m.text).toContain('rejected this key');
  });

  it('CORS / origin blocked: Ollama 403 with auth none on localhost → "CORS blocked" and the guide, not Fix key (S4 rule)', async () => {
    const m = await message('ollama', () => ({ status: 403, body: '', headers: { 'content-type': 'text/plain' } }));
    expect(m.error).toMatchObject({ kind: 'cors', cause: 'origin', status: 403 });
    expect(m).toMatchObject({ status: 'CORS blocked', action: 'cors-guide' });
    expect(m.text).toContain('Ollama refused requests');
    // The same 403 from a cloud host with a key is a key problem.
    const cloud = await message('openai', () => ({ status: 403, body: { error: { message: 'forbidden' } } }));
    expect(cloud.status).toBe('Key invalid');
  });

  it('CORS / no host permission: a fetch TypeError without the permission → "No access" with Grant access', async () => {
    const m = await message('openai', () => ({ throw: new TypeError('Failed to fetch') }), {}, false);
    expect(m).toMatchObject({ status: 'No access', action: 'grant' });
    expect(m.text).toContain('api.openai.com');
  });

  it('model not found → "Model not found"; on Ollama "Model not pulled" with the ollama pull command', async () => {
    const m = await message('openai', (h) => (path(h.url) === '/v1/models' ? openaiList('gpt-5-mini') : { status: 404, body: { error: { message: 'The model `gpt-9` does not exist or you do not have access to it.', code: 'model_not_found' } } }), {
      model: 'gpt-9',
    });
    expect(m).toMatchObject({ status: 'Model not found' });
    expect(m.text).toContain('gpt-9');
    const ollama = await message('ollama', (h) => (path(h.url) === '/v1/models' ? openaiList('llama3.2') : { status: 404, body: { error: { message: 'model "qwen3:8b" not found, try pulling it first' } } }), { model: 'qwen3:8b' });
    expect(ollama).toMatchObject({ status: 'Model not pulled', action: 'command', command: 'ollama pull qwen3:8b' });
  });

  it('wrong base URL → "Wrong base URL"', async () => {
    const m = await message('custom-openai', () => notFound, { baseUrl: 'https://gw.example.com/llm/v1' });
    expect(m.error).toMatchObject({ kind: 'bad_request', status: 404 });
    expect(m.status).toBe('Wrong base URL');
    expect(m.text).toContain('https://gw.example.com/llm/v1');
    expect(connectMessage(m.error, { preset: presetFor('gemini'), baseUrl: 'https://x.example/v1', suggestion: 'https://y.example/v1' })).toMatchObject({ action: 'use-url', suggestion: 'https://y.example/v1' });
  });

  it('an invalid base URL is said before any request', async () => {
    const s = server(() => notFound);
    const result = await testConnection(input('custom-openai', { baseUrl: 'ftp://x' }), ports(s.fetch));
    expect(s.hits).toHaveLength(0);
    expect(!result.ok && connectMessage(result.error, { preset: presetFor('custom-openai'), baseUrl: 'ftp://x' }).status).toBe('Invalid base URL');
  });

  it('local server down → "Not running" with how to start it', () => {
    const network: LLMError = { kind: 'network', message: "Can't reach localhost:11434" };
    expect(connectMessage(network, { preset: presetFor('ollama'), baseUrl: 'http://localhost:11434/v1' })).toMatchObject({ status: 'Not running', command: 'ollama serve' });
    expect(connectMessage(network, { preset: presetFor('lmstudio'), baseUrl: 'http://localhost:1234/v1' }).text).toContain('start the server');
    expect(connectMessage(network, { preset: presetFor('openai'), baseUrl: 'https://api.openai.com/v1' }).status).toBe('Not reachable');
    expect(connectMessage({ kind: 'auth', message: '' }, { preset: presetFor('openai'), baseUrl: 'https://api.openai.com/v1', noKey: true }).status).toBe('No key');
  });
});

describe('local-server guides (§4.3.6, plan M4-E12)', () => {
  it('gives the exact OLLAMA_ORIGINS command for macOS, Windows and Linux', () => {
    const g = corsGuide('ollama');
    expect(g.steps.map((s) => s.os)).toEqual(['macOS', 'Windows', 'Linux']);
    expect(OLLAMA_ORIGINS).toBe('chrome-extension://*');
    expect(g.steps[0]?.command).toBe('launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"');
    expect(g.steps[1]?.command).toBe('setx OLLAMA_ORIGINS "chrome-extension://*"');
    expect(g.steps[2]?.command).toContain('Environment="OLLAMA_ORIGINS=chrome-extension://*"');
    expect(g.steps[2]?.command).toContain('systemctl restart ollama');
  });

  it('tells LM Studio users to turn on CORS in the server settings', () => {
    expect(corsGuide('lmstudio').steps[0]?.text).toContain('Enable CORS');
  });
});
