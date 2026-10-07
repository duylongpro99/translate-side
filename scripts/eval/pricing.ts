// USD per million tokens, for the cost column of the harness. `verified: false` marks a number
// that nobody has checked against the vendor's price page; the report says so next to the cost.
export interface Price {
  input: number;
  cachedInput: number;
  output: number;
  verified: boolean;
}

export const PRICES: Record<string, Price> = {
  // DESIGN.md §4.3.3 (Haiku 4.5, $1/$5); cache reads at 10% of input.
  'claude-haiku-4-5-20251001': { input: 1, cachedInput: 0.1, output: 5, verified: true },
  // https://ai.google.dev/gemini-api/docs/pricing, Gemini 3.5 Flash-Lite, standard tier, checked 2026-10-06
  // (supervisor's tester). Override with --price in,cached,out if the page changes.
  'gemini-3.5-flash-lite': { input: 0.3, cachedInput: 0.03, output: 2.5, verified: true },
  // APIBOX (M2-D11), from the gateway's public https://api.ai-box.vn/api/pricing, read 2026-10-07 (pricing_version
  // a42d372c…). It is a new-api gateway: a model ratio of 1 is $2 per million input tokens; output = input ×
  // completion_ratio, cache reads = input × cache_ratio; group "default" ratio 1. These are the gateway's nominal USD:
  // what a quota dollar costs at top-up is set by the gateway (its /api/status says price 7.3, presumably CNY per
  // dollar), so `verified: false` until the user confirms. Ratios between runs are exact either way.
  // ds/deepseek-flash (the M2-D13 translator): model_ratio 0.05, completion_ratio 4, cache_ratio 0.02.
  'ds/deepseek-flash': { input: 0.1, cachedInput: 0.002, output: 0.4, verified: false },
  // ds/deepseek-v4-pro (the judge, M2-D13; the translator from M2-D14): model_ratio 0.22, completion_ratio 3, cache_ratio 0.033181818182.
  'ds/deepseek-v4-pro': { input: 0.44, cachedInput: 0.0146, output: 1.32, verified: false },
  // qwen3.8-flash (M2-D15 trial): model_ratio 0.016, completion_ratio 2.9375, cache_ratio 0.1 (create_cache_ratio 1.25,
  // not modelled). Output includes the reasoning tokens.
  'qwen3.8-flash': { input: 0.032, cachedInput: 0.0032, output: 0.094, verified: false },
  // The offline `--mock` run: no money is spent.
  mock: { input: 0, cachedInput: 0, output: 0, verified: true },
};

export function priceFor(model: string, override?: string): Price | undefined {
  if (override) {
    const [input, cachedInput, output] = override.split(',').map(Number);
    if ([input, cachedInput, output].some((n) => n === undefined || !Number.isFinite(n))) throw new Error('--price expects "input,cachedInput,output" in USD per million tokens');
    return { input: input as number, cachedInput: cachedInput as number, output: output as number, verified: true };
  }
  return PRICES[model];
}

/**
 * Uncached input + cache reads + output. `input` includes `cachedInput` (src/llm/types.ts).
 * Cache writes are priced at the plain input rate here; Anthropic bills them at 1.25x, so a run with
 * cache writes is slightly understated. Owner: M3 (translation cache), when writes are reported separately.
 */
export function costUsd(price: Price, u: { input: number; cachedInput: number; output: number }): number {
  return ((u.input - u.cachedInput) * price.input + u.cachedInput * price.cachedInput + u.output * price.output) / 1e6;
}
