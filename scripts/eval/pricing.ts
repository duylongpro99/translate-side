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
  // Placeholder: check https://ai.google.dev/pricing and override with --price in,cached,out.
  'gemini-3.5-flash-lite': { input: 0.1, cachedInput: 0.01, output: 0.4, verified: false },
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

/** Uncached input + cache reads + output. `input` includes `cachedInput` (src/llm/types.ts). */
export function costUsd(price: Price, u: { input: number; cachedInput: number; output: number }): number {
  return ((u.input - u.cachedInput) * price.input + u.cachedInput * price.cachedInput + u.output * price.output) / 1e6;
}
