import { describe, expect, it } from 'vitest';
import { nanoClient, pickEngine, prepareOnDevice, translatorRouteClient } from './on-device.ts';
import { fakeBuiltinAI } from './testing.ts';
import type { NormalizedEvent } from './types.ts';

const pick = (ai: ReturnType<typeof fakeBuiltinAI>, from: string, to: string, setting: 'auto' | 'nano' | 'translator' = 'auto', translator = true) => pickEngine(ai.scope, { setting, from, to, translator });

describe('pickEngine (the on-device route)', () => {
  it('auto: Gemini Nano for a target it writes, Chrome Translator for the rest; never creates anything', async () => {
    const ai = fakeBuiltinAI({ pairs: { 'en>vi': 'available', 'ja>en': 'available' }, nano: { en: 'available' } });
    expect(await pick(ai, 'en', 'vi')).toEqual({ engine: 'translator' });
    expect(await pick(ai, 'ja', 'en')).toEqual({ engine: 'nano' });
    expect(ai.creates).toEqual([]);
  });

  it('a pair not created yet needs the turn-on click; one Chrome is downloading says so', async () => {
    const ai = fakeBuiltinAI({ pairs: { 'en>vi': 'downloadable', 'ja>vi': 'downloading' } });
    expect(await pick(ai, 'en', 'vi')).toEqual({ needsSetup: 'translator', from: 'en', to: 'vi' });
    expect(await pick(ai, 'ja', 'vi')).toEqual({ downloading: 'translator', from: 'ja', to: 'vi' });
    expect(ai.creates).toEqual([]);
  });

  it('auto prefers setting up the Translator (small packs) over a Nano download; Nano when only Nano can', async () => {
    const both = fakeBuiltinAI({ pairs: { 'ja>en': 'downloadable' }, nano: { en: 'downloadable' } });
    expect(await pick(both, 'ja', 'en')).toEqual({ needsSetup: 'translator', from: 'ja', to: 'en' });
    const nanoOnly = fakeBuiltinAI({ nano: { en: 'downloadable' } });
    expect(await pick(nanoOnly, 'ja', 'en')).toEqual({ needsSetup: 'nano', from: 'ja', to: 'en' });
  });

  it('the setting picks one engine only', async () => {
    const ai = fakeBuiltinAI({ pairs: { 'ja>en': 'available' }, nano: { en: 'available' } });
    expect(await pick(ai, 'ja', 'en', 'translator')).toEqual({ engine: 'translator' });
    expect(await pick(ai, 'ja', 'vi', 'nano')).toEqual({ unavailable: 'pair', from: 'ja', to: 'vi' });
  });

  it('a setting that leaves out the engine this browser has (synced from another computer) says so, not "no API"', async () => {
    const translatorOnly = fakeBuiltinAI({ languageModel: false, pairs: { 'en>vi': 'available' } });
    expect(await pick(translatorOnly, 'en', 'vi', 'nano')).toEqual({ unavailable: 'setting', from: 'en', to: 'vi' });
    const nanoOnly = fakeBuiltinAI({ translator: false, nano: { en: 'downloadable' } });
    expect(await pick(nanoOnly, 'ja', 'en', 'translator')).toEqual({ unavailable: 'setting', from: 'ja', to: 'en' });
    // Nano set and this pair is the Translator's: the setting is the reason too.
    expect(await pick(fakeBuiltinAI({ pairs: { 'en>vi': 'downloadable' }, nano: { en: 'available' } }), 'en', 'vi', 'nano')).toEqual({ unavailable: 'setting', from: 'en', to: 'vi' });
  });

  it('an unknown page language, no API, a pair neither can do', async () => {
    const ai = fakeBuiltinAI({ pairs: { 'en>vi': 'available' } });
    expect(await pick(ai, '', 'vi')).toEqual({ unknownSource: true });
    expect(await pick(ai, 'xx', 'vi')).toEqual({ unavailable: 'pair', from: 'xx', to: 'vi' });
    expect(await pickEngine({}, { setting: 'auto', from: 'en', to: 'vi', translator: true })).toEqual({ unavailable: 'no-api', from: 'en', to: 'vi' });
  });

  it('"basic translation" removed from the fallback list: the Translator is never chosen', async () => {
    const ai = fakeBuiltinAI({ pairs: { 'en>vi': 'available' }, nano: { en: 'available' } });
    expect(await pick(ai, 'en', 'vi', 'auto', false)).toEqual({ unavailable: 'pair', from: 'en', to: 'vi' });
    expect(await pick(ai, 'ja', 'en', 'auto', false)).toEqual({ engine: 'nano' });
    expect(await pick(fakeBuiltinAI({ languageModel: false, pairs: { 'en>vi': 'available' } }), 'en', 'vi', 'auto', false)).toEqual({ unavailable: 'no-api', from: 'en', to: 'vi' });
  });

  it("never asks Nano about a language it can't read or write (Chrome logs an error for that)", async () => {
    const asked: unknown[] = [];
    const scope = { LanguageModel: { availability: async (o: unknown) => (asked.push(o), 'available'), create: async () => ({}) } };
    expect(await pickEngine(scope, { setting: 'auto', from: 'en', to: 'vi', translator: true })).toEqual({ unavailable: 'pair', from: 'en', to: 'vi' });
    expect(await pickEngine(scope, { setting: 'auto', from: 'vi', to: 'en', translator: true })).toEqual({ unavailable: 'pair', from: 'vi', to: 'en' });
    expect(asked).toEqual([]);
    expect(await pickEngine(scope, { setting: 'auto', from: 'ja', to: 'en', translator: true })).toEqual({ engine: 'nano' });
    expect(asked).toHaveLength(1);
  });

  it("asks Nano with the pair's base language codes", async () => {
    const ai = fakeBuiltinAI({ nano: { es: 'available' } });
    expect(await pick(ai, 'en-US', 'es-419')).toEqual({ engine: 'nano' });
  });
});

