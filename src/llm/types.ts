// LLMClient interface (DESIGN.md §4.2.1). The engine depends on this file only, never on
// adapter implementations. Placeholder until M1 defines the normalized contract.

export type ModelRole = 'analyze' | 'translate' | 'review';

export interface LLMRequest {
  role: ModelRole;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
}

export type LLMEvent =
  | { type: 'text'; text: string }
  | { type: 'usage'; input: number; output: number }
  | { type: 'done'; stopReason: 'end' | 'max_tokens' | 'other' };

export interface LLMClient {
  stream(req: LLMRequest, signal: AbortSignal): AsyncIterable<LLMEvent>;
}
