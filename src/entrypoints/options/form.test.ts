import { describe, expect, it } from 'vitest';
import type { TestResult } from '@/shared/connect';
import { presetFor } from '@/shared/presets';
import { ANTHROPIC_CONNECTION } from '@/shared/settings';
import { draftFromConnection, draftFromPreset, fieldsFor, originMoved, parseLines, quirksOf, testInputOf, toConnection, toProfile, usableStoredKey } from './form.ts';

const passed = (over: Partial<Extract<TestResult, { ok: true }>> = {}): TestResult => ({ ok: true, protocol: 'openai-chat', detected: ['openai-chat'], baseUrl: 'https://gw.example.com/v1', models: [], fixes: [], checks: [], ...over });

describe('connection form (plan M4-E3)', () => {
  it('shows only the relevant fields per preset (§4.3.3 step 1)', () => {
    expect(fieldsFor(presetFor('anthropic'), 'x-api-key')).toEqual({ baseUrl: false, apiFormat: false, auth: false, key: true, advanced: true });
    expect(fieldsFor(presetFor('ollama'), 'none')).toEqual({ baseUrl: true, apiFormat: false, auth: false, key: false, advanced: true });
    expect(fieldsFor(presetFor('custom-auto'), 'bearer')).toEqual({ baseUrl: true, apiFormat: true, auth: true, key: true, advanced: true });
    expect(fieldsFor(presetFor('custom-openai'), 'none').key).toBe(false);
  });

  it('starts from the preset: its label, base URL, auth, model and quirk toggles', () => {
    expect(draftFromPreset('openai')).toMatchObject({ label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', authStyle: 'bearer', model: 'gpt-5-mini', toggles: { maxCompletionTokens: true, noTemperature: false, noSystemRole: false } });
    expect(draftFromPreset('custom-openai')).toMatchObject({ label: '', baseUrl: '', protocol: 'openai-chat' });
  });

  it('reads extra headers and query params one per line', () => {
    expect(parseLines('HTTP-Referer: https://x.example\n\nX-Title:Translate Side\nbad line', ':')).toEqual({ 'HTTP-Referer': 'https://x.example', 'X-Title': 'Translate Side' });
    expect(parseLines('api-version=2024-10-21', '=')).toEqual({ 'api-version': '2024-10-21' });
    expect(parseLines('  \n', '=')).toBeUndefined();
  });

  it('applies the quirk toggles over the stored quirks, keeping the rest', () => {
    const d = { ...draftFromPreset('custom-openai'), toggles: { maxCompletionTokens: false, noTemperature: true, noSystemRole: false } };
    expect(quirksOf(d, { maxTokensParam: 'max_completion_tokens', supportsJsonMode: true })).toEqual({ supportsTemperature: false, supportsJsonMode: true });
  });

  it('tests with the stored key when no new one was typed, and a custom auth header', () => {
    const d = { ...draftFromPreset('custom-openai'), baseUrl: 'https://gw.example.com/v1', authStyle: 'custom-header' as const, headerName: 'X-Gateway-Token', model: ' m1 ' };
    expect(testInputOf(d, 'stored-key-0123')).toMatchObject({ apiKey: 'stored-key-0123', auth: { style: 'custom-header', headerName: 'X-Gateway-Token' }, model: 'm1' });
    expect(testInputOf({ ...d, apiKey: ' new-key ' }, 'stored').apiKey).toBe('new-key');
    expect(testInputOf({ ...draftFromPreset('ollama') }).apiKey).toBeUndefined();
  });

  it('saves the corrected base URL and what auto-detect found', () => {
    const d = { ...draftFromPreset('custom-auto'), label: 'Gateway', baseUrl: 'https://gw.example.com/chat/completions' };
    const both = toConnection(d, 'c1', undefined, passed({ detected: ['anthropic-messages', 'openai-chat'] }), { status: 'ok' });
    expect(both).toMatchObject({ id: 'c1', label: 'Gateway', presetId: 'custom-auto', protocol: 'auto', baseUrl: 'https://gw.example.com/v1', detectedProtocols: ['anthropic-messages', 'openai-chat'], status: 'ok' });
    const one = toConnection(d, 'c1', undefined, passed(), { status: 'ok' });
    expect(one.protocol).toBe('openai-chat');
    // Untested: the certain fixes still apply; status as given.
    const untested = toConnection(d, 'c1', undefined, undefined, { status: 'error', lastError: 'CORS blocked', lastErrorKind: 'cors-origin' });
    expect(untested).toMatchObject({ baseUrl: 'https://gw.example.com', status: 'error', lastError: 'CORS blocked', lastErrorKind: 'cors-origin' });
  });

  it('editing keeps the connection id and learned quirks', () => {
    const stored = { ...ANTHROPIC_CONNECTION, quirks: { supportsCacheControl: false } };
    const d = draftFromConnection(stored, 'claude-haiku-4-5');
    expect(d).toMatchObject({ presetId: 'anthropic', model: 'claude-haiku-4-5' });
    expect(toConnection(d, stored.id, stored, undefined, { status: 'unverified' })).toMatchObject({ id: 'anthropic', quirks: { supportsCacheControl: false } });
  });

  it('creates a profile with the preset defaults (local: 1 at a time, smaller chunks), or reuses the existing one', () => {
    const ollama = toConnection(draftFromPreset('ollama'), 'o1', undefined, passed({ baseUrl: 'http://localhost:11434/v1' }), { status: 'ok' });
    expect(toProfile(ollama, 'qwen3:8b', 'p1', [], [])).toEqual({ id: 'p1', connectionId: 'o1', model: 'qwen3:8b', maxConcurrency: 1, chunkTokens: 600 });
    const existing = [{ id: 'old', connectionId: 'o1', model: 'qwen3:8b', maxConcurrency: 1, chunkTokens: 500 }];
    expect(toProfile(ollama, 'qwen3:8b', 'p2', existing, []).id).toBe('old');
    const anthropic = toConnection(draftFromPreset('anthropic'), 'a1', undefined, passed({ protocol: 'anthropic-messages', detected: ['anthropic-messages'] }), { status: 'ok' });
    expect(toProfile(anthropic, 'claude-haiku-4-5', 'p3', [], [{ id: 'claude-haiku-4-5', contextWindow: 200000 }])).toMatchObject({ maxConcurrency: 2, chunkTokens: 1200, contextWindow: 200000 });
  });

  it('a dual-protocol connection stores the switch on the profile (protocolOverride)', () => {
    const gw = toConnection(draftFromPreset('custom-auto'), 'g', undefined, passed({ detected: ['anthropic-messages', 'openai-chat'] }), { status: 'ok' });
    expect(toProfile(gw, 'anthropic/claude-haiku-4.5', 'p', [], [], 'anthropic-messages').protocolOverride).toBe('anthropic-messages');
    const single = toConnection(draftFromPreset('openai'), 's', undefined, passed(), { status: 'ok' });
    expect(toProfile(single, 'gpt-5-mini', 'p', [], [], 'anthropic-messages').protocolOverride).toBeUndefined();
  });
});

describe('a connection moved to another origin (review C1 #1, §4.3.4)', () => {
  const editing = { ...ANTHROPIC_CONNECTION, id: 'gw', baseUrl: 'https://gw.example.com/v1' };
  const draft = (baseUrl: string) => ({ ...draftFromConnection(editing), baseUrl });

  it('the same origin (other path, port or endpoint suffix) has not moved; another host or scheme has', () => {
    expect(originMoved(draft('https://gw.example.com/v1'), editing)).toBe(false);
    expect(originMoved(draft('https://gw.example.com/api/v1/chat/completions'), editing)).toBe(false);
    expect(originMoved(draft('https://gw.example.com:8443/v1'), editing)).toBe(false);
    expect(originMoved(draft('https://other.example.com/v1'), editing)).toBe(true);
    expect(originMoved(draft('http://gw.example.com/v1'), editing)).toBe(true);
    expect(originMoved(draft('not a url'), editing)).toBe(true);
    expect(originMoved(draft('https://other.example.com/v1'), undefined)).toBe(false);
  });

  it('the stored key is offered only while the origin is the same', () => {
    expect(usableStoredKey(draft('https://gw.example.com/v2'), editing, 'sk-stored')).toBe('sk-stored');
    expect(usableStoredKey(draft('https://evil.example.net/v1'), editing, 'sk-stored')).toBeUndefined();
    expect(testInputOf(draft('https://evil.example.net/v1'), usableStoredKey(draft('https://evil.example.net/v1'), editing, 'sk-stored')).apiKey).toBeUndefined();
    expect(usableStoredKey(draft('https://anything.example/v1'), undefined, undefined)).toBeUndefined();
  });
});
