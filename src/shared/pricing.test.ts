import { describe, expect, it } from 'vitest';
import { ANTHROPIC_PRICES, anthropicPrice, pricingFor } from './pricing.ts';
import { ANTHROPIC_CONNECTION, ANTHROPIC_HAIKU_PROFILE, APIBOX_CONNECTION, APIBOX_QWEN_PROFILE, DEFAULT_PROFILE } from './settings.ts';

describe('built-in Anthropic prices (plan M3-E9, M3-D7)', () => {
  it('prices a model id exactly, as a dated snapshot, or with a provider prefix', () => {
    expect(anthropicPrice('claude-haiku-4-5')).toEqual({ inPerM: 1, cachedInPerM: 0.1, outPerM: 5 });
    expect(anthropicPrice('claude-haiku-4-5-20251001')).toEqual(ANTHROPIC_PRICES['claude-haiku-4-5']);
    expect(anthropicPrice('anthropic.claude-opus-5-5')).toEqual({ inPerM: 4, cachedInPerM: 0.2, outPerM: 20 });
    expect(anthropicPrice('claude-sonnet-5-5')).toEqual({ inPerM: 2, cachedInPerM: 0.2, outPerM: 10 });
    expect(anthropicPrice('gpt-unknown')).toBeUndefined();
  });

  it('every entry is a sane price: cache reads cheaper than input, output dearer', () => {
    for (const p of Object.values(ANTHROPIC_PRICES)) {
      expect(p.cachedInPerM).toBeLessThan(p.inPerM);
      expect(p.outPerM).toBeGreaterThan(p.inPerM);
    }
  });

  it('pricingFor: the profile’s own pricing wins; the Anthropic preset gets the built-in price; other presets get none', () => {
    expect(pricingFor(ANTHROPIC_HAIKU_PROFILE, ANTHROPIC_CONNECTION)).toEqual(ANTHROPIC_PRICES['claude-haiku-4-5']);
    expect(pricingFor({ ...ANTHROPIC_HAIKU_PROFILE, pricing: { inPerM: 9, cachedInPerM: 1, outPerM: 9 } }, ANTHROPIC_CONNECTION)).toEqual({ inPerM: 9, cachedInPerM: 1, outPerM: 9 });
    expect(pricingFor(APIBOX_QWEN_PROFILE, APIBOX_CONNECTION)).toEqual(APIBOX_QWEN_PROFILE.pricing);
    expect(pricingFor({ model: 'claude-haiku-4-5' }, APIBOX_CONNECTION)).toBeUndefined();
  });

  it('APIBOX stays the routed default (M3-D7): a fresh install routes translate to it (providers.test.ts)', () => {
    expect(DEFAULT_PROFILE.connectionId).toBe('apibox');
  });
});
