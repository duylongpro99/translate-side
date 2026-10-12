// Test connection (DESIGN.md §4.3.3 A step 3, plan M4-E5), auto-detect and the URL-mistake fixer
// (§4.2.5, M4-E6), and what the settings say about each failure (§4.3.5, §4.3.6, M4-E12). Pure:
// the adapters and the permission check come in as ports, so every path is unit-tested without a
// network. The permission request itself is the caller's (it must be the first call in the click).
import { i18n } from '#i18n';
import type { AuthStyle, LLMError, ModelInfo, NormalizedRequest, Protocol, ProtocolAdapter, Quirks, ResolvedConnection } from '@/llm/types';
import { checkBaseUrl, HTTPS_REQUIRED } from '@/llm/errors';
import type { ConnectionPreset } from './presets.ts';

// ---- Base URL fixes (§4.2.5 last paragraph) --------------------------------------------------

export type UrlFixReason = 'endpoint' | 'double-v1' | 'missing-v1' | 'anthropic-v1';

export interface UrlFix {
  reason: UrlFixReason;
  from: string;
  to: string;
}

/** What a base URL fix said it did, in the reader's language. */
export const urlFixText = (reason: UrlFixReason): string => {
  switch (reason) {
    case 'endpoint':
      return i18n.t('options.connect.fixEndpoint');
    case 'double-v1':
      return i18n.t('options.connect.fixDoubleV1');
    case 'missing-v1':
      return i18n.t('options.connect.fixMissingV1');
    case 'anthropic-v1':
      return i18n.t('options.connect.fixAnthropicV1');
  }
};

/** Endpoint paths people paste into the base URL field. */
const ENDPOINT_SUFFIX = /\/(?:chat\/completions|completions|messages|models|responses)\/?$/i;
const DOUBLE_V1 = /\/v1\/v1(?=\/|$)/i;
/** A version segment anywhere in the path: /v1, /v1beta, /api/v2… (Gemini's is /v1beta/openai). */
const VERSION_SEGMENT = /\/v\d+(?:alpha|beta)?\d*(?=\/|$)/i;

const trimSlashes = (url: string) => url.replace(/\/+$/, '');

/**
 * The base URL with the mistakes that are certain fixed: whitespace and trailing slashes (silent),
 * a pasted endpoint path, `/v1/v1`. A URL that does not parse is returned trimmed (Test
 * connection then says it is invalid).
 */
export function fixBaseUrl(raw: string): { url: string; fixes: UrlFix[] } {
  let url = trimSlashes(raw.trim());
  const fixes: UrlFix[] = [];
  if (checkBaseUrl(url) !== null) return { url, fixes };
  const start = url;
  while (ENDPOINT_SUFFIX.test(url)) url = trimSlashes(url.replace(ENDPOINT_SUFFIX, ''));
  if (url !== start) fixes.push({ reason: 'endpoint', from: start, to: url });
  const before = url;
  while (DOUBLE_V1.test(url)) url = url.replace(DOUBLE_V1, '/v1');
  if (url !== before) fixes.push({ reason: 'double-v1', from: before, to: url });
  return { url, fixes };
}

/** The base URL the Anthropic SDK takes: it appends `/v1/messages` itself, so a trailing `/v1` would be doubled. */
export function anthropicBase(baseUrl: string): string {
  return trimSlashes(baseUrl).replace(/\/v1$/i, '');
}

/** The base URL a request on `protocol` goes to (settings.ts resolveConnection applies it at runtime). */
export function endpointBase(protocol: Protocol, baseUrl: string): string {
  return protocol === 'anthropic-messages' ? anthropicBase(baseUrl) : trimSlashes(baseUrl);
}

/** OpenAI-compatible APIs live under a version: a base URL without one is tried with `/v1` on a 404. */
export const hasVersionSegment = (baseUrl: string) => {
  try {
    return VERSION_SEGMENT.test(new URL(baseUrl).pathname);
  } catch {
    return false;
  }
};

// ---- Model ids ------------------------------------------------------------------------------

