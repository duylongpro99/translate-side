import { describe, expect, it, vi } from 'vitest';
import { fakeDevice } from '@/shared/testing';
import { secretKey } from '@/shared/settings';
import {
  cleanTtsConnection,
  cleanTtsSettings,
  defaultTtsSettings,
  endpointOf,
  readTtsConnections,
  readTtsKey,
  readTtsSettings,
  sameService,
  ttsSecretKey,
  removeTtsConnection,
  saveTtsConnection,
  TTS_KEY,
  ttsConnKey,
  updateTtsSettings,
  voiceFor,
  watchTtsSettings,
} from './settings';

describe('voice settings', () => {
  it('are the system voice with read-on when nothing is stored', async () => {
    expect(await readTtsSettings(fakeDevice().api)).toEqual({ engine: 'system', voices: {}, readOn: true });
  });

  it('clean what they read', () => {
    expect(cleanTtsSettings({ engine: 'robot', voices: { vi: '', en: 7, fr: 'x' }, readOn: 'yes' })).toEqual(defaultTtsSettings());
    expect(cleanTtsSettings({ engine: 'cloud' })).toEqual(defaultTtsSettings());
    expect(cleanTtsSettings({ engine: 'cloud', connectionId: 'tts-gemini', voices: { vi: 'Kore' }, readOn: false })).toEqual({ engine: 'cloud', connectionId: 'tts-gemini', voices: { vi: 'Kore' }, readOn: false });
    expect(cleanTtsSettings(null)).toEqual(defaultTtsSettings());
  });

  it('forget the voices when the engine changes, keep them otherwise', async () => {
    const d = fakeDevice({ sync: { [TTS_KEY]: { engine: 'system', voices: { vi: 'Linh' }, readOn: true } } });
    expect((await updateTtsSettings(d.api, { readOn: false })).voices).toEqual({ vi: 'Linh' });
    expect(await updateTtsSettings(d.api, { engine: 'cloud', connectionId: 'tts-openai' })).toEqual({ engine: 'cloud', connectionId: 'tts-openai', voices: {}, readOn: false });
    expect((await updateTtsSettings(d.api, { engine: 'cloud', connectionId: 'tts-gemini', voices: { en: 'Kore' } })).voices).toEqual({ en: 'Kore' });
  });

  it('name the reader’s voice for a language by its primary subtag', () => {
    const s = { ...defaultTtsSettings(), voices: { vi: 'Linh', en: 'Samantha' } };
    expect(voiceFor(s, 'vi-VN')).toBe('Linh');
    expect(voiceFor(s, 'en_GB')).toBe('Samantha');
    expect(voiceFor(s, 'fr')).toBeUndefined();
  });

  it('tell a watcher about changes to the voice settings only', async () => {
    const d = fakeDevice();
    const seen = vi.fn();
    const stop = watchTtsSettings(d.api, seen);
    await d.sync.set({ other: 1 });
    await updateTtsSettings(d.api, { readOn: false });
    stop();
    await updateTtsSettings(d.api, { readOn: true });
    expect(seen.mock.calls).toEqual([[{ engine: 'system', voices: {}, readOn: false }]]);
  });
});

