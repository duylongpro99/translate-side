import { describe, expect, it } from 'vitest';
import { LOCAL_PROFILE, PICKER_GROUPS, PRESETS, presetFor, ROLE_LABELS } from './presets.ts';

describe('presets (DESIGN §4.3.2, plan M4-E3)', () => {
  it('has every §4.3.2 row with its protocol, base URL and auth', () => {
    const row = (id: string) => {
      const p = presetFor(id);
      return [p.protocol, p.baseUrl, p.auth];
    };
    expect(row('anthropic')).toEqual(['anthropic-messages', 'https://api.anthropic.com', 'x-api-key']);
    expect(row('openai')).toEqual(['openai-chat', 'https://api.openai.com/v1', 'bearer']);
    expect(row('gemini')).toEqual(['openai-chat', 'https://generativelanguage.googleapis.com/v1beta/openai', 'bearer']);
    expect(row('openrouter')).toEqual(['openai-chat', 'https://openrouter.ai/api/v1', 'bearer']);
    expect(row('ollama')).toEqual(['openai-chat', 'http://localhost:11434/v1', 'none']);
    expect(row('ollama-cloud')).toEqual(['openai-chat', 'https://ollama.com/v1', 'bearer']);
    expect(row('lmstudio')).toEqual(['openai-chat', 'http://localhost:1234/v1', 'none']);
    expect(row('custom-openai')).toEqual(['openai-chat', '', 'bearer']);
    expect(row('custom-anthropic')).toEqual(['anthropic-messages', '', 'x-api-key']);
    expect(row('custom-auto')).toEqual(['auto', '', 'bearer']);
    expect(presetFor('openai').quirks).toEqual({ maxTokensParam: 'max_completion_tokens' });
    expect(presetFor('anthropic').defaultModel).toBe('claude-haiku-4-5');
  });

  it('local presets: one request at a time and smaller chunks (plan M4 §5 "Local model chunking")', () => {
    expect(presetFor('ollama').profile).toEqual(LOCAL_PROFILE);
    expect(presetFor('lmstudio').profile).toEqual(LOCAL_PROFILE);
    expect(LOCAL_PROFILE.maxConcurrency).toBe(1);
    expect(LOCAL_PROFILE.chunkTokens).toBeLessThan(presetFor('anthropic').profile.chunkTokens);
  });

  it('Ollama cloud: maxConcurrency 4 and a chat-call key check (S4); OpenRouter checks its key the same way', () => {
    expect(presetFor('ollama-cloud')).toMatchObject({ keyCheck: 'chat', profile: { maxConcurrency: 4 } });
    expect(presetFor('openrouter').keyCheck).toBe('chat');
    expect(presetFor('anthropic').keyCheck).toBe('list');
  });

  it('Custom presets offer API format and auth choices', () => {
    expect(presetFor('custom-auto').authChoices).toEqual(['bearer', 'x-api-key', 'custom-header', 'none']);
    expect(PRESETS.filter((p) => p.custom).map((p) => p.id)).toEqual(['custom-openai', 'custom-anthropic', 'custom-auto']);
  });

  it('an unknown preset id falls back to the Custom preset of its protocol', () => {
    expect(presetFor('later-vendor', 'anthropic-messages').id).toBe('custom-anthropic');
    expect(presetFor('later-vendor', 'auto').id).toBe('custom-auto');
    expect(presetFor('later-vendor').id).toBe('custom-openai');
  });

  it('the picker lists every preset once', () => {
    const ids = PICKER_GROUPS.flatMap((g) => g.presets.map((p) => p.id));
    expect(ids.slice().sort()).toEqual(PRESETS.map((p) => p.id).sort());
  });

  it('names the analyze role "Document brief" (plan M4 §5 Role naming)', () => {
    expect(ROLE_LABELS.analyze).toBe('Document brief');
  });
});