/**
 * The model list as the settings show and save it: without the prefix the connection's
 * `modelIdPrefix` quirk names (the Gemini preset sets `models/`; the bare id works too), so the
 * ids read like the provider's docs and the built-in profiles (tester C1 #5, review C3 #2).
 */
export function displayModels(quirks: Quirks, models: readonly ModelInfo[]): ModelInfo[] {
  const prefix = quirks.modelIdPrefix;
  if (!prefix) return [...models];
  return models.map((m) => (m.id.startsWith(prefix) ? { ...m, id: m.id.slice(prefix.length) } : m));
}

// ---- Test connection --------------------------------------------------------------------------

export interface TestInput {
  preset: ConnectionPreset;
  /** The protocol picked in the form; `auto` probes both (§4.2.5). */
  protocol: Protocol | 'auto';
  baseUrl: string;
  auth: { style: AuthStyle; headerName?: string };
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  quirks: Quirks;
  /** The model in the form: the 1-token call uses it (so a wrong one reads "Model not found"). */
  model?: string;
}

export interface TestPorts {
  adapter: (protocol: Protocol) => ProtocolAdapter;
  hasHostPermission: () => Promise<boolean>;
  signal?: AbortSignal;
}

/** One protocol's outcome. `models` once the listing answered; `error` on the first failure. */
export interface ProtocolCheck {
  protocol: Protocol;
  baseUrl: string;
  models?: ModelInfo[];
  /** The model the 1-token call used; undefined when none was chosen (the key is then checked by the listing only). */
  chatModel?: string;
  /** The auth this protocol was tried with (on Auto-detect, its own style, §4.2.5 step 1). */
  auth: TestInput['auth'];
  error?: LLMError;
}

export type TestResult =
  | {
      ok: true;
      /** The protocol to save: the only one that works, or the model-family choice when both do. */
      protocol: Protocol;
      /** Every protocol that worked (both on a dual-protocol gateway). */
      detected: Protocol[];
      /** The base URL to save, fixes applied. */
      baseUrl: string;
      models: ModelInfo[];
      fixes: UrlFix[];
      /** No model was chosen, so no 1-token call was made: pick one from the list and test again. */
      modelUnchecked?: boolean;
      /** And this preset checks its key with that call, so the key is not checked yet. */
      keyUnchecked?: boolean;
      /** The auth to save: the chosen protocol's. */
      auth: TestInput['auth'];
      /** On a dual-protocol gateway whose two paths took different auth styles, each one's. */
      authByProtocol?: Partial<Record<Protocol, TestInput['auth']>>;
      checks: ProtocolCheck[];
    }
  | { ok: false; error: LLMError; baseUrl: string; fixes: UrlFix[]; models?: ModelInfo[]; protocol?: Protocol; checks: ProtocolCheck[] };

/** `vendor/claude-…` (OpenRouter) or `claude-…`: a Claude model, for the dual-protocol choice. */
export const isClaudeModel = (model: string | undefined) => model !== undefined && /^(?:[\w.-]+\/)?claude-/i.test(model.trim());

/**
 * §4.2.5 step 4 and plan M4 §5 "Dual-protocol gateway default": `claude-*` → Anthropic Messages
 * (prompt caching works fully), anything else → OpenAI Chat.
 */
export const preferredProtocol = (model: string | undefined): Protocol => (isClaudeModel(model) ? 'anthropic-messages' : 'openai-chat');

/**
 * The auth a protocol is first tried with. On Auto-detect each path gets its own style (§4.2.5
 * step 1: the Anthropic one x-api-key, which the SDK sends with anthropic-version; the OpenAI one
 * Bearer); a custom header or no auth is the user's choice and is kept for both.
 */
export function autoAuth(input: Pick<TestInput, 'protocol' | 'auth'>, protocol: Protocol): TestInput['auth'] {
  if (input.protocol !== 'auto' || input.auth.style === 'custom-header' || input.auth.style === 'none') return input.auth;
  return { style: protocol === 'anthropic-messages' ? 'x-api-key' : 'bearer' };
}

