// `anthropic-messages` adapter on @anthropic-ai/sdk (DESIGN.md §4.2.2, plan M1-E7): `baseURL`
// override, auth per §4.2.3, streaming, usage (§4.2.1: input = uncached + cache reads + cache
// writes; cachedInput = cache reads), `cache_control` on the system block, abort, probe and
// listModels. The SDK runs with `maxRetries: 0`: the engine's pipeline is the only retry owner
// (src/engine/retry.ts). Thinking blocks are never emitted as text (§5.7, S2).

import Anthropic, { APIError } from '@anthropic-ai/sdk';
import type { MessageCreateParamsStreaming, RawMessageStreamEvent, StopReason as AnthropicStopReason, TextBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { reasoningFor } from './reasoning.ts';
import { classifySdkError, headerOverrides, preflight, streamAttempts, type AdapterOptions, type IdleGuard, type QuirkFlip, type SdkApiError, FLIP_TEMPERATURE } from './sdk.ts';
import type { ModelInfo, NormalizedEvent, NormalizedRequest, ProbeResult, ProtocolAdapter, Quirks, ResolvedConnection, StopReason } from './types.ts';

const isApiError = (e: unknown): e is SdkApiError => e instanceof APIError;

/** §4.2.4 flips this adapter knows: `temperature` (thinking models), `cache_control` (a gateway that rejects it), `thinking`. */
const FLIPS: readonly QuirkFlip[] = [
  FLIP_TEMPERATURE,
  { key: 'supportsCacheControl', test: /cache_control/i, apply: (q, req) => req.cacheHint === 'system' && req.system !== '' && q.supportsCacheControl !== false && ((q.supportsCacheControl = false), true) },
  {
    key: 'reasoning',
    // `thinking` goes out only under the `budget` control.
    test: /thinking|budget_tokens/i,
    apply: (q) => {
      if (q.reasoning === undefined || q.reasoning.control !== 'budget') return false;
      q.reasoning = { ...q.reasoning, control: 'none' };
      return true;
    },
  },
];

function clientFor(conn: ResolvedConnection, options: AdapterOptions): Anthropic {
  const { style } = conn.auth;
  return new Anthropic({
    baseURL: conn.baseUrl,
    apiKey: style === 'x-api-key' ? (conn.apiKey ?? null) : null,
    authToken: style === 'bearer' ? (conn.apiKey ?? null) : null,
    defaultHeaders: headerOverrides(conn, 'x-api-key'),
    ...(conn.queryParams === undefined ? {} : { defaultQuery: conn.queryParams }),
    maxRetries: 0,
    dangerouslyAllowBrowser: true,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}

function stopReason(reason: AnthropicStopReason): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

export function toAnthropicParams(req: NormalizedRequest, quirks: Quirks): MessageCreateParamsStreaming {
  const params: MessageCreateParamsStreaming = {
    model: req.model,
    max_tokens: req.maxOutputTokens,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  };
  if (req.system !== '') {
    const block: TextBlockParam = { type: 'text', text: req.system };
    if (req.cacheHint === 'system' && quirks.supportsCacheControl !== false) block.cache_control = { type: 'ephemeral' };
    params.system = [block];
  }
  const reasoning = reasoningFor(quirks.reasoning, req);
  let thinking = false;
  if (reasoning !== undefined && reasoning.control === 'budget') {
    if (reasoning.lowest === 'off') params.thinking = { type: 'disabled' };
    else {
      params.thinking = { type: 'enabled', budget_tokens: Number(reasoning.lowest) };
      thinking = true;
    }
  }
  // Thinking requires the default temperature.
  if (req.temperature !== undefined && quirks.supportsTemperature !== false && !thinking) params.temperature = req.temperature;
  return params;
}

async function* attempt(client: Anthropic, req: NormalizedRequest, quirks: Quirks, guard: IdleGuard): AsyncGenerator<NormalizedEvent> {
  const stream = await client.messages.create(toAnthropicParams(req, quirks), { signal: guard.signal });
  guard.touch();
  let input = 0;
  let cachedInput = 0;
  let output = 0;
  let sawUsage = false;
  let stop: StopReason | undefined;
  let stopped = false;
  const blocks = new Map<number, string>();
  const readInput = (u: { input_tokens: number | null; cache_read_input_tokens: number | null; cache_creation_input_tokens: number | null }): void => {
    if (u.input_tokens !== null) input = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    if (u.cache_read_input_tokens !== null) cachedInput = u.cache_read_input_tokens;
    sawUsage = true;
  };
  for await (const event of stream as AsyncIterable<RawMessageStreamEvent>) {
    guard.touch();
    switch (event.type) {
      case 'message_start':
        readInput(event.message.usage);
        output = event.message.usage.output_tokens;
        // Provisional: the input is billed even if the stream fails later (streamAttempts keeps the last usage).
        yield { type: 'usage', input, output, cachedInput };
        break;
      case 'content_block_start':
        blocks.set(event.index, event.content_block.type);
        break;
      case 'content_block_delta':
        // Only text blocks become text; thinking / redacted_thinking deltas are dropped (§5.7).
        if (event.delta.type === 'text_delta' && blocks.get(event.index) === 'text') yield { type: 'text', delta: event.delta.text };
        break;
      case 'message_delta':
        readInput(event.usage);
        output = event.usage.output_tokens;
        if (event.delta.stop_reason !== null) stop = stopReason(event.delta.stop_reason);
        break;
      case 'message_stop':
        stopped = true;
        break;
      default:
        break;
    }
  }
  if (sawUsage) yield { type: 'usage', input, output, cachedInput };
  if (stopped || stop !== undefined) yield { type: 'done', stopReason: stop ?? 'other' };
}

const MAX_MODELS = 500;

export function createAnthropicAdapter(options: AdapterOptions = {}): ProtocolAdapter {
  /** The models, and whether the listing is Anthropic-shaped (every `data[].type == "model"`, at least one; §4.2.5 step 1). */
  const list = async (conn: ResolvedConnection): Promise<{ models: ModelInfo[]; shape: boolean }> => {
    const models: ModelInfo[] = [];
    let shape = true;
    for await (const m of clientFor(conn, options).models.list({ limit: 100 })) {
      if ((m as { type?: unknown }).type !== 'model') shape = false;
      models.push({ id: m.id, ...(typeof m.display_name === 'string' ? { displayName: m.display_name } : {}), ...(typeof m.max_input_tokens === 'number' ? { contextWindow: m.max_input_tokens } : {}) });
      if (models.length >= MAX_MODELS) break;
    }
    return { models, shape: shape && models.length > 0 };
  };
  const listModels = async (conn: ResolvedConnection): Promise<ModelInfo[]> => (await list(conn)).models;
  return {
    protocol: 'anthropic-messages',
    stream(conn, req) {
      const client = clientFor(conn, options);
      return streamAttempts(conn, req, (quirks, guard) => attempt(client, req, quirks, guard), { isApiError, flips: FLIPS, ...(options.idleMs === undefined ? {} : { idleMs: options.idleMs }), ...(options.onQuirkLearned === undefined ? {} : { onQuirkLearned: options.onQuirkLearned }) });
    },
    listModels,
    /** `GET /v1/models` needs the key here, so a 401 shows a bad key; success is the status (S4). */
    async probe(conn): Promise<ProbeResult> {
      const pre = preflight(conn);
      if (pre !== null) return { ok: false, error: pre };
      try {
        return { ok: true, ...(await list(conn)) };
      } catch (err) {
        return { ok: false, error: await classifySdkError(err, conn, isApiError) };
      }
    },
  };
}
