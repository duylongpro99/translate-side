// Connection presets, as constants until provider management (M4). Dependency-free, so the options
// page can read them without pulling in an SDK.
import type { Quirks } from './types.ts';

/** Gemini's OpenAI-compatible endpoint (M1-D5): the historical M1/M2 baseline's provider. */
export const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

/** APIBOX, an OpenAI-compatible gateway (user decision M2-D11): the default from M2 Phase C on. */
export const APIBOX_BASE_URL = 'https://api.ai-box.vn/v1';

/**
 * APIBOX's DeepSeek models (ds/deepseek-flash, ds/deepseek-v4-pro), probed 2026-10-07: both think
 * by default, and the thinking (`delta.reasoning_content`, never shown as text) counts against
 * `max_tokens`. A 200-token translation came back empty, cut by `length`. `reasoning_effort: "none"`
 * switches it off (no reasoning tokens at all; for v4-pro also re-probed on a 911-token
 * streamed translation, finish "stop"), "low" still thinks. Temperature, the stream usage
 * chunk and `response_format: json_object` all work. So: thinking off, no reserve (DESIGN §4.2.4, §5.7).
 */
export const APIBOX_DEEPSEEK_QUIRKS: Quirks = { reasoning: { control: 'effort', lowest: 'off', reserveTokens: 0 } };

/**
 * The judge (ds/deepseek-v4-pro, M2-D13) thinks: effort "medium" (accepted, probed 2026-10-07),
 * pinned so a server-side default can't change the scores. The reserve keeps the score JSON from
 * being cut by thinking that counts against max_tokens.
 */
export const APIBOX_JUDGE_QUIRKS: Quirks = { reasoning: { control: 'effort', lowest: 'medium', reserveTokens: 16000 } };

/**
 * APIBOX's qwen3.8-flash, the translator from M2-D16, probed 2026-10-07. It thinks by default
 * (`reasoning_content`); `reasoning_effort` "none" switches it off, "minimal" and "low" still think
 * but bound nothing: a hard prompt at "minimal" thought for minutes. `max_tokens` does not bound the
 * thinking, `thinking_budget` and `reasoning.max_tokens` are ignored; `max_completion_tokens` caps
 * thinking and text together (finish "length"). So: chunk 1 thinking off for a fast first segment,
 * later chunks "minimal" (M2-D16), analyze off; `max_completion_tokens` with a reserve is the guard
 * against runaway thinking (a call that hits it ends `max_tokens`, and the engine's repair path takes over).
 */
export const QWEN_THINKING_RESERVE_TOKENS = 3000;
export const APIBOX_QWEN_QUIRKS: Quirks = {
  maxTokensParam: 'max_completion_tokens',
  reasoning: { control: 'effort', lowest: 'off', reserveTokens: 0, byChunk: [{ fromChunk: 1, lowest: 'minimal', reserveTokens: QWEN_THINKING_RESERVE_TOKENS }] },
};