function resolved(input: TestInput, protocol: Protocol, baseUrl: string, hasHostPermission: () => Promise<boolean>, auth: TestInput['auth'] = input.auth): ResolvedConnection {
  return {
    id: 'test',
    protocol,
    baseUrl,
    auth,
    ...(input.apiKey === undefined || input.apiKey === '' ? {} : { apiKey: input.apiKey.trim() }),
    ...(input.extraHeaders ? { extraHeaders: input.extraHeaders } : {}),
    ...(input.queryParams ? { queryParams: input.queryParams } : {}),
    quirks: structuredClone(input.quirks),
    hasHostPermission,
  };
}

/** A 1-token request (§4.3.3 step 3): success is the status (S4 decision 3), whatever the reply says. */
async function chatOnce(adapter: ProtocolAdapter, conn: ResolvedConnection, model: string, signal: AbortSignal): Promise<LLMError | null> {
  const req: NormalizedRequest = { model, system: '', messages: [{ role: 'user', content: 'Hi' }], maxOutputTokens: 1, signal };
  for await (const event of adapter.stream(conn, req)) {
    if (event.type === 'error') return event.error;
    if (event.type === 'done') return null;
  }
  return null;
}

const isWrongPath = (e: LLMError) => e.kind === 'bad_request' && e.status === 404;

/** A listing that answered, but not in the protocol's shape (Auto-detect only). */
const shapeMismatch = (protocol: Protocol): LLMError => ({ kind: 'bad_request', message: `The model list is not ${protocol === 'anthropic-messages' ? 'Anthropic' : 'OpenAI'}-shaped` });
/** Auto-detect when both listings answered, neither in its protocol's shape (review C2 N3). */
const NEITHER_FORMAT = 'Neither format answered as expected; check the base URL.';
const isShapeMismatch = (c: ProtocolCheck) => c.error !== undefined && c.error.message === shapeMismatch(c.protocol).message;

async function checkProtocol(input: TestInput, protocol: Protocol, base: string, ports: TestPorts, signal: AbortSignal): Promise<ProtocolCheck & { fix?: UrlFix }> {
  const adapter = ports.adapter(protocol);
  let baseUrl = endpointBase(protocol, base);
  let auth = autoAuth(input, protocol);
  let fix: UrlFix | undefined;
  let probe = await adapter.probe(resolved(input, protocol, baseUrl, ports.hasHostPermission, auth));
  // A gateway may take Bearer on its Anthropic path too (OpenRouter does): tried once on Auto-detect.
  if (!probe.ok && probe.error.kind === 'auth' && input.protocol === 'auto' && auth.style === 'x-api-key') {
    const bearer: TestInput['auth'] = { style: 'bearer' };
    const retry = await adapter.probe(resolved(input, protocol, baseUrl, ports.hasHostPermission, bearer));
    if (retry.ok) {
      auth = bearer;
      probe = retry;
    }
  }
  // §4.2.5: a missing /v1. Only tried where the API needs a version and the URL has none.
  if (!probe.ok && isWrongPath(probe.error) && protocol === 'openai-chat' && !hasVersionSegment(baseUrl)) {
    const withV1 = `${baseUrl}/v1`;
    const retry = await adapter.probe(resolved(input, protocol, withV1, ports.hasHostPermission, auth));
    if (retry.ok) {
      fix = { reason: 'missing-v1', from: baseUrl, to: withV1 };
      baseUrl = withV1;
      probe = retry;
    }
  }
  if (!probe.ok) return { protocol, baseUrl, auth, error: probe.error };
  // §4.2.5 steps 1–2: on Auto-detect a protocol is a candidate only when its listing has that
  // protocol's shape (a 200 from a gateway that lists for both is not enough).
  if (input.protocol === 'auto' && probe.shape !== true) return { protocol, baseUrl, auth, error: shapeMismatch(protocol) };
  const models = displayModels(input.quirks, probe.models ?? []);
  // Only the model the user chose: a listed one picked for them may be outside their plan, and its
  // refusal would read as a problem with the key (tester C1 #6).
  const chatModel = input.model?.trim() || undefined;
  const out: ProtocolCheck & { fix?: UrlFix } = { protocol, baseUrl, auth, models, ...(fix ? { fix } : {}) };
  if (chatModel === undefined) return out;
  const error = await chatOnce(adapter, resolved(input, protocol, baseUrl, ports.hasHostPermission, auth), chatModel, signal);
  return { ...out, chatModel, ...(error ? { error } : {}) };
}

