// @vitest-environment jsdom
// Settings › Voice: the engine and voice choices, adding a provider (its permission asked in the
// click, its key kept on this device or reused by reference), the test, and that it is free.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectionKey } from '@/shared/providers';
import { GEMINI_CONNECTION, secretKey } from '@/shared/settings';
import { fakeDevice } from '@/shared/testing';
import { TtsError } from '@/tts/errors';
import { readTtsConnections, readTtsSettings, TTS_KEY, ttsSecretKey } from '@/tts/settings';
import type { Playback, SpeakOptions, TtsEngine } from '@/tts/types';
import { SAMPLES, VoiceSection } from './Voice.tsx';

const spoken: { text: string; opts: SpeakOptions }[] = [];
const failFor = new Map<string, TtsError>();
const stopped: string[] = [];
const fakeEngine: TtsEngine = {
  id: 'system',
  voices: async (lang) => (lang === 'vi' ? [{ id: 'Linh', name: 'Linh', lang: 'vi-VN', engine: 'system', remote: false }] : [{ id: 'Samantha', name: 'Samantha', lang: 'en-US', engine: 'system', remote: false }, { id: 'Google US English', name: 'Google US English', lang: 'en-US', engine: 'system', remote: true }]),
  speak(text, opts): Playback {
    spoken.push({ text, opts });
    const err = failFor.get(opts.lang);
    return { done: err ? Promise.reject(err) : Promise.resolve('ended'), stop: () => void stopped.push(text) };
  },
};
vi.mock('@/tts/engines', () => ({ engineFor: async () => fakeEngine }));

function setup({ grant = true, sync = {}, local = {} }: { grant?: boolean; sync?: Record<string, unknown>; local?: Record<string, unknown> } = {}) {
  const d = fakeDevice({ sync, local });
  const requested: string[][] = [];
  Object.assign(d.api.permissions, {
    request: ({ origins }: { origins: string[] }) => {
      requested.push(origins);
      return Promise.resolve(grant);
    },
  });
  return { ...d, requested };
}

