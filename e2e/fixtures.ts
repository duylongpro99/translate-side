/* global chrome */
// The e2e harness: the built extension in Chromium, the fixture pages and the mock provider.
// - The build in .output/chrome-mv3 is copied to .output/e2e-ext with `http://127.0.0.1/*` added to the
//   copy's host_permissions: a script cannot answer Chrome's permission prompt. The build stays as built.
// - Storage is seeded through the service worker: the mock connection, the privacy acknowledgement.
// - The panel is sidepanel.html in a tab of the page's window. The panel follows the active tab of its
//   window, so the page tab is made active through the worker and the panel stays in the background
//   (never bring it to the front: it would bind to itself and pause the job).
// - `translate(page)` does what the worker's action handler does on Alt+T or the toolbar icon
//   (src/shared/inject.ts): marks the tab's access, injects the content script, marks it ready.
// - Console errors from the worker, the panel and the page (content scripts included) fail the test.
import fs from 'node:fs';
import path from 'node:path';
import { test as base, chromium, expect, type ConsoleMessage, type Page, type Worker } from '@playwright/test';
import { CHROMIUM_ARGS } from './playwright.config.ts';
import { FIXTURE_ORIGIN, FIXTURE_PORT, MOCK_BASE_URL, MOCK_PORT, fixtureServer, listen, mockServer, type MockControl } from './servers.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const BUILD = path.join(ROOT, '.output/chrome-mv3');
const EXT = path.join(ROOT, '.output/e2e-ext');

