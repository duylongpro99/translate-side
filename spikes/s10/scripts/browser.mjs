// Shared Playwright harness: a local "voice host" standing in for Hugging Face, and the bench page in Chromium.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const HERE = path.resolve(import.meta.dirname, '..');
export const EXT = path.join(HERE, 'ext');
export const CACHE = path.resolve(HERE, '../../.cache/s10');
export const VOICES = path.join(CACHE, 'voices');
export const PORT = 47310;
export const BASE = `http://127.0.0.1:${PORT}`;
export const VI = 'vi_VN-vais1000-medium';
export const EN = 'en_US-ljspeech-medium';

export function voiceHost() {
  const server = http.createServer((req, res) => {
    const file = path.join(VOICES, path.basename(decodeURIComponent(new URL(req.url, BASE).pathname)));
    if (!fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
      'content-length': fs.statSync(file).size,
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(PORT, '127.0.0.1', () => ok(server)));
}

/** profile: a folder under .cache/s10 (kept, so the Cache API survives) or '' for a throwaway one. */
export async function launch(profile = '') {
  const ctx = await chromium.launchPersistentContext(profile ? path.join(CACHE, profile) : '', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const open = async (threads = 1) => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('pageerror', e));
    await page.goto(`chrome-extension://${id}/bench.html?threads=${threads}`);
    await page.waitForFunction(() => globalThis.s10?.ready);
    return page;
  };
  return { ctx, open, browserVersion: ctx.browser()?.version() ?? null };
}
