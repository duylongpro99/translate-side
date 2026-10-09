// Normalized LLM contract (DESIGN.md §4.2.1, §4.2.4, §4.3.1). The engine depends on this file
// only, never on adapter implementations. M4 builds the second adapter against it, so changes
// here are contract changes: additive and optional only.
//
// Retry ownership (plan M1 §5, criterion 7): adapters and the SDKs under them do NOT retry
// (SDK `maxRetries: 0`). They classify the failure (src/llm/errors.ts) and yield one `error`
// event. The engine's pipeline is the single owner of backoff and retry (src/engine/retry.ts).
// The one exception is the §4.2.4 quirk flip, which is not a retry of the same request: on a
// status-400 `bad_request` that names a request parameter (`isQuirkFlipCandidate`), the adapter
// flips that quirk, resends once with the fixed request, and saves the quirk. At most once per
// `stream()` call, and never for `rate_limit`, `overloaded`, `network` or any other kind, so a
// rate limit still costs exactly one attempt per call.

/** Roles the engine asks for (§5.1). The shell maps each to a model profile (§4.3.1 Routing). */
export type ModelRole = 'translate' | 'analyze' | 'review';

export type Protocol = 'anthropic-messages' | 'openai-chat' | 'chrome-builtin';
export type AuthStyle = 'x-api-key' | 'bearer' | 'custom-header' | 'none';

/** Per-connection capability flags (§4.2.4). */
export interface Quirks {
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
  /** Some reasoning models reject it. */
  supportsTemperature?: boolean;
  /** Rare: fold system into the first user message if false. */
  supportsSystemRole?: boolean;
  /** Send `stream_options.include_usage`? */
  supportsStreamUsage?: boolean;
  /** `response_format` / `output_config`. */
  supportsJsonMode?: boolean;
  /** An Anthropic-format gateway may strip it. */
  supportsCacheControl?: boolean;
  /**
   * A prefix the server's model list puts on ids it also takes bare (Gemini: `models/`). The
   * settings show and save the bare id (src/shared/connect.ts displayModels). Set by the preset.
   */
  modelIdPrefix?: string;
  /** Decision S2. */
  reasoning?: {
    /** An effort level (OpenAI-style), a token budget (Anthropic-style), or not at all. */
    control: 'effort' | 'budget' | 'none';
    /** The value to send, e.g. "low", or a budget in tokens; "off" where thinking can be switched off. */
    lowest: string | number | 'off';
    /** Added to maxOutputTokens; 0 when `lowest` is "off". */
    reserveTokens: number;
    /**
     * Per-chunk policy (M2-D16): a request whose `chunkIndex` is at least `fromChunk` sends the last
     * such entry's `lowest` and counts its `reserveTokens` instead; requests without a `chunkIndex`
     * (analyze), earlier chunks and `baseReasoning` requests (a repair) use the fields above.
     * `control` is shared (src/llm/reasoning.ts).
     */
    byChunk?: readonly { fromChunk: number; lowest: string | number | 'off'; reserveTokens: number }[];
  };
}

/**
 * A connection as an adapter receives it: the stored ProviderConnection (§4.3.1) with the
 * protocol resolved and the key read from secret storage (§4.3.4). Built by the shell.
 */
export interface ResolvedConnection {
  id: string;
  protocol: Protocol;
  baseUrl: string;
  auth: { style: AuthStyle; headerName?: string };
  /** Trimmed when saved (S4). Absent for auth `none`. */
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  quirks: Quirks;
  /**
   * Port: does the extension hold the host permission for `baseUrl`? Used to tell a missing
   * permission (`cors`, cause `permission`) from a network failure (S4 row 1). Required, so a
   * shell can't leave it out and turn row 1 into a retried `network` error; where there is no
   * such permission (the Node harness) pass `async () => true`.
   */
  hasHostPermission: () => Promise<boolean>;
}

export interface NormalizedRequest {
  /** The model the adapter sends. Must equal `LLMClient.model` of the client it is sent to. */
  model: string;
  /** Stable prefix: rules + brief + glossary. */
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxOutputTokens: number;
  /** Dropped by the adapter if the model doesn't accept it. */
  temperature?: number;
  /** "Please cache the system prefix if you can." */
  cacheHint?: 'system';
  /** For the brief call. */
  jsonMode?: boolean;
  /** The chunk's place in the order the job's chunks started (translate calls; page order unless viewport first, M3-E1): picks `Quirks.reasoning.byChunk`. Not sent. */
  chunkIndex?: number;
  /**
   * Send the base thinking setting whatever the chunk (thinking off for a per-chunk policy that
   * starts off): the repair after a cut must not repeat the thinking that used up the cap. Not sent.
   */
  baseReasoning?: boolean;
  signal: AbortSignal;
}