const drain = async (stream: AsyncIterable<NormalizedEvent>) => {
  const out: NormalizedEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
};
const request = (model: string) => ({ model, system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }], maxOutputTokens: 100, signal: new AbortController().signal });

describe('the on-device clients', () => {
  it('Nano runs only an `available` model, with the pair as its languages', async () => {
    const ai = fakeBuiltinAI({ nano: { es: 'available', en: 'downloadable' }, nanoAnswer: () => 'hola' });
    const events = await drain(nanoClient(ai.scope, 'en', 'es').stream(request('gemini-nano')));
    expect(events).toContainEqual({ type: 'text', delta: 'hola' });
    expect(ai.creates).toEqual([{ api: 'nano', from: 'en', to: 'es' }]);
    // A model still to download is never created from a job, even after a click (sticky activation).
    ai.activation.sticky = true;
    const refused = await drain(nanoClient(ai.scope, 'ja', 'en').stream(request('gemini-nano')));
    expect(refused[0]).toMatchObject({ type: 'error', error: { kind: 'model_not_found' } });
    expect(ai.creates).toHaveLength(1);
  });

  it("the Translator route's client takes no prompt: a clear error, not a crash", async () => {
    const events = await drain(translatorRouteClient().stream(request('Chrome Translator')));
    expect(events).toEqual([{ type: 'error', error: { kind: 'bad_request', message: "Chrome Translator can't run prompts" } }]);
  });
});

describe('prepareOnDevice (the turn-on click)', () => {
  it('Gemini Nano: creates the session in the click with the pair, reports the download, then closes it', async () => {
    const ai = fakeBuiltinAI({ nano: { en: 'downloadable' } });
    ai.activation.sticky = true;
    const seen: number[] = [];
    await prepareOnDevice(ai.scope, undefined, 'nano', 'ja', 'en', { signal: new AbortController().signal, progress: (loaded) => seen.push(loaded) });
    expect(ai.creates).toEqual([{ api: 'nano', from: 'ja', to: 'en' }]);
    expect(seen).toEqual([0, 1]);
    expect(await pickEngine(ai.scope, { setting: 'nano', from: 'ja', to: 'en', translator: false })).toEqual({ engine: 'nano' });
  });

  it('a browser without the engine rejects, so the bar says why', async () => {
    await expect(prepareOnDevice({}, undefined, 'nano', 'ja', 'en')).rejects.toMatchObject({ name: 'NotSupportedError' });
    await expect(prepareOnDevice({}, undefined, 'translator', 'en', 'vi')).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  it('an availability() that throws counts as unavailable', async () => {
    const scope = { Translator: { availability: () => Promise.reject(new Error('boom')), create: () => Promise.reject(new Error('no')) } };
    expect(await pickEngine(scope, { setting: 'auto', from: 'en', to: 'vi', translator: true })).toEqual({ unavailable: 'pair', from: 'en', to: 'vi' });
  });
});
