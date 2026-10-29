// The engine the Voice settings choose. Only the system voice is in the panel's own chunk; the
// cloud adapters load when chosen (a dynamic import). A cloud choice whose connection is gone reads
// with the system voice, and so does a language the provider does not read.
import type { browser } from 'wxt/browser';
import { readTtsConnection, type TtsSettings } from './settings.ts';
import { systemEngine } from './system.ts';
import type { TtsEngine } from './types.ts';

type Browser = typeof browser;

export async function engineFor(api: Browser, settings: TtsSettings): Promise<TtsEngine> {
  if (settings.engine === 'cloud' && settings.connectionId) {
    const conn = await readTtsConnection(api, settings.connectionId);
    if (conn) {
      const { cloudEngine, withSystemVoice } = await import('./cloud/cloud-engine.ts');
      return withSystemVoice(cloudEngine(api, conn), conn, systemEngine());
    }
  }
  return systemEngine();
}
