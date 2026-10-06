// What the panel says about a failure: basic status per error class (DESIGN.md §4.3.5; the full
// error UX is M3).
import { BUDGET_MESSAGE, DEGRADED_MESSAGE, UNCHECKED_MESSAGE } from '@/engine/index';
import type { LLMError } from '@/llm/types';

export function failureText(error: LLMError): string {
  // The engine's own failures arrive as kind `unknown` with a fixed message (review C-N8).
  switch (error.message) {
    case BUDGET_MESSAGE:
      return 'skipped, the budget for this page ran out';
    case DEGRADED_MESSAGE:
    case UNCHECKED_MESSAGE:
      return 'the translation stopped unexpectedly';
  }
  switch (error.kind) {
    case 'auth':
      return error.message || 'the API key is invalid or missing';
    case 'cors':
      return error.cause === 'permission' ? error.message || 'no access to the provider' : 'the provider refused this origin (CORS)';
    case 'quota':
      return `no allowance left on this key (${error.message})`;
    case 'rate_limit':
    case 'overloaded':
      return 'the provider is busy; try again in a moment';
    case 'network':
      return 'network error';
    case 'context_length':
      return 'too long for the model';
    case 'model_not_found':
      return `model not found (${error.message})`;
    default:
      return error.message || 'unknown error';
  }
}