let root: HTMLDivElement;
beforeEach(() => {
  spoken.length = 0;
  stopped.length = 0;
  failFor.clear();
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const q = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`[data-testid="${id}"]`);
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
async function mount(api: ReturnType<typeof setup>['api']) {
  await act(async () => render(<VoiceSection api={api} />, root));
  await flush();
}
const change = async (el: HTMLInputElement | HTMLSelectElement | null, value: string) => {
  if (!el) throw new Error('no element');
  el.value = value;
  await act(async () => {
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
  await flush();
};
const click = async (el: HTMLElement | null) => {
  await act(async () => el?.click());
  await flush();
};

describe('Settings › Voice', () => {
  it('starts on the system voice and lists its voices, marking network voices', async () => {
    const t = setup();
    await mount(t.api);
    expect(q<HTMLSelectElement>('voice-engine')?.value).toBe('system');
    await vi.waitFor(() => expect([...(q<HTMLSelectElement>('voice-en')?.options ?? [])].map((o) => o.text)).toEqual(['Automatic', 'Samantha', 'Google US English (online: sends the text to Google)']));
    expect(q<HTMLInputElement>('voice-read-on')?.checked).toBe(true);
  });

  it('saves a picked voice and plays a sample with it', async () => {
    const t = setup();
    await mount(t.api);
    await vi.waitFor(() => expect(q<HTMLSelectElement>('voice-vi')?.options).toHaveLength(2));
    await change(q<HTMLSelectElement>('voice-vi'), 'Linh');
    expect((await readTtsSettings(t.api)).voices).toEqual({ vi: 'Linh' });
    expect(spoken).toEqual([{ text: SAMPLES.vi, opts: { lang: 'vi', voice: 'Linh' } }]);
  });

  it('stops a sample when the settings close', async () => {
    const t = setup();
    await mount(t.api);
    await vi.waitFor(() => expect(q<HTMLSelectElement>('voice-vi')?.options).toHaveLength(2));
    await change(q<HTMLSelectElement>('voice-vi'), 'Linh');
    await act(async () => render(null, root));
    expect(stopped.at(-1)).toBe(SAMPLES.vi);
  });

  it('turns read-on off', async () => {
    const t = setup();
    await mount(t.api);
    await click(q('voice-read-on'));
    expect((await readTtsSettings(t.api)).readOn).toBe(false);
  });

  it('tests both languages and says why one failed', async () => {
    failFor.set('en', new TtsError('quota', 'limit: 10 requests per day'));
    const t = setup();
    await mount(t.api);
    await click(q('voice-test'));
    expect(q('voice-test-result')?.textContent).toBe("Vietnamese: played · English: The provider's allowance is used up: limit: 10 requests per day");
  });

  it('adds Azure: region required, only its origin asked for in the click, the key kept on this device', async () => {
    const t = setup();
    await mount(t.api);
    await click(q('voice-add'));
    await change(q<HTMLSelectElement>('voice-preset'), 'azure');
    await change(q<HTMLInputElement>('voice-key'), 'az-key');
    await click(q('voice-save'));
    expect(q('voice-add-error')?.textContent).toBe('Fill in: Region');
    expect(t.requested).toEqual([]);
    await change(q<HTMLInputElement>('voice-region'), 'eastus');
    await click(q('voice-save'));
    expect(t.requested).toEqual([['https://*.tts.speech.microsoft.com/*']]);
    expect(await readTtsConnections(t.api)).toEqual([{ id: 'tts-azure', presetId: 'azure', baseUrl: 'https://{region}.tts.speech.microsoft.com', region: 'eastus' }]);
    expect(t.local.data.get(ttsSecretKey('tts-azure'))).toBe('az-key');
    expect(await readTtsSettings(t.api)).toMatchObject({ engine: 'cloud', connectionId: 'tts-azure' });
    expect(q<HTMLSelectElement>('voice-engine')?.value).toBe('cloud:tts-azure');
    expect(q('voice-sends')?.textContent).toContain('Azure Speech receives the text');
  });

  it('saves nothing when Chrome refuses the permission', async () => {
    const t = setup({ grant: false });
    await mount(t.api);
    await click(q('voice-add'));
    await change(q<HTMLInputElement>('voice-key'), 'AIza-key');
    await click(q('voice-save'));
    expect(q('voice-add-error')?.textContent).toContain('Chrome did not allow access to Gemini');
    expect(await readTtsConnections(t.api)).toEqual([]);
    expect(t.local.data.has(ttsSecretKey('tts-gemini'))).toBe(false);
  });

  it('reuses the Gemini translation key by reference, never a copy', async () => {
    const t = setup({ sync: { [connectionKey('gemini')]: GEMINI_CONNECTION }, local: { [secretKey('gemini')]: 'AIza-translate' } });
    await mount(t.api);
    await click(q('voice-add'));
    await click(q('voice-reuse'));
    expect(q('voice-key')).toBeNull();
    await click(q('voice-save'));
    expect(t.requested).toEqual([['https://generativelanguage.googleapis.com/*']]);
    expect(await readTtsConnections(t.api)).toMatchObject([{ id: 'tts-gemini', keyFrom: 'gemini' }]);
    expect(t.local.data.has(ttsSecretKey('tts-gemini'))).toBe(false);
    expect(q('voice-sends')?.textContent).toContain('10 voice requests a day');
  });

  it('offers no key reuse for a server address the reader typed', async () => {
    const t = setup({ sync: { 'conn:oa': { id: 'oa', label: 'OpenAI', presetId: 'openai', protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1', auth: { style: 'bearer' }, quirks: {}, status: 'ok' } }, local: { 'secret:oa': 'sk-oa' } });
    await mount(t.api);
    await click(q('voice-add'));
    await change(q<HTMLSelectElement>('voice-preset'), 'openai');
    expect(q('voice-reuse')).not.toBeNull();
    await change(q<HTMLInputElement>('voice-base'), 'https://my.server/v1');
    expect(q('voice-reuse')).toBeNull();
    expect(q('voice-key')).not.toBeNull();
  });

  it('removes a provider and goes back to the system voice', async () => {
    const t = setup({ sync: { [TTS_KEY]: { engine: 'cloud', connectionId: 'tts-fpt' }, 'ttsConn:tts-fpt': { presetId: 'fpt' } }, local: { [ttsSecretKey('tts-fpt')]: 'k' } });
    await mount(t.api);
    expect(q<HTMLSelectElement>('voice-engine')?.value).toBe('cloud:tts-fpt');
    await click(q('voice-remove-fpt'));
    expect(q<HTMLSelectElement>('voice-engine')?.value).toBe('system');
    expect(t.local.data.has(ttsSecretKey('tts-fpt'))).toBe(false);
  });
});

describe('the voice feature is free', () => {
  const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !e.name.includes('.test.') ? [join(dir, e.name)] : []));

  it('never asks featureAvailable', () => {
    const files = [...sources('src/tts'), 'src/entrypoints/options/Voice.tsx', 'src/entrypoints/sidepanel/read-aloud.ts', 'src/entrypoints/sidepanel/ReadStrip.tsx'];
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/featureAvailable\(|from '@\/shared\/features'/);
  });
});
