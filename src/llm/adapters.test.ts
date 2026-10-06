import { describe, expect, it } from 'vitest';
import { DEFAULT_RETRY_POLICY, withRetry } from '../engine/retry.ts';
import { fakeSleep } from '../engine/testing.ts';
import { createAnthropicAdapter } from './anthropic.ts';
import { bindClient, createAdapter, createClient } from './client.ts';
import { createOpenAIAdapter } from './openai.ts';
import { anthropicStream, connection, mockFetch, openaiStream, sse, withOverrides, type Overrides, type ScriptedResponse } from './testing.ts';
import type { LLMClient, NormalizedEvent, NormalizedRequest, ProtocolAdapter, ResolvedConnection } from './types.ts';

const ANTHROPIC = 'https://api.anthropic.com';
const OPENAI = 'https://api.example.com/v1';

function request(model: string, over: Overrides<NormalizedRequest> = {}): NormalizedRequest {
  return withOverrides<NormalizedRequest>(
    {
      model,
      system: 'You translate.',
      messages: [{ role: 'user', content: '<seg id="1">Hello</seg>' }],
      maxOutputTokens: 64,
      temperature: 0.2,
      cacheHint: 'system',
      signal: new AbortController().signal,
    },
    over,
  );
}

async function collect(stream: AsyncIterable<NormalizedEvent>): Promise<NormalizedEvent[]> {
  const out: NormalizedEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const text = (events: NormalizedEvent[]): string => events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
const types = (events: NormalizedEvent[]): string[] => events.map((e) => e.type);

interface Harness {
  name: string;
  adapter: (fetch: typeof globalThis.fetch) => ProtocolAdapter;
  conn: (over?: Overrides<ResolvedConnection>) => ResolvedConnection;
  ok: (text: string[]) => ScriptedResponse;
  model: string;
}

const harnesses: Harness[] = [
  {
    name: 'anthropic-messages',
    adapter: (fetch) => createAnthropicAdapter({ fetch }),
    conn: (over) => connection({ protocol: 'anthropic-messages', baseUrl: ANTHROPIC, auth: { style: 'x-api-key' }, ...over }),
    ok: (t) => ({ status: 200, body: anthropicStream({ text: t }) }),
    model: 'claude-haiku-4-5',
  },
  {
    name: 'openai-chat',
    adapter: (fetch) => createOpenAIAdapter({ fetch }),
    conn: (over) => connection({ protocol: 'openai-chat', baseUrl: OPENAI, auth: { style: 'bearer' }, ...over }),
    ok: (t) => ({ status: 200, body: openaiStream({ text: t }) }),
    model: 'gemini-2.5-flash-lite',
  },
];

const RATE_LIMITED: ScriptedResponse = { status: 429, body: '{"error":{"message":"rate limited","type":"rate_limit_error"}}', headers: { 'content-type': 'application/json', 'retry-after': '2' } };

describe.each(harnesses)('$name adapter (shared contract)', (h) => {
  it('streams text, then one usage, then done (criterion: contract order)', async () => {
    const f = mockFetch([h.ok(['Xin ', 'chào'])]);
    const events = await collect(h.adapter(f.fetch).stream(h.conn(), request(h.model)));
    expect(text(events)).toBe('Xin chào');
    expect(types(events)).toEqual(['text', 'text', 'usage', 'done']);
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end' });
    expect(events.at(-2)).toMatchObject({ type: 'usage', input: 10, output: 5 });
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]?.method).toBe('POST');
  });

  it('criterion 7: one 429 = exactly one HTTP attempt per stream() call (SDK maxRetries 0), yielded as one error event', async () => {
    const f = mockFetch([RATE_LIMITED]);
    const adapter = h.adapter(f.fetch);
    const events = await collect(adapter.stream(h.conn(), request(h.model)));
    expect(events).toEqual([{ type: 'error', error: expect.objectContaining({ kind: 'rate_limit', status: 429, retryAfterMs: 2000 }) }]);
    expect(f.requests).toHaveLength(1);
    await collect(adapter.stream(h.conn(), request(h.model)));
    expect(f.requests).toHaveLength(2);
  });

  it('criterion 7: with the pipeline retry on top, attempts = 1 + maxRetries, all from the pipeline', async () => {
    const f = mockFetch([RATE_LIMITED]);
    const client = bindClient(h.adapter(f.fetch), h.conn(), h.model);
    const sleep = fakeSleep();
    const retrying = withRetry(client, { sleep, policy: { ...DEFAULT_RETRY_POLICY, maxRetries: 3 } });
    const events = await collect(retrying.stream(request(h.model)));
    expect(events).toEqual([{ type: 'error', error: expect.objectContaining({ kind: 'rate_limit' }) }]);
    expect(f.requests).toHaveLength(4);
    expect(sleep.delays).toEqual([2000, 2000, 2000]);
    // And the rate limit clears: the pipeline's retry gets the text.
    const g = mockFetch([RATE_LIMITED, h.ok(['ok'])]);
    const again = withRetry(bindClient(h.adapter(g.fetch), h.conn(), h.model), { sleep: fakeSleep() });
    expect(text(await collect(again.stream(request(h.model))))).toBe('ok');
    expect(g.requests).toHaveLength(2);
  });

  it('a cancel throws signal.reason and is never an error event', async () => {
    const f = mockFetch([{ hang: true }]);
    const controller = new AbortController();
    const reason = new Error('user cancelled');
    const stream = h.adapter(f.fetch).stream(h.conn(), request(h.model, { signal: controller.signal }));
    const it = stream[Symbol.asyncIterator]();
    const pending = it.next();
    await new Promise((r) => setTimeout(r, 20));
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('an aborted signal before the call throws at once, with no request', async () => {
    const f = mockFetch([h.ok(['x'])]);
    const controller = new AbortController();
    controller.abort(new Error('early'));
    await expect(collect(h.adapter(f.fetch).stream(h.conn(), request(h.model, { signal: controller.signal })))).rejects.toThrow('early');
    expect(f.requests).toHaveLength(0);
  });

  it('S4 rows 0a/0b before any request: bad base URL, unsendable key, missing key', async () => {
    const f = mockFetch([h.ok(['x'])]);
    const adapter = h.adapter(f.fetch);
    expect(await collect(adapter.stream(h.conn({ baseUrl: 'ftp://x' }), request(h.model)))).toEqual([{ type: 'error', error: { kind: 'bad_request', message: 'Invalid base URL' } }]);
    expect(await collect(adapter.stream(h.conn({ apiKey: 'sk-—' }), request(h.model)))).toMatchObject([{ type: 'error', error: { kind: 'auth' } }]);
    expect(await collect(adapter.stream(h.conn({ apiKey: undefined }), request(h.model)))).toMatchObject([{ type: 'error', error: { kind: 'auth' } }]);
    expect(f.requests).toHaveLength(0);
  });

  it('S4 rows 1–2: a fetch TypeError is cors/permission without the host permission, network with it', async () => {
    const boom = (): ScriptedResponse => ({ throw: new TypeError('Failed to fetch') });
    const a = await collect(h.adapter(mockFetch([boom()]).fetch).stream(h.conn({ hasHostPermission: async () => false }), request(h.model)));
    expect(a).toMatchObject([{ type: 'error', error: { kind: 'cors', cause: 'permission' } }]);
    const b = await collect(h.adapter(mockFetch([boom()]).fetch).stream(h.conn(), request(h.model)));
    expect(b).toMatchObject([{ type: 'error', error: { kind: 'network' } }]);
  });

  it('S4 open item: a non-JSON error body reaches the classifier as text', async () => {
    const html = { status: 404, body: '<html><body>404 page not found</body></html>', headers: { 'content-type': 'text/html' } };
    const a = await collect(h.adapter(mockFetch([html]).fetch).stream(h.conn(), request(h.model)));
    expect(a).toMatchObject([{ type: 'error', error: { kind: 'bad_request', status: 404, message: 'Wrong base URL (<html><body>404 page not found</body></html>)' } }]);
    const gateway = { status: 502, body: 'Bad Gateway', headers: { 'content-type': 'text/plain' } };
    const b = await collect(h.adapter(mockFetch([gateway]).fetch).stream(h.conn(), request(h.model)));
    expect(b).toMatchObject([{ type: 'error', error: { kind: 'overloaded', status: 502, message: 'Bad Gateway' } }]);
    // Ollama's model 404: a JSON body labelled text/html is still parsed (S4: never match on content-type).
    const ollama = { status: 404, body: '{"error":{"message":"model \\"no-such-model:1b\\" not found","type":"not_found_error","param":null,"code":null}}', headers: { 'content-type': 'text/html' } };
    const c = await collect(h.adapter(mockFetch([ollama]).fetch).stream(h.conn(), request(h.model)));
    expect(c).toMatchObject([{ type: 'error', error: { kind: 'model_not_found', status: 404 } }]);
  });

  it('401 → auth, 402 → quota, 5xx → overloaded with Retry-After', async () => {
    const run = (r: ScriptedResponse): Promise<NormalizedEvent[]> => collect(h.adapter(mockFetch([r]).fetch).stream(h.conn(), request(h.model)));
    expect(await run({ status: 401, body: '{"error":{"message":"Unauthorized","type":"authentication_error"}}' })).toMatchObject([{ type: 'error', error: { kind: 'auth' } }]);
    expect(await run({ status: 402, body: '{"error":"This model is not in the Free plan"}' })).toMatchObject([{ type: 'error', error: { kind: 'quota', message: 'This model is not in the Free plan' } }]);
    expect(await run({ status: 529, body: '{"error":{"type":"overloaded_error","message":"Overloaded"}}', headers: { 'content-type': 'application/json', 'retry-after': '5' } })).toMatchObject([
      { type: 'error', error: { kind: 'overloaded', retryAfterMs: 5000 } },
    ]);
  });

  it('a 429 never triggers the quirk flip: still one attempt', async () => {
    const f = mockFetch([{ status: 429, body: '{"error":{"message":"temperature rate limited","type":"rate_limit_error"}}' }]);
    const conn = h.conn({ quirks: { supportsTemperature: true } });
    await collect(h.adapter(f.fetch).stream(conn, request(h.model)));
    expect(f.requests).toHaveLength(1);
    expect(conn.quirks.supportsTemperature).toBe(true);
  });

  it('§4.2.4: a 400 naming temperature flips the quirk and resends once; a second 400 is an error', async () => {
    const bad: ScriptedResponse = { status: 400, body: '{"error":{"message":"temperature is not supported with this model","type":"invalid_request_error"}}' };
    const f = mockFetch([bad, h.ok(['ok'])]);
    const conn = h.conn();
    const events = await collect(h.adapter(f.fetch).stream(conn, request(h.model)));
    expect(text(events)).toBe('ok');
    expect(f.requests).toHaveLength(2);
    expect(f.requests[0]?.body).toMatchObject({ temperature: 0.2 });
    expect((f.requests[1]?.body as Record<string, unknown>).temperature).toBeUndefined();
    expect(conn.quirks.supportsTemperature).toBe(false);
    // Already flipped and still 400: one attempt, one error, no loop.
    const g = mockFetch([bad]);
    const again = await collect(h.adapter(g.fetch).stream(conn, request(h.model)));
    expect(again).toMatchObject([{ type: 'error', error: { kind: 'bad_request', status: 400 } }]);
    expect(g.requests).toHaveLength(1);
  });

  it('N2: a 400 naming a parameter the request did not send does not flip or resend', async () => {
    const f = mockFetch([{ status: 400, body: '{"error":{"message":"temperature is not supported with this model","type":"invalid_request_error"}}' }]);
    const conn = h.conn();
    const events = await collect(h.adapter(f.fetch).stream(conn, request(h.model, { temperature: undefined })));
    expect(f.requests).toHaveLength(1);
    expect(events).toMatchObject([{ type: 'error', error: { kind: 'bad_request', status: 400 } }]);
    expect(conn.quirks).toEqual({});
  });

  it('probe: ok with models on 200; a bad key is auth; a bad URL fails before any request', async () => {
    const list = h.name === 'anthropic-messages' ? { data: [{ type: 'model', id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z', max_input_tokens: 200000 }], has_more: false, first_id: null, last_id: null } : { object: 'list', data: [{ id: 'gemini-2.5-flash-lite', object: 'model', created: 0, owned_by: 'google' }] };
    const f = mockFetch([{ status: 200, body: JSON.stringify(list) }]);
    const adapter = h.adapter(f.fetch);
    const ok = await adapter.probe(h.conn());
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.models?.[0]?.id).toBe(h.model);
    expect(f.requests[0]?.method).toBe('GET');
    expect(f.requests[0]?.url).toBe(h.name === 'anthropic-messages' ? `${ANTHROPIC}/v1/models?limit=100` : `${OPENAI}/models`);
    const bad = await h.adapter(mockFetch([{ status: 401, body: '{"error":{"type":"authentication_error","message":"invalid x-api-key"}}' }]).fetch).probe(h.conn());
    expect(bad).toMatchObject({ ok: false, error: { kind: 'auth' } });
    const g = mockFetch([]);
    expect(await h.adapter(g.fetch).probe(h.conn({ baseUrl: 'nope' }))).toMatchObject({ ok: false, error: { kind: 'bad_request' } });
    expect(g.requests).toHaveLength(0);
  });

  it('bindClient: the model is the client’s, and a different req.model is a programming error', () => {
    const client: LLMClient = bindClient(h.adapter(mockFetch([]).fetch), h.conn({ quirks: { reasoning: { control: 'effort', lowest: 'low', reserveTokens: 256 } } }), h.model);
    expect(client.model).toBe(h.model);
    expect(client.reasoningReserveTokens).toBe(256);
    expect(() => client.stream(request('other-model'))).toThrow(/differs/);
  });
});

describe('anthropic-messages adapter (wire details)', () => {
  const conn = (over: Overrides<ResolvedConnection> = {}): ResolvedConnection => connection({ protocol: 'anthropic-messages', baseUrl: ANTHROPIC, auth: { style: 'x-api-key' }, ...over });

  it('sends x-api-key, max_tokens, stream, temperature and cache_control on the system block to {base}/v1/messages', async () => {
    const f = mockFetch([{ status: 200, body: anthropicStream({ text: ['x'] }) }]);
    await collect(createAnthropicAdapter({ fetch: f.fetch }).stream(conn({ extraHeaders: { 'x-tenant': 't1' }, queryParams: { 'api-version': '2' } }), request('claude-haiku-4-5')));
    const [r] = f.requests;
    expect(r?.url).toBe(`${ANTHROPIC}/v1/messages?api-version=2`);
    expect(r?.headers['x-api-key']).toBe('sk-test');
    expect(r?.headers['authorization']).toBeUndefined();
    expect(r?.headers['x-tenant']).toBe('t1');
    expect(r?.headers['anthropic-version']).toBeDefined();
    expect(r?.body).toEqual({
      model: 'claude-haiku-4-5',
      max_tokens: 64,
      stream: true,
      temperature: 0.2,
      system: [{ type: 'text', text: 'You translate.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: '<seg id="1">Hello</seg>' }],
    });
  });

  it('auth styles: bearer → Authorization; custom-header → that header only; none → no auth header', async () => {
    const run = async (c: ResolvedConnection): Promise<Record<string, string>> => {
      const f = mockFetch([{ status: 200, body: anthropicStream({ text: ['x'] }) }]);
      await collect(createAnthropicAdapter({ fetch: f.fetch }).stream(c, request('m')));
      return f.requests[0]?.headers ?? {};
    };
    const bearer = await run(conn({ auth: { style: 'bearer' } }));
    expect(bearer['authorization']).toBe('Bearer sk-test');
    expect(bearer['x-api-key']).toBeUndefined();
    const custom = await run(conn({ auth: { style: 'custom-header', headerName: 'X-Gateway-Token' } }));
    expect(custom['x-gateway-token']).toBe('sk-test');
    expect(custom['x-api-key']).toBeUndefined();
    expect(custom['authorization']).toBeUndefined();
    const none = await run(conn({ auth: { style: 'none' }, apiKey: undefined }));
    expect(none['x-api-key']).toBeUndefined();
    expect(none['authorization']).toBeUndefined();
  });

  it('no cache_control without the hint or when the connection says the gateway strips it; no system block when empty', async () => {
    const f = mockFetch([{ status: 200, body: anthropicStream({ text: ['x'] }) }]);
    const adapter = createAnthropicAdapter({ fetch: f.fetch });
    await collect(adapter.stream(conn(), request('m', { cacheHint: undefined })));
    expect(f.requests[0]?.body).toMatchObject({ system: [{ type: 'text', text: 'You translate.' }] });
    expect((f.requests[0]?.body as { system: unknown[] }).system[0]).not.toHaveProperty('cache_control');
    await collect(adapter.stream(conn({ quirks: { supportsCacheControl: false } }), request('m')));
    expect((f.requests[1]?.body as { system: unknown[] }).system[0]).not.toHaveProperty('cache_control');
    await collect(adapter.stream(conn(), request('m', { system: '' })));
    expect(f.requests[2]?.body).not.toHaveProperty('system');
  });

  it('N3: usage.input = input_tokens + cache reads + cache writes; cachedInput = reads', async () => {
    const body = anthropicStream({ text: ['x'], usage: { input_tokens: 100, output_tokens: 7, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 } });
    const events = await collect(createAnthropicAdapter({ fetch: mockFetch([{ status: 200, body }]).fetch }).stream(conn(), request('m')));
    expect(events.find((e) => e.type === 'usage')).toEqual({ type: 'usage', input: 1150, output: 7, cachedInput: 1000 });
  });

  it('stop reasons: max_tokens → max_tokens, refusal → refusal, stop_sequence → end, tool_use → other', async () => {
    for (const [reason, want] of [
      ['max_tokens', 'max_tokens'],
      ['refusal', 'refusal'],
      ['stop_sequence', 'end'],
      ['model_context_window_exceeded', 'max_tokens'],
      ['tool_use', 'other'],
    ] as const) {
      const events = await collect(createAnthropicAdapter({ fetch: mockFetch([{ status: 200, body: anthropicStream({ text: ['x'], stop_reason: reason }) }]).fetch }).stream(conn(), request('m')));
      expect(events.at(-1), reason).toEqual({ type: 'done', stopReason: want });
    }
  });

  it('thinking blocks are never emitted as text (§5.7); a budget quirk sends thinking and drops temperature', async () => {
    const f = mockFetch([{ status: 200, body: anthropicStream({ thinking: ['Let me think…'], text: ['Xin chào'] }) }]);
    const c = conn({ quirks: { reasoning: { control: 'budget', lowest: 1024, reserveTokens: 1024 } } });
    const events = await collect(createAnthropicAdapter({ fetch: f.fetch }).stream(c, request('m')));
    expect(text(events)).toBe('Xin chào');
    expect(f.requests[0]?.body).toMatchObject({ thinking: { type: 'enabled', budget_tokens: 1024 } });
    expect(f.requests[0]?.body).not.toHaveProperty('temperature');
    const g = mockFetch([{ status: 200, body: anthropicStream({ text: ['x'] }) }]);
    await collect(createAnthropicAdapter({ fetch: g.fetch }).stream(conn({ quirks: { reasoning: { control: 'budget', lowest: 'off', reserveTokens: 0 } } }), request('m')));
    expect(g.requests[0]?.body).toMatchObject({ thinking: { type: 'disabled' }, temperature: 0.2 });
  });

  it('M1-D7 on real shapes: a not_found_error "Not Found" is a wrong base URL; "model: x" is model_not_found', async () => {
    const wrongPath = { status: 404, body: '{"type":"error","error":{"type":"not_found_error","message":"Not Found"}}' };
    const a = await collect(createAnthropicAdapter({ fetch: mockFetch([wrongPath]).fetch }).stream(conn({ baseUrl: `${ANTHROPIC}/v1` }), request('m')));
    expect(a).toMatchObject([{ type: 'error', error: { kind: 'bad_request', status: 404, message: 'Wrong base URL (Not Found)' } }]);
    const model = { status: 404, body: '{"type":"error","error":{"type":"not_found_error","message":"model: claude-nope"}}' };
    const b = await collect(createAnthropicAdapter({ fetch: mockFetch([model]).fetch }).stream(conn(), request('claude-nope')));
    expect(b).toMatchObject([{ type: 'error', error: { kind: 'model_not_found', status: 404, message: 'model: claude-nope' } }]);
  });

  it('Anthropic 400 "credit balance is too low" → quota, no flip', async () => {
    const f = mockFetch([{ status: 400, body: '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}' }]);
    const events = await collect(createAnthropicAdapter({ fetch: f.fetch }).stream(conn(), request('m')));
    expect(events).toMatchObject([{ type: 'error', error: { kind: 'quota', status: 400 } }]);
    expect(f.requests).toHaveLength(1);
  });

  it('a mid-stream `event: error` after text: text, usage, then one error event (no retry: text was shown)', async () => {
    const body = anthropicStream({ text: ['Xin '], error: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, cutOff: true });
    const events = await collect(createAnthropicAdapter({ fetch: mockFetch([{ status: 200, body }]).fetch }).stream(conn(), request('m')));
    expect(types(events)).toEqual(['text', 'usage', 'error']);
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { kind: 'overloaded', message: 'Overloaded' } });
  });

  it('a stream that ends without message_stop is a cut: done with stopReason other', async () => {
    const body = anthropicStream({ text: ['Xin '], cutOff: true });
    const events = await collect(createAnthropicAdapter({ fetch: mockFetch([{ status: 200, body }]).fetch }).stream(conn(), request('m')));
    expect(types(events)).toEqual(['text', 'usage', 'done']);
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'other' });
  });

  it('listModels maps id, display name and context window', async () => {
    const list = { data: [{ type: 'model', id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z', max_input_tokens: 200000 }], has_more: false, first_id: null, last_id: null };
    const models = await createAnthropicAdapter({ fetch: mockFetch([{ status: 200, body: JSON.stringify(list) }]).fetch }).listModels?.(conn());
    expect(models).toEqual([{ id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', contextWindow: 200000 }]);
  });
});

describe('openai-chat adapter (wire details)', () => {
  const conn = (over: Overrides<ResolvedConnection> = {}): ResolvedConnection => connection({ protocol: 'openai-chat', baseUrl: OPENAI, auth: { style: 'bearer' }, ...over });

  it('sends Bearer auth, system as the first message, max_tokens, stream and stream_options.include_usage to {base}/chat/completions', async () => {
    const f = mockFetch([{ status: 200, body: openaiStream({ text: ['x'] }) }]);
    await collect(createOpenAIAdapter({ fetch: f.fetch }).stream(conn({ extraHeaders: { 'HTTP-Referer': 'https://example.com' } }), request('gemini-2.5-flash-lite')));
    const [r] = f.requests;
    expect(r?.url).toBe(`${OPENAI}/chat/completions`);
    expect(r?.headers['authorization']).toBe('Bearer sk-test');
    expect(r?.headers['http-referer']).toBe('https://example.com');
    expect(r?.body).toEqual({
      model: 'gemini-2.5-flash-lite',
      messages: [
        { role: 'system', content: 'You translate.' },
        { role: 'user', content: '<seg id="1">Hello</seg>' },
      ],
      stream: true,
      max_tokens: 64,
      stream_options: { include_usage: true },
      temperature: 0.2,
    });
  });

  it('auth styles: x-api-key and custom-header replace the Bearer header; none sends no auth header', async () => {
    const run = async (c: ResolvedConnection): Promise<Record<string, string>> => {
      const f = mockFetch([{ status: 200, body: openaiStream({ text: ['x'] }) }]);
      await collect(createOpenAIAdapter({ fetch: f.fetch }).stream(c, request('m')));
      return f.requests[0]?.headers ?? {};
    };
    const xapi = await run(conn({ auth: { style: 'x-api-key' } }));
    expect(xapi['x-api-key']).toBe('sk-test');
    expect(xapi['authorization']).toBeUndefined();
    const custom = await run(conn({ auth: { style: 'custom-header', headerName: 'api-key' } }));
    expect(custom['api-key']).toBe('sk-test');
    expect(custom['authorization']).toBeUndefined();
    const none = await run(conn({ auth: { style: 'none' }, apiKey: undefined, baseUrl: 'http://localhost:11434/v1' }));
    expect(none['authorization']).toBeUndefined();
  });

  it('quirks: max_completion_tokens, no stream usage, no temperature, reasoning_effort, system folded into the user message', async () => {
    const f = mockFetch([{ status: 200, body: openaiStream({ text: ['x'], usage: null }) }]);
    const c = conn({ quirks: { maxTokensParam: 'max_completion_tokens', supportsStreamUsage: false, supportsTemperature: false, supportsSystemRole: false, reasoning: { control: 'effort', lowest: 'low', reserveTokens: 256 } } });
    const events = await collect(createOpenAIAdapter({ fetch: f.fetch }).stream(c, request('gpt-oss:20b')));
    expect(f.requests[0]?.body).toEqual({
      model: 'gpt-oss:20b',
      messages: [{ role: 'user', content: 'You translate.\n\n<seg id="1">Hello</seg>' }],
      stream: true,
      max_completion_tokens: 64,
      reasoning_effort: 'low',
    });
    // No usage chunk (stream_options off): text then done, no usage event.
    expect(types(events)).toEqual(['text', 'done']);
  });

  it('reasoning "off" with effort control is sent as reasoning_effort none; jsonMode sends response_format', async () => {
    const f = mockFetch([{ status: 200, body: openaiStream({ text: ['{}'] }) }]);
    await collect(createOpenAIAdapter({ fetch: f.fetch }).stream(conn({ quirks: { reasoning: { control: 'effort', lowest: 'off', reserveTokens: 0 } } }), request('m', { jsonMode: true })));
    expect(f.requests[0]?.body).toMatchObject({ reasoning_effort: 'none', response_format: { type: 'json_object' } });
  });

  it('§4.2.4: a 400 about max_tokens flips to max_completion_tokens, resends once, and saves the quirk on the connection', async () => {
    const bad: ScriptedResponse = { status: 400, body: '{"error":{"message":"Unsupported parameter: \'max_tokens\' is not supported with this model. Use \'max_completion_tokens\' instead.","type":"invalid_request_error","param":"max_tokens","code":"unsupported_parameter"}}' };
    const f = mockFetch([bad, { status: 200, body: openaiStream({ text: ['ok'] }) }]);
    const c = conn();
    const events = await collect(createOpenAIAdapter({ fetch: f.fetch }).stream(c, request('m')));
    expect(text(events)).toBe('ok');
    expect(f.requests).toHaveLength(2);
    expect(f.requests[0]?.body).toMatchObject({ max_tokens: 64 });
    expect(f.requests[1]?.body).toMatchObject({ max_completion_tokens: 64 });
    expect((f.requests[1]?.body as Record<string, unknown>).max_tokens).toBeUndefined();
    expect(c.quirks.maxTokensParam).toBe('max_completion_tokens');
  });

  it('N2: Gemini\'s generic 400 "Invalid JSON payload … Unknown name" without jsonMode neither flips nor resends', async () => {
    const gemini: ScriptedResponse = { status: 400, body: '[{"error":{"code":400,"message":"Invalid JSON payload received. Unknown name \\"foo\\" at \'generation_config\': Cannot find field.","status":"INVALID_ARGUMENT"}}]' };
    const f = mockFetch([gemini]);
    const c = conn();
    const events = await collect(createOpenAIAdapter({ fetch: f.fetch }).stream(c, request('m')));
    expect(f.requests).toHaveLength(1);
    expect(events).toMatchObject([{ type: 'error', error: { kind: 'bad_request', status: 400, message: expect.stringContaining('Unknown name') } }]);
    expect(c.quirks).toEqual({});
    // The same message on a request WITH jsonMode: still no flip, "json" alone is not the parameter name.
    const g = mockFetch([gemini]);
    const d = conn();
    await collect(createOpenAIAdapter({ fetch: g.fetch }).stream(d, request('m', { jsonMode: true })));
    expect(g.requests).toHaveLength(1);
    expect(d.quirks).toEqual({});
  });

  it('N2: a genuine response_format rejection on a jsonMode request flips supportsJsonMode once and resends without it', async () => {
    const bad: ScriptedResponse = { status: 400, body: '{"error":{"message":"Unrecognized request argument supplied: response_format","type":"invalid_request_error"}}' };
    const f = mockFetch([bad, { status: 200, body: openaiStream({ text: ['{}'] }) }]);
    const c = conn();
    const events = await collect(createOpenAIAdapter({ fetch: f.fetch }).stream(c, request('m', { jsonMode: true })));
    expect(text(events)).toBe('{}');
    expect(f.requests).toHaveLength(2);
    expect(f.requests[0]?.body).toMatchObject({ response_format: { type: 'json_object' } });
    expect((f.requests[1]?.body as Record<string, unknown>).response_format).toBeUndefined();
    expect(c.quirks.supportsJsonMode).toBe(false);
    // Without jsonMode the same 400 is just an error: nothing to flip.
    const g = mockFetch([bad]);
    const d = conn();
    await collect(createOpenAIAdapter({ fetch: g.fetch }).stream(d, request('m')));
    expect(g.requests).toHaveLength(1);
    expect(d.quirks).toEqual({});
  });

  it('N2: a 400 about the system role flips only when a system block was sent', async () => {
    const bad: ScriptedResponse = { status: 400, body: '{"error":{"message":"Developer instruction is not enabled for this model (system role)","type":"invalid_request_error"}}' };
    const f = mockFetch([bad]);
    const c = conn();
    await collect(createOpenAIAdapter({ fetch: f.fetch }).stream(c, request('m', { system: '' })));
    expect(f.requests).toHaveLength(1);
    expect(c.quirks).toEqual({});
    const g = mockFetch([bad, { status: 200, body: openaiStream({ text: ['ok'] }) }]);
    const d = conn();
    await collect(createOpenAIAdapter({ fetch: g.fetch }).stream(d, request('m', { system: 'be brief' })));
    expect(g.requests).toHaveLength(2);
    expect((g.requests[1]?.body as { messages: { role: string }[] }).messages.map((m) => m.role)).toEqual(['user']);
    expect(d.quirks.supportsSystemRole).toBe(false);
  });

  it('N3: usage maps prompt_tokens and prompt_tokens_details.cached_tokens; absent details → no cachedInput', async () => {
    const a = await collect(createOpenAIAdapter({ fetch: mockFetch([{ status: 200, body: openaiStream({ text: ['x'], usage: { prompt_tokens: 120, completion_tokens: 9, cached_tokens: 100 } }) }]).fetch }).stream(conn(), request('m')));
    expect(a.find((e) => e.type === 'usage')).toEqual({ type: 'usage', input: 120, output: 9, cachedInput: 100 });
    const b = await collect(createOpenAIAdapter({ fetch: mockFetch([{ status: 200, body: openaiStream({ text: ['x'], usage: { prompt_tokens: 12, completion_tokens: 3 } }) }]).fetch }).stream(conn(), request('m')));
    expect(b.find((e) => e.type === 'usage')).toEqual({ type: 'usage', input: 12, output: 3 });
  });

  it('finish reasons: length → max_tokens, content_filter → refusal, tool_calls → other', async () => {
    for (const [reason, want] of [
      ['length', 'max_tokens'],
      ['content_filter', 'refusal'],
      ['tool_calls', 'other'],
    ] as const) {
      const events = await collect(createOpenAIAdapter({ fetch: mockFetch([{ status: 200, body: openaiStream({ text: ['x'], finish_reason: reason }) }]).fetch }).stream(conn(), request('m')));
      expect(events.at(-1), reason).toEqual({ type: 'done', stopReason: want });
    }
  });

  it('delta.reasoning is never emitted as text (S2 §5)', async () => {
    const events = await collect(createOpenAIAdapter({ fetch: mockFetch([{ status: 200, body: openaiStream({ reasoning: ['thinking about <seg>…'], text: ['<seg id="1">Xin chào</seg>'] }) }]).fetch }).stream(conn(), request('m')));
    expect(text(events)).toBe('<seg id="1">Xin chào</seg>');
  });

  it('Ollama style: usage and finish_reason in the same last chunk, no separate usage chunk', async () => {
    const body = sse([
      { data: { id: '1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'Xin' }, finish_reason: null }] } },
      { data: { id: '1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { content: ' chào' }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 4, total_tokens: 34 } } },
      { data: '[DONE]' },
    ]);
    const events = await collect(createOpenAIAdapter({ fetch: mockFetch([{ status: 200, body }]).fetch }).stream(conn(), request('m')));
    expect(text(events)).toBe('Xin chào');
    expect(events.slice(-2)).toEqual([
      { type: 'usage', input: 30, output: 4 },
      { type: 'done', stopReason: 'end' },
    ]);
  });

  it('OpenAI 429 insufficient_quota → quota; a bare-string 429 body → rate_limit with Retry-After', async () => {
    const a = await collect(createOpenAIAdapter({ fetch: mockFetch([{ status: 429, body: '{"error":{"message":"You exceeded your current quota","type":"insufficient_quota","code":"insufficient_quota"}}' }]).fetch }).stream(conn(), request('m')));
    expect(a).toMatchObject([{ type: 'error', error: { kind: 'quota' } }]);
    const b = await collect(createOpenAIAdapter({ fetch: mockFetch([{ status: 429, body: '{"error":"too many concurrent requests"}', headers: { 'content-type': 'application/json', 'retry-after': '11' } }]).fetch }).stream(conn(), request('m')));
    expect(b).toMatchObject([{ type: 'error', error: { kind: 'rate_limit', retryAfterMs: 11000, message: 'too many concurrent requests' } }]);
  });

  it('a mid-stream {"error": …} line after text ends with one error event', async () => {
    const body = openaiStream({ text: ['Xin '], error: { message: 'The server had an error', type: 'server_error' }, cutOff: true });
    const events = await collect(createOpenAIAdapter({ fetch: mockFetch([{ status: 200, body }]).fetch }).stream(conn(), request('m')));
    expect(types(events)).toEqual(['text', 'error']);
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { kind: 'overloaded', message: 'The server had an error' } });
  });

  it('a stream cut before [DONE] is done with stopReason other', async () => {
    const events = await collect(createOpenAIAdapter({ fetch: mockFetch([{ status: 200, body: openaiStream({ text: ['Xin '], cutOff: true }) }]).fetch }).stream(conn(), request('m')));
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'other' });
  });

  it('Gemini-shaped 404 for an unknown model is model_not_found', async () => {
    const body = '{"error":{"message":"models/gemini-nope is not found for API version v1beta, or is not supported for generateContent.","code":404,"status":"NOT_FOUND"}}';
    const events = await collect(createOpenAIAdapter({ fetch: mockFetch([{ status: 404, body }]).fetch }).stream(conn(), request('gemini-nope')));
    expect(events).toMatchObject([{ type: 'error', error: { kind: 'model_not_found' } }]);
  });
});

describe('createClient / createAdapter', () => {
  it('picks the adapter by protocol; chrome-builtin is not built yet', () => {
    expect(createAdapter('anthropic-messages').protocol).toBe('anthropic-messages');
    expect(createAdapter('openai-chat').protocol).toBe('openai-chat');
    expect(() => createAdapter('chrome-builtin')).toThrow(/M4/);
    expect(createClient(connection(), 'm').model).toBe('m');
  });

  it('loads the SDK lazily: a client streams through the adapter it imports on first use (review N5)', async () => {
    const f = mockFetch([{ status: 200, body: openaiStream({ text: ['Xin ', 'chào'] }), headers: { 'content-type': 'text/event-stream' } }]);
    const client = createClient(connection(), 'm', { fetch: f.fetch });
    expect(f.requests).toHaveLength(0);
    const events = await collect(client.stream(request('m')));
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toBe('Xin chào');
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end' });
    expect(f.requests).toHaveLength(1);
  });

  it('a request aborted while the SDK loads throws the abort reason, without a request', async () => {
    const f = mockFetch([{ status: 200, body: openaiStream({ text: ['x'] }) }]);
    const ac = new AbortController();
    const stream = createClient(connection(), 'm', { fetch: f.fetch }).stream(request('m', { signal: ac.signal }));
    const it = stream[Symbol.asyncIterator]();
    const first = it.next();
    ac.abort(new Error('cancelled'));
    await expect(first).rejects.toThrow('cancelled');
    expect(f.requests).toHaveLength(0);
  });
});
