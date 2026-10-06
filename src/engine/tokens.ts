// Token estimate without a tokenizer (plan M1 §5, M1-E2): characters ÷ 3.5, the rate for Latin
// scripts. Used by the chunker and the output budget (budget.ts). To be tuned with harness data.

export const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
