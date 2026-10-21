// What the panel says about a failure: one line per error class (DESIGN.md §4.3.5). The `llm/` and
// `engine/` layers keep English developer messages; the reader sees `LLMError.kind` (and, for a failure the
// shell itself raises, the `ui` tag in `raw`) mapped to the `errors.*` messages.
import { i18n } from '#i18n';
import { BASIC_MISSING_MESSAGE, BUDGET_MESSAGE, DEGRADED_MESSAGE, UNCHECKED_MESSAGE, noBasicReason } from '@/engine/index';
import type { LLMError } from '@/llm/types';

/** `LLMError.raw` of a failure the shell raises: which message says it, and what goes into it. */
export interface UiRaw {
  ui: 'noKey' | 'noProtocol' | 'noAccess' | 'settingsRead' | 'limit' | 'noExplanation' | 'explainNeedsModel' | 'noTranslation' | OnDeviceUi;
  args?: string[];
}

/**
 * The on-device route can't run yet (src/entrypoints/sidepanel/route.ts): `onDeviceSetup` and
 * `onDeviceDownloading` with `[engine, from, to]`, `onDeviceUnavailable` with `[reason, from, to]`.
 */
export type OnDeviceUi = 'onDeviceSetup' | 'onDeviceDownloading' | 'onDeviceNoSource' | 'onDeviceUnavailable';

/** A failure the shell raises: `message` stays the developer's English, `ui` picks the message the reader sees. */
export function uiError(kind: LLMError['kind'], message: string, ui: UiRaw['ui'], args: string[] = [], cause?: LLMError['cause']): LLMError {
  const raw: UiRaw = { ui, args };
  return { kind, message, raw, ...(cause === undefined ? {} : { cause }) };
}

const uiOf = (error: LLMError): UiRaw | undefined => {
  const raw = error.raw as Partial<UiRaw> | undefined;
  return typeof raw?.ui === 'string' ? (raw as UiRaw) : undefined;
};

/** Why Chrome's translator could not stand in either, when the engine says so (its message is English). */
export function noBasicText(error: LLMError): string | undefined {
  const reason = noBasicReason(error);
  if (reason === undefined) return undefined;
  if (reason === BASIC_MISSING_MESSAGE) return i18n.t('errors.noBasicMissing');
  // `basicUnavailableMessage(model, from, to)`, taken apart again.
  const pair = /^(.+) can't translate (.+) → (.+) on this device, so there is no basic translation either\.$/.exec(reason);
  return pair ? i18n.t('errors.noBasicPair', [pair[1] as string, pair[2] as string, pair[3] as string]) : reason;
}

const hostOf = (message: string) => /^No access to (.+)$/.exec(message)?.[1];

export function failureText(error: LLMError): string {
  // Every provider was down and Chrome's Translator could not help either (M5-E7): say both.
  const basic = noBasicText(error);
  if (basic !== undefined) {
    const cause = (error.raw as { cause?: unknown }).cause;
    const plain: LLMError = { kind: error.kind, message: error.message, ...(error.cause === undefined ? {} : { cause: error.cause }), ...(cause === undefined ? {} : { raw: cause }) };
    return i18n.t('errors.withNoBasic', [failureText(plain), basic.replace(/\.$/, '')]);
  }
  const ui = uiOf(error);
  // One tag, two messages: the browser has no on-device AI at all, or not for this pair.
  if (ui?.ui === 'onDeviceUnavailable') {
    const [reason = 'no-api', from = '', to = ''] = ui.args ?? [];
    return reason === 'pair' ? i18n.t('errors.onDevicePair', [reason, from, to]) : reason === 'setting' ? i18n.t('errors.onDeviceSetting') : i18n.t('errors.onDeviceNoApi');
  }
  // Each tag's message takes the arguments its raiser passes (uiError), so the key is not narrowed to one signature.
  if (ui !== undefined) return (i18n.t as (key: string, subs: string[]) => string)(`errors.${ui.ui}`, ui.args ?? []);
  // The engine's own failures arrive as kind `unknown` with a fixed message (review C-N8).
  switch (error.message) {
    case BUDGET_MESSAGE:
      return i18n.t('errors.budget');
    case DEGRADED_MESSAGE:
    case UNCHECKED_MESSAGE:
      return i18n.t('errors.stopped');
  }
  switch (error.kind) {
    case 'auth':
      return error.message === "Key has characters that can't be sent" ? i18n.t('errors.authCharacters') : i18n.t('errors.auth');
    case 'cors': {
      if (error.cause !== 'permission') return i18n.t('errors.corsOrigin');
      const host = hostOf(error.message);
      return host === undefined ? i18n.t('errors.noAccessProvider') : i18n.t('errors.noAccess', [host]);
    }
    case 'quota':
      return i18n.t('errors.quota', [error.message]);
    case 'rate_limit':
    case 'overloaded':
      return i18n.t('errors.busy');
    case 'network':
      return i18n.t('errors.network');
    case 'context_length':
      return i18n.t('errors.contextLength');
    case 'model_not_found':
      return i18n.t('errors.modelNotFound', [error.message]);
    default:
      return error.message || i18n.t('errors.unknown');
  }
}