/** What picks a request's thinking setting (src/llm/reasoning.ts). */
export type ReserveQuery = Pick<NormalizedRequest, 'chunkIndex' | 'baseReasoning'>;

export type StopReason = 'end' | 'max_tokens' | 'refusal' | 'other';

/**
 * What a stream yields, in this order: `text` deltas, at most one `usage` (request totals), then
 * exactly one terminal event, `done` or `error`, after which the stream ends. Reasoning is never
 * emitted as text (§5.7).
 *
 * `usage.input` counts every input token: uncached, cache reads and cache writes. For Anthropic
 * that is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`; for OpenAI,
 * `prompt_tokens`. `cachedInput` is the subset read from the prompt cache (Anthropic
 * `cache_read_input_tokens`, OpenAI `prompt_tokens_details.cached_tokens`); cache writes are in
 * `input` but not in `cachedInput`. `reasoningOutput` is the thinking part of `output`, where the
 * endpoint reports it (OpenAI-compatible `completion_tokens_details.reasoning_tokens`).
 */
export type NormalizedEvent =
  | { type: 'text'; delta: string }
  | { type: 'usage'; input: number; output: number; cachedInput?: number; reasoningOutput?: number }
  | { type: 'done'; stopReason: StopReason }
  | { type: 'error'; error: LLMError };

export type LLMErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'overloaded'
  | 'context_length'
  | 'bad_request'
  | 'model_not_found'
  | 'network'
  | 'cors'
  | 'unknown'
  // valid key, but no allowance: 402 plan/credits, OpenAI 429 insufficient_quota, Anthropic 400 credit balance
  | 'quota';

export interface LLMError {
  kind: LLMErrorKind;
  /** Only for `cors` (decision S4): `permission` → Grant access; `origin` → the §4.3.6 guide. */
  cause?: 'permission' | 'origin';
  status?: number;
  retryAfterMs?: number;
  /** Human-readable, shown in UI. */
  message: string;
  raw?: unknown;
}

/**
 * What the engine calls (§4.2 diagram): a client already bound to one model profile, handed out
 * per role by the shell (`StageContext.llm(role)`, §5.3).
 *
 * Contract for implementations:
 * - No retries (see the header). One `stream()` call → one attempt, except the single §4.2.4
 *   quirk-flip resend on a status-400 `bad_request`.
 * - Failures are yielded as one `error` event (classified, src/llm/errors.ts), never thrown.
 * - Cancel: when `req.signal` aborts, the stream stops and throws `signal.reason`. A cancel is
 *   never reported as an `error` event (and never as `network`, S4).
 */
export interface LLMClient {
  /**
   * The model this client is bound to. Callers copy it into `NormalizedRequest.model` (the two
   * must be equal; the adapter sends `req.model`), `producedBy` and usage.
   */
  readonly model: string;
  /**
   * The thinking reserve of the setting `req` will be sent with (`quirks.reasoning`, per chunk
   * under a per-chunk policy), or 0: the engine adds it to maxOutputTokens (§5.7).
   */
  reasoningReserveTokens(req: ReserveQuery): number;
  stream(req: NormalizedRequest): AsyncIterable<NormalizedEvent>;
}

export interface ModelInfo {
  id: string;
  displayName?: string;
  contextWindow?: number;
}

/**
 * Result of "Test connection" (§4.2.5, S4 decision 3: success is the status, not the content).
 * `shape` (M4-E6): does the listing look like this protocol's (§4.2.5 steps 1–2: Anthropic's
 * `data[].type == "model"`, OpenAI's `object: "list"`)? Only auto-detect uses it.
 */
export type ProbeResult = { ok: true; models?: ModelInfo[]; shape?: boolean } | { ok: false; error: LLMError };

/** One per wire format (§4.2.2). Same contract as LLMClient.stream for `stream`. */
export interface ProtocolAdapter {
  protocol: Protocol;
  stream(conn: ResolvedConnection, req: NormalizedRequest): AsyncIterable<NormalizedEvent>;
  listModels?(conn: ResolvedConnection): Promise<ModelInfo[]>;
  /** Used by "Test connection". */
  probe(conn: ResolvedConnection): Promise<ProbeResult>;
}