function copyExtension(): string {
  if (!fs.existsSync(path.join(BUILD, 'manifest.json'))) throw new Error('no build in .output/chrome-mv3: run `pnpm run build` first');
  fs.rmSync(EXT, { recursive: true, force: true });
  fs.cpSync(BUILD, EXT, { recursive: true });
  const file = path.join(EXT, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as { host_permissions?: string[] };
  manifest.host_permissions = [...(manifest.host_permissions ?? []), 'http://127.0.0.1/*'];
  fs.writeFileSync(file, JSON.stringify(manifest));
  return EXT;
}

/** Settings for the mock provider, as the options page saves a custom OpenAI-compatible connection. */
const SYNC = {
  schemaVersion: 1,
  prefs: { targetLang: 'vi', sourceLang: 'auto', style: 'natural', gloss: 'first', budgetTokens: 0 },
  glossary: [],
  'conn:mock': { id: 'mock', label: 'Mock', presetId: 'custom-openai', protocol: 'openai-chat', baseUrl: MOCK_BASE_URL, auth: { style: 'bearer' }, quirks: {}, status: 'ok' },
  'profile:mock-model': { id: 'mock-model', connectionId: 'mock', model: 'mock-model', maxConcurrency: 4, chunkTokens: 1200 },
  routing: { translate: 'mock-model' },
};

export interface Extension {
  id: string;
  worker: Worker;
  /** Seeds the mock provider; `privacy: false` leaves the first-run notice unacknowledged. */
  seed(opts?: { privacy?: boolean }): Promise<void>;
  /** Opens a fixture (a path under fixtures/) in a new tab. */
  open(fixture: string): Promise<Page>;
  /** Opens the panel in a tab of the same window; it stays in the background. */
  panel(): Promise<Page>;
  /** Makes `page` the active tab and does what Alt+T does: inject the content script, mark access ready. */
  translate(page: Page): Promise<void>;
}

interface Fixtures {
  extension: Extension;
  mock: MockControl;
  /** Console errors a test expects (e.g. the network error a mock 429 logs); every other error fails it. */
  allowedConsole: RegExp[];
}

export const test = base.extend<Fixtures, { servers: MockControl; extPath: string }>({
  // Playwright reads a fixture's dependencies from its first parameter, which must be a destructuring pattern.
  // eslint-disable-next-line no-empty-pattern
  extPath: [async ({}, use) => use(copyExtension()), { scope: 'worker' }],
  servers: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const fixtures = fixtureServer();
      const { server, control } = mockServer();
      await listen(fixtures, FIXTURE_PORT);
      await listen(server, MOCK_PORT);
      await use(control);
      await Promise.all([new Promise((r) => fixtures.close(r)), new Promise((r) => server.close(r))]);
    },
    { scope: 'worker', auto: true },
  ],
  mock: async ({ servers }, use) => {
    servers.reset();
    await use(servers);
  },
  // eslint-disable-next-line no-empty-pattern
  allowedConsole: async ({}, use) => use([]),
  context: async ({ extPath, allowedConsole: allowed }, use) => {
    const errors: string[] = [];
    // Closing the browser makes the worker's tab cleanup fail with "The browser is shutting down": that is
    // the harness ending the run. Only that message is dropped once the close starts.
    let closing = false;
    const SHUTDOWN = /The browser is shutting down/;
    const report = (line: string) => {
      if (!(closing && SHUTDOWN.test(line))) errors.push(line);
    };
    const record = (where: () => string) => (m: ConsoleMessage) => {
      if (m.type() === 'error' && !allowed.some((p) => p.test(m.text()))) report(`${where()}: ${m.text()}`);
    };
    const watch = (page: Page) => {
      // Named when the message comes: a new tab is about:blank until it navigates.
      const where = () => (page.url().startsWith('chrome-extension://') ? 'panel' : 'page');
      page.on('console', record(where));
      page.on('pageerror', (e) => report(`${where()} uncaught: ${e.message}`));
    };
    const watched = new Set<Worker>();
    const watchWorker = async (worker: Worker) => {
      if (watched.has(worker)) return;
      watched.add(worker);
      worker.on('console', record(() => 'worker'));
      // A worker has no pageerror event: report its uncaught errors on its console.
      await worker.evaluate(() => {
        self.addEventListener('error', (e) => console.error(`uncaught: ${e.message}`));
        self.addEventListener('unhandledrejection', (e) => console.error(`unhandled rejection: ${String(e.reason)}`));
      });
    };
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`, ...CHROMIUM_ARGS],
      viewport: { width: 1100, height: 800 },
    });
    // The site fixtures keep their <base href> (fixtures/sites/README.md): stylesheets, fonts and images
    // would come from the original hosts. Answer them empty, so runs are offline and deterministic
    // (web app manifest links are cut by the fixture server, servers.ts). Fonts are fetched in CORS mode
    // from the page's origin, hence the allow-origin header. The extension itself (worker, panel) talks
    // only to the mock: any request it makes elsewhere fails the test (DESIGN.md §8, nothing leaves
    // for a host the user did not choose).
    await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => {
      const request = route.request();
      const from = request.serviceWorker() ? 'worker' : request.frame().url().startsWith('chrome-extension://') ? 'panel' : undefined;
      if (from !== undefined) report(`${from} requested ${request.method()} ${request.url()}`);
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '' });
    });
    context.on('page', watch);
    // A worker that idles out comes back as a new instance: watch every one.
    context.on('serviceworker', (worker) => void watchWorker(worker).catch(() => {}));
    await watchWorker(context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')));
    await use(context);
    closing = true;
    await context.close();
    expect(errors, 'console errors from the worker, the panel and the page').toEqual([]);
  },
  extension: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    await use({
      id,
      worker,
      async seed({ privacy = true } = {}) {
        await worker.evaluate(
          async ([sync, local]) => {
            await chrome.storage.sync.set(sync);
            await chrome.storage.local.set(local);
          },
          [SYNC, { 'secret:mock': 'placeholder-key', ...(privacy ? { privacyNotice: { version: 1, at: 1 } } : {}) }] as const,
        );
      },
      async open(fixture) {
        const page = await context.newPage();
        await page.goto(`${FIXTURE_ORIGIN}/${fixture}`);
        return page;
      },
      async panel() {
        const panel = await context.newPage();
        await panel.goto(`chrome-extension://${id}/sidepanel.html`);
        await expect(panel.locator('.state, [data-testid=job]').first()).toBeVisible();
        return panel;
      },
      async translate(page) {
        await worker.evaluate(async (url) => {
          const [tab] = await chrome.tabs.query({ url });
          if (tab?.id === undefined) throw new Error(`no tab for ${url}`);
          await chrome.tabs.update(tab.id, { active: true });
          // Unhandled rejections in the content script's world reach neither Playwright's pageerror nor
          // CDP: put them on its console first, as for the worker.
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, frameIds: [0] },
            func: () => self.addEventListener('unhandledrejection', (e) => console.error(`content script unhandled rejection: ${String(e.reason)}`)),
          });
          await chrome.storage.session.set({ [`access:${tab.id}`]: { status: 'injecting', at: Date.now() } });
          await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content-scripts/content.js'] });
          await chrome.storage.session.set({ [`access:${tab.id}`]: { status: 'ready', at: Date.now() } });
        }, page.url().replace(/#.*/, ''));
      },
    });
  },
});

export { expect };

/** The panel's blocks by status (`kept` blocks are not translated by design: code, numbers). */
export async function blockStatuses(panel: Page): Promise<Record<string, number>> {
  return panel.evaluate(() => {
    const counts: Record<string, number> = {};
    for (const e of document.querySelectorAll<HTMLElement>('.seg[data-id]')) counts[e.dataset.status ?? '?'] = (counts[e.dataset.status ?? '?'] ?? 0) + 1;
    return counts;
  });
}

/** Waits until the job leaves `running`; returns its status. */
export async function jobSettled(panel: Page): Promise<string | null> {
  const job = panel.locator('[data-testid=job]');
  await expect(job).toBeVisible();
  await expect(job).not.toHaveAttribute('data-status', 'running', { timeout: 90_000 });
  return job.getAttribute('data-status');
}