describe('voice connections', () => {
  it('are cleaned against their preset: fixed base URL unless editable, region only where needed', () => {
    expect(cleanTtsConnection({ presetId: 'gemini', baseUrl: 'https://evil.example' })).toMatchObject({ id: 'tts-gemini', baseUrl: 'https://generativelanguage.googleapis.com' });
    expect(cleanTtsConnection({ presetId: 'openai', baseUrl: 'https://my.server/v1/' })).toMatchObject({ id: 'tts-openai', baseUrl: 'https://my.server/v1' });
    expect(cleanTtsConnection({ presetId: 'azure', region: 'SouthEastAsia' })).toMatchObject({ region: 'southeastasia' });
    expect(cleanTtsConnection({ presetId: 'azure', region: 'a/b' })).not.toHaveProperty('region');
    expect(cleanTtsConnection({ presetId: 'gemini', region: 'x' })).not.toHaveProperty('region');
    expect(cleanTtsConnection({ presetId: 'nope' })).toBeNull();
    expect(cleanTtsConnection('gemini')).toBeNull();
  });

  it('fill Azure’s region into the endpoint', () => {
    const c = cleanTtsConnection({ presetId: 'azure', region: 'eastus' });
    expect(c && endpointOf(c)).toBe('https://eastus.tts.speech.microsoft.com');
  });

  it('keep their own key in storage.local, never in sync', async () => {
    const d = fakeDevice();
    const c = await saveTtsConnection(d.api, { id: 'x', presetId: 'elevenlabs', baseUrl: '' }, '  sk-123  ');
    expect(d.sync.data.get(ttsConnKey('tts-elevenlabs'))).toEqual({ id: 'tts-elevenlabs', presetId: 'elevenlabs', baseUrl: 'https://api.elevenlabs.io', model: 'eleven_flash_v2_5' });
    expect(d.local.data.get(ttsSecretKey('tts-elevenlabs'))).toBe('sk-123');
    expect(JSON.stringify([...d.sync.data])).not.toContain('sk-123');
    expect(await readTtsKey(d.api, c)).toBe('sk-123');
    expect(await readTtsConnections(d.api)).toEqual([c]);
  });

  it('reuse a translation key by reference, and drop a key of their own', async () => {
    const d = fakeDevice({ sync: { 'conn:gemini': { presetId: 'gemini' } }, local: { [secretKey('gemini')]: 'AIza-translate', [ttsSecretKey('tts-gemini')]: 'old' } });
    const c = await saveTtsConnection(d.api, { id: 'tts-gemini', presetId: 'gemini', baseUrl: '', keyFrom: 'gemini' }, 'ignored');
    expect(d.local.data.has(ttsSecretKey('tts-gemini'))).toBe(false);
    expect(await readTtsKey(d.api, c)).toBe('AIza-translate');
  });

  it('go back to the system voice when the chosen connection is removed', async () => {
    const d = fakeDevice();
    await saveTtsConnection(d.api, { id: 'tts-openai', presetId: 'openai', baseUrl: '' }, 'sk');
    await updateTtsSettings(d.api, { engine: 'cloud', connectionId: 'tts-openai', readOn: false });
    await removeTtsConnection(d.api, 'tts-openai');
    expect(await readTtsSettings(d.api)).toEqual({ engine: 'system', voices: {}, readOn: false });
    expect(d.local.data.size).toBe(0);
    expect(await readTtsConnections(d.api)).toEqual([]);
  });

  it('keep their key apart from translation keys: a translation connection named tts-x never reads it', async () => {
    const d = fakeDevice();
    await saveTtsConnection(d.api, { id: 'tts-gemini', presetId: 'gemini', baseUrl: '' }, 'voice-key');
    expect(d.local.data.has(secretKey('tts-gemini'))).toBe(false);
    expect(d.local.data.get(ttsSecretKey('tts-gemini'))).toBe('voice-key');
  });

  it('reuse only a key of the same service at its own address', async () => {
    const d = fakeDevice({ sync: { 'conn:oa': { presetId: 'openai', baseUrl: 'https://api.openai.com/v1' }, 'conn:evil': { presetId: 'openai', baseUrl: 'https://api.openai.com.evil.example/v1' } }, local: { [secretKey('oa')]: 'sk-oa', [secretKey('evil')]: 'sk-evil' } });
    const gem = await saveTtsConnection(d.api, { id: 'tts-gemini', presetId: 'gemini', baseUrl: '', keyFrom: 'oa' });
    expect(await readTtsKey(d.api, gem)).toBeUndefined();
    const oa = await saveTtsConnection(d.api, { id: 'tts-openai', presetId: 'openai', baseUrl: '', keyFrom: 'oa' });
    expect(await readTtsKey(d.api, oa)).toBe('sk-oa');
    expect(sameService('openai', { presetId: 'openai', baseUrl: 'https://api.openai.com.evil.example/v1' })).toBe(false);
    expect(sameService('azure', { presetId: 'azure' })).toBe(false);
  });
});
