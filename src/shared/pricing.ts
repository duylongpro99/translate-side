// Built-in Anthropic prices (plan M3-E9, decision M3-D7): a model profile on the Anthropic preset
// is priced from this table when it carries no `pricing` of its own; any other profile uses its
// own `pricing` (settings.ts), and one with none stays unpriced (tokens counted, no USD).
// Dependency-free, so the options page can read it.
import type { ModelProfile, ProviderConnection } from './settings.ts';

export type Pricing = NonNullable<ModelProfile['pricing']>;

/**
 * USD per million tokens, Anthropic's first-party API rates (claude-api reference table, cached
 * 2026-10-06). Cache reads are 10% of input unless the vendor names another rate (Opus 5.5 and
 * Sonnet 5.5 $0.20, Fable 5.1 $0.25). Cache writes are priced as plain input (cost.ts). Claude
 * Haiku 5.5's rate is for prompts up to 100K tokens; a chunk of this extension never comes near.
 */
export const ANTHROPIC_PRICES: Readonly<Record<string, Pricing>> = {
  'claude-fable-5-1': { inPerM: 10, cachedInPerM: 0.25, outPerM: 50 },
  'claude-fable-5': { inPerM: 10, cachedInPerM: 1, outPerM: 50 },
  'claude-opus-5-5': { inPerM: 4, cachedInPerM: 0.2, outPerM: 20 },
  'claude-opus-5': { inPerM: 5, cachedInPerM: 0.5, outPerM: 25 },
  'claude-opus-4-8': { inPerM: 5, cachedInPerM: 0.5, outPerM: 25 },
  'claude-opus-4-7': { inPerM: 5, cachedInPerM: 0.5, outPerM: 25 },
  'claude-opus-4-6': { inPerM: 5, cachedInPerM: 0.5, outPerM: 25 },
  'claude-sonnet-5-5': { inPerM: 2, cachedInPerM: 0.2, outPerM: 10 },
  'claude-sonnet-5': { inPerM: 2, cachedInPerM: 0.2, outPerM: 10 },
  'claude-sonnet-4-6': { inPerM: 3, cachedInPerM: 0.3, outPerM: 15 },
  'claude-haiku-5-5': { inPerM: 0.1, cachedInPerM: 0.01, outPerM: 0.5 },
  // DESIGN.md §4.3.3, §6 ($1 / $5).
  'claude-haiku-4-5': { inPerM: 1, cachedInPerM: 0.1, outPerM: 5 },
};

/**
 * The built-in price of an Anthropic model id. A dated snapshot id (`claude-haiku-4-5-20251001`)
 * or a provider prefix (`anthropic.`) prices as its base model.
 */
export function anthropicPrice(model: string): Pricing | undefined {
  const id = model.trim().toLowerCase().replace(/^anthropic\./, '');
  const exact = ANTHROPIC_PRICES[id];
  if (exact) return exact;
  const base = id.replace(/-\d{8}$/, '').replace(/@\d{8}$/, '');
  return ANTHROPIC_PRICES[base];
}

/** The profile's own pricing; else, on the Anthropic preset, the built-in price; else none. */
export function pricingFor(profile: Pick<ModelProfile, 'model' | 'pricing'>, connection: Pick<ProviderConnection, 'presetId'>): Pricing | undefined {
  if (profile.pricing) return profile.pricing;
  return connection.presetId === 'anthropic' ? anthropicPrice(profile.model) : undefined;
}