/** Which failure to show when every protocol failed: the one that got furthest, then the most actionable kind. */
const KIND_RANK: readonly LLMError['kind'][] = ['auth', 'quota', 'cors', 'model_not_found', 'rate_limit', 'overloaded', 'context_length', 'network', 'bad_request', 'unknown'];
function worstFirst(checks: readonly ProtocolCheck[]): ProtocolCheck | undefined {
  const failed = checks.filter((c) => c.error !== undefined);
  return failed.sort((a, b) => Number(b.models !== undefined) - Number(a.models !== undefined) || KIND_RANK.indexOf((a.error as LLMError).kind) - KIND_RANK.indexOf((b.error as LLMError).kind))[0];
}

/**
 * Test connection: list models (the key and the URL), then a 1-token call with the form's model
 * (the model), on the preset's protocol or, on Auto-detect, on both (§4.2.5 steps 1–4). Fixes
 * certain URL mistakes first and tries a missing `/v1` on a 404. Never throws for a failed
 * request: the result carries the classified error.
 */
export async function testConnection(input: TestInput, ports: TestPorts): Promise<TestResult> {
  const signal = ports.signal ?? new AbortController().signal;
  const { url, fixes } = fixBaseUrl(input.baseUrl);
  const invalid = checkBaseUrl(url);
  if (invalid !== null) return { ok: false, error: invalid, baseUrl: url, fixes, checks: [] };
  const protocols: Protocol[] = input.protocol === 'auto' ? ['anthropic-messages', 'openai-chat'] : [input.protocol];
  const checks: (ProtocolCheck & { fix?: UrlFix })[] = [];
  for (const protocol of protocols) checks.push(await checkProtocol(input, protocol, url, ports, signal));
  const working = checks.filter((c) => c.error === undefined);
  if (working.length === 0) {
    if (checks.length > 1 && checks.every(isShapeMismatch)) {
      return { ok: false, error: { kind: 'bad_request', message: NEITHER_FORMAT }, baseUrl: url, fixes, checks };
    }
    const shown = worstFirst(checks) as ProtocolCheck;
    return { ok: false, error: shown.error as LLMError, baseUrl: shown.baseUrl, fixes, protocol: shown.protocol, ...(shown.models ? { models: shown.models } : {}), checks };
  }
  const detected = working.map((c) => c.protocol);
  const model = input.model?.trim() || undefined;
  const chosen = working.find((c) => c.protocol === preferredProtocol(model)) ?? (working[0] as ProtocolCheck & { fix?: UrlFix });
  // What is saved: on Auto-detect the OpenAI-style URL when that works (the Anthropic one is
  // derived from it at runtime); otherwise the URL of the protocol that works.
  const saved = working.find((c) => c.protocol === 'openai-chat') ?? chosen;
  const allFixes = [...fixes, ...(saved.fix ? [saved.fix] : [])];
  if (saved.protocol === 'anthropic-messages' && saved.baseUrl !== url) allFixes.push({ reason: 'anthropic-v1', from: url, to: saved.baseUrl });
  const modelUnchecked = model === undefined;
  const keyUnchecked = input.preset.keyCheck === 'chat' && modelUnchecked;
  const differ = working.some((c) => c.auth.style !== chosen.auth.style);
  const authByProtocol = differ ? Object.fromEntries(working.map((c) => [c.protocol, c.auth])) : undefined;
  return {
    ok: true,
    protocol: chosen.protocol,
    detected,
    baseUrl: saved.baseUrl,
    models: chosen.models ?? [],
    fixes: allFixes,
    ...(modelUnchecked ? { modelUnchecked } : {}),
    ...(keyUnchecked ? { keyUnchecked } : {}),
    auth: chosen.auth,
    ...(authByProtocol ? { authByProtocol } : {}),
    checks,
  };
}

