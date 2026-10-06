// `openai-chat` adapter on the openai SDK, minimal (DESIGN.md §4.2.2 column openai-chat; user
// decision M1-D5: enough for live calls against Gemini's OpenAI-compatible endpoint). `baseURL`
// override, bearer auth (§4.2.3), system as the first message, streaming deltas, usage via
// `stream_options.include_usage` (`prompt_tokens`; cachedInput = `prompt_tokens_details.cached_tokens`),
// the `max_tokens` / `max_completion_tokens` quirk, `GET /models`, probe. Presets, auto-detect
// and provider management are M4. `maxRetries: 0`: the pipeline owns retries (src/engine/retry.ts).
// `delta.reasoning` / `reasoning_content` is never emitted as text (S2 §5, §5.7).

import OpenAI, { APIError } from 'openai';
import type { ChatCompletionChunk, ChatCompletionCreateParamsStreaming, ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ReasoningEffort } from 'openai/resources/shared';
import { classifySdkError, headerOverrides, preflight, streamAttempts, type AdapterOptions, type QuirkFlip, type SdkApiError, FLIP_TEMPERATURE } from './sdk.ts';
import type { ModelInfo, NormalizedEvent, NormalizedRequest, ProbeResult, ProtocolAdapter, Quirks, ResolvedConnection, StopReason } from './types.ts';

/** Gemini's OpenAI-compatible endpoint (M1-D5). A preset in M4. */
export const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

const isApiError = (e: unknown): e is SdkApiError => e instanceof APIError;

/** §4.2.4 flips this adapter knows. */
const FLIPS: readonly QuirkFlip[] = [
  FLIP_TEMPERATURE,
  {
    test: /max_completion_tokens|max_tokens/i,
    apply: (q) => {
      q.maxTokensParam = (q.maxTokensParam ?? 'max_tokens') === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
      return true;
    },
  },
  { test: /stream_options|include_usage/i, apply: (q) => q.supportsStreamUsage !== false && ((q.supportsStreamUsage = false), true) },
  {
    test: /reasoning/i,
    apply: (q) => {
      if (q.reasoning === undefined || q.reasoning.control === 'none') return false;
      q.reasoning = { ...q.reasoning, control: 'none' };
      return true;
    },
  },
  { test: /response_format|json/i, apply: (q) => q.supportsJsonMode !== false && ((q.supportsJsonMode = false), true) },
  { test: /\bsystem\b|developer/i, apply: (q) => q.supportsSystemRole !== false && ((q.supportsSystemRole = false), true) },
];

function clientFor(conn: ResolvedConnection, options: AdapterOptions): OpenAI {
  const headers = headerOverrides(conn, 'authorization');
  // The SDK has no x-api-key auth: send it as a custom header and drop the Bearer one.
  if (conn.auth.style === 'x-api-key' && conn.apiKey !== undefined) {
    headers['authorization'] = null;
    headers['x-api-key'] = conn.apiKey;
  }
  return new OpenAI({
    baseURL: conn.baseUrl,
    // The constructor requires a key; for the other auth styles the Bearer header is removed above.
    apiKey: conn.auth.style === 'bearer' && conn.apiKey !== undefined ? conn.apiKey : 'none',
    defaultHeaders: headers,
    ...(conn.queryParams === undefined ? {} : { defaultQuery: conn.queryParams }),
    maxRetries: 0,
    dangerouslyAllowBrowser: true,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}

function stopReason(reason: NonNullable<ChatCompletionChunk.Choice['finish_reason']>): StopReason {
  switch (reason) {
    case 'stop':
      return 'end';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'other';
  }
}

export function toOpenAIParams(req: NormalizedRequest, quirks: Quirks): ChatCompletionCreateParamsStreaming {
  const messages: ChatCompletionMessageParam[] = req.messages.map((m) => ({ role: m.role, content: m.content }));
  if (req.system !== '') {
    if (quirks.supportsSystemRole === false) {
      // Fold the system prompt into the first user message (§4.2.4).
      const first = messages.findIndex((m) => m.role === 'user');
      if (first === -1) messages.unshift({ role: 'user', content: req.system });
      else messages[first] = { role: 'user', content: `${req.system}\n\n${String(messages[first]?.content ?? '')}` };
    } else messages.unshift({ role: 'system', content: req.system });
  }
  const params: ChatCompletionCreateParamsStreaming = { model: req.model, messages, stream: true };
  params[quirks.maxTokensParam ?? 'max_tokens'] = req.maxOutputTokens;
  if (quirks.supportsStreamUsage !== false) params.stream_options = { include_usage: true };
  if (req.temperature !== undefined && quirks.supportsTemperature !== false) params.temperature = req.temperature;
  const reasoning = quirks.reasoning;
  // The lowest effort the model accepts (§5.7); "off" is `none` where the endpoint can switch thinking off.
  if (reasoning !== undefined && reasoning.control === 'effort') params.reasoning_effort = (reasoning.lowest === 'off' ? 'none' : String(reasoning.lowest)) as ReasoningEffort;
  if (req.jsonMode === true && quirks.supportsJsonMode !== false) params.response_format = { type: 'json_object' };
  return params;
}

async function* attempt(client: OpenAI, req: NormalizedRequest, quirks: Quirks): AsyncGenerator<NormalizedEvent> {
  const stream = await client.chat.completions.create(toOpenAIParams(req, quirks), { signal: req.signal });
  let usage: Extract<NormalizedEvent, { type: 'usage' }> | undefined;
  let stop: StopReason | undefined;
  for await (const chunk of stream) {
    // Always one choice (n = 1); some gateways send the usage chunk with no `choices` at all.
    const choice = (chunk.choices as ChatCompletionChunk.Choice[] | undefined)?.[0];
    if (choice !== undefined) {
      const content = choice.delta?.content;
      if (typeof content === 'string' && content !== '') yield { type: 'text', delta: content };
      if (choice.finish_reason !== null && choice.finish_reason !== undefined) stop = stopReason(choice.finish_reason);
    }
    if (chunk.usage !== null && chunk.usage !== undefined) {
      const cached = chunk.usage.prompt_tokens_details?.cached_tokens;
      usage = { type: 'usage', input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens, ...(cached === undefined ? {} : { cachedInput: cached }) };
    }
  }
  if (usage !== undefined) yield usage;
  if (stop !== undefined) yield { type: 'done', stopReason: stop };
}

const MAX_MODELS = 500;

export function createOpenAIAdapter(options: AdapterOptions = {}): ProtocolAdapter {
  const listModels = async (conn: ResolvedConnection): Promise<ModelInfo[]> => {
    const out: ModelInfo[] = [];
    for await (const m of clientFor(conn, options).models.list()) {
      out.push({ id: m.id });
      if (out.length >= MAX_MODELS) break;
    }
    return out;
  };
  return {
    protocol: 'openai-chat',
    stream(conn, req) {
      const client = clientFor(conn, options);
      return streamAttempts(conn, req, (quirks) => attempt(client, req, quirks), { isApiError, flips: FLIPS });
    },
    listModels,
    /**
     * `GET /models`; success is the status (S4 decision 3). On Ollama cloud the listing is public,
     * so its M4 preset must probe with a 1-token chat call instead (S4).
     */
    async probe(conn): Promise<ProbeResult> {
      const pre = preflight(conn);
      if (pre !== null) return { ok: false, error: pre };
      try {
        return { ok: true, models: await listModels(conn) };
      } catch (err) {
        return { ok: false, error: await classifySdkError(err, conn, isApiError) };
      }
    },
  };
}