// ---- What the settings say (§4.3.5, §4.3.6) ---------------------------------------------------

export type ConnectAction =
  /** Focus the key field. */
  | 'fix-key'
  /** Ask for the host permission again. */
  | 'grant'
  /** Open the CORS guide for the local server (§4.3.6). */
  | 'cors-guide'
  /** Show a command to run (ollama pull, ollama serve). */
  | 'command'
  /** Replace the base URL with `suggestion`. */
  | 'use-url'
  /** Try again later. */
  | 'retry';

export interface ConnectMessage {
  /** Short status for the connection list: "Key invalid", "CORS blocked"… */
  status: string;
  /** One or two sentences: what happened and what to do. */
  text: string;
  action?: ConnectAction;
  /** For `command`: the exact command to run. */
  command?: string;
  /** For `use-url`. */
  suggestion?: string;
}

export interface MessageContext {
  preset: ConnectionPreset;
  baseUrl: string;
  model?: string | undefined;
  /** A base URL the fixer would try instead, for "Wrong base URL". */
  suggestion?: string | undefined;
  /** No key in the form (auth other than none). */
  noKey?: boolean;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const LOCAL_NAMES = { ollama: 'Ollama', lmstudio: 'LM Studio' } as const;

/**
 * The friendly message for a failed test (plan M4 §3 #5: bad key, CORS / origin blocked, model
 * not found, wrong base URL, each with its own text and fix).
 */
export function connectMessage(error: LLMError, ctx: MessageContext): ConnectMessage {
  const host = hostOf(ctx.baseUrl);
  const local = ctx.preset.local;
  const server = local ? LOCAL_NAMES[local] : host;
  switch (error.kind) {
    case 'auth':
      if (ctx.noKey) return { status: i18n.t('options.connect.noKeyStatus'), text: i18n.t('options.connect.noKey', { provider: ctx.preset.label }), action: 'fix-key' };
      return { status: i18n.t('options.connect.keyInvalidStatus'), text: i18n.t('options.connect.keyInvalid', { server }), action: 'fix-key' };
    case 'quota':
      return { status: i18n.t('options.connect.noAllowanceStatus'), text: i18n.t('options.connect.noAllowance', { server, reason: error.message }) };
    case 'cors':
      if (error.cause === 'permission') return { status: i18n.t('options.connect.noAccessStatus'), text: i18n.t('options.connect.noAccess', { host }), action: 'grant' };
      return {
        status: i18n.t('options.connect.corsStatus'),
        text: local === 'lmstudio' ? i18n.t('options.connect.corsLmStudio') : i18n.t('options.connect.cors', { server }),
        action: 'cors-guide',
      };
    case 'model_not_found': {
      const model = ctx.model?.trim() || i18n.t('options.connect.thatModel');
      if (local === 'ollama' && ctx.model) return { status: i18n.t('options.connect.notPulledStatus'), text: i18n.t('options.connect.notPulled', { model }), action: 'command', command: `ollama pull ${ctx.model.trim()}` };
      return { status: i18n.t('options.connect.modelNotFoundStatus'), text: i18n.t('options.connect.modelNotFound', { server, model }) };
    }
    case 'network':
      if (local === 'ollama') return { status: i18n.t('options.connect.notRunningStatus'), text: i18n.t('options.connect.notRunningOllama', { host }), action: 'command', command: 'ollama serve' };
      if (local === 'lmstudio') return { status: i18n.t('options.connect.notRunningStatus'), text: i18n.t('options.connect.notRunningLmStudio', { host }), action: 'retry' };
      return { status: i18n.t('options.connect.notReachableStatus'), text: i18n.t('options.connect.notReachable', { host }), action: 'retry' };
    case 'rate_limit':
    case 'overloaded':
      return { status: i18n.t('options.connect.busyStatus'), text: i18n.t('options.connect.busy', { server, reason: error.message }), action: 'retry' };
    case 'bad_request':
      if (error.status === 404) {
        const api = i18n.t(ctx.preset.protocol === 'auto' ? 'options.connect.apiEither' : ctx.preset.protocol === 'anthropic-messages' ? 'options.connect.apiAnthropic' : 'options.connect.apiOpenai');
        const text = i18n.t('options.connect.wrongUrl', { url: ctx.baseUrl, api });
        const status = i18n.t('options.connect.wrongUrlStatus');
        return ctx.suggestion ? { status, text: i18n.t('options.connect.wrongUrlSuggest', { text, suggestion: ctx.suggestion }), action: 'use-url', suggestion: ctx.suggestion } : { status, text };
      }
      if (error.message === NEITHER_FORMAT) return { status: i18n.t('options.connect.wrongUrlStatus'), text: i18n.t('options.connect.neitherFormat') };
      if (error.message === HTTPS_REQUIRED) return { status: i18n.t('options.connect.httpsOnlyStatus'), text: i18n.t('options.connect.httpsOnly') };
      if (error.status === undefined && /base URL/i.test(error.message)) return { status: i18n.t('options.connect.invalidUrlStatus'), text: i18n.t('options.connect.invalidUrl') };
      return { status: i18n.t('options.connect.failedStatus'), text: error.message };
    default:
      return { status: i18n.t('options.connect.failedStatus'), text: error.message };
  }
}

// ---- The local-server guides (§4.3.6) ---------------------------------------------------------

export interface GuideStep {
  os: 'macOS' | 'Windows' | 'Linux' | 'All';
  /** What to do, in words. */
  text: string;
  /** The exact command, when there is one. */
  command?: string;
  /** What to do after the command. */
  after?: string;
}

/** The origin Ollama must allow (§4.3.6). */
export const OLLAMA_ORIGINS = 'chrome-extension://*';

/** Which guide a local server gets: its own, or the generic one (a Custom connection on localhost). */
export type GuideKind = 'ollama' | 'lmstudio' | 'generic';

export function corsGuide(local: GuideKind): { title: string; steps: GuideStep[] } {
  if (local === 'generic') {
    return {
      title: i18n.t('options.connect.guideGenericTitle'),
      steps: [
        {
          os: 'All',
          text: i18n.t('options.connect.guideGenericText', { origin: OLLAMA_ORIGINS }),
          after: i18n.t('options.connect.guideGenericAfter'),
        },
      ],
    };
  }
  if (local === 'lmstudio') {
    return {
      title: i18n.t('options.connect.guideLmStudioTitle'),
      steps: [{ os: 'All', text: i18n.t('options.connect.guideLmStudioText') }],
    };
  }
  return {
    title: i18n.t('options.connect.guideOllamaTitle'),
    steps: [
      { os: 'macOS', text: i18n.t('options.connect.guideMacText'), command: `launchctl setenv OLLAMA_ORIGINS "${OLLAMA_ORIGINS}"`, after: i18n.t('options.connect.guideMacAfter') },
      { os: 'Windows', text: i18n.t('options.connect.guideWinText'), command: `setx OLLAMA_ORIGINS "${OLLAMA_ORIGINS}"`, after: i18n.t('options.connect.guideWinAfter') },
      {
        os: 'Linux',
        text: i18n.t('options.connect.guideLinuxText'),
        command: `sudo mkdir -p /etc/systemd/system/ollama.service.d && printf '[Service]\\nEnvironment="OLLAMA_ORIGINS=${OLLAMA_ORIGINS}"\\n' | sudo tee /etc/systemd/system/ollama.service.d/origins.conf && sudo systemctl daemon-reload && sudo systemctl restart ollama`,
        after: i18n.t('options.connect.guideLinuxAfter', { command: `OLLAMA_ORIGINS="${OLLAMA_ORIGINS}" ollama serve` }),
      },
    ],
  };
}
