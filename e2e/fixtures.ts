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
import { PRIVACY_NOTICE_VERSION } from '../src/entrypoints/sidepanel/privacy.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test as base, chromium, expect, type ConsoleMessage, type Page, type Worker } from '@playwright/test';
import { CHROMIUM_ARGS } from './playwright.config.ts';
import { FIXTURE_ORIGIN, FIXTURE_PORT, MOCK_BASE_URL, MOCK_PORT, fixtureServer, listen, mockServer, type MockControl } from './servers.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
// The preview build (`pnpm run e2e` makes it): Best is on there, as the release switch is off in the release build.
const BUILD = path.join(ROOT, '.output-preview/chrome-mv3');
const EXT = path.join(ROOT, '.output/e2e-ext');

function copyExtension(): string {
  if (!fs.existsSync(path.join(BUILD, 'manifest.json'))) throw new Error('no build in .output-preview/chrome-mv3: run `pnpm run e2e`, which makes it');
  fs.rmSync(EXT, { recursive: true, force: true });
  fs.cpSync(BUILD, EXT, { recursive: true });
  const file = path.join(EXT, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as { host_permissions?: string[] };
  // `localhost` is the same server under a second host name: a flow that needs two origins (and a site rule for one of them) uses it.
  manifest.host_permissions = [...(manifest.host_permissions ?? []), 'http://127.0.0.1/*', 'http://localhost/*'];
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

/** A second profile on the mock connection, for the Review with route (`seed({ reviewWith: true })`). */
export const REVIEW_MODEL = 'mock-review-model';
const REVIEW_PROFILE = { id: 'mock-review', connectionId: 'mock', model: REVIEW_MODEL, maxConcurrency: 4, chunkTokens: 1200 };

/** The seeded settings: the mock provider, with the quality setting, a review route and a page budget when asked for. */
function syncFor(opts: SeedOptions): Record<string, unknown> {
  return {
    ...SYNC,
    ...(opts.budgetTokens === undefined ? {} : { prefs: { ...SYNC.prefs, budgetTokens: opts.budgetTokens } }),
    ...(opts.quality === undefined ? {} : { quality: { keepDraftsOnScreen: false, ...opts.quality } }),
    ...(opts.reviewWith ? { 'profile:mock-review': REVIEW_PROFILE, routing: { ...SYNC.routing, review: REVIEW_PROFILE.id } } : {}),
  };
}

export interface SeedOptions {
  /** false: the first-run notice is left unacknowledged. */
  privacy?: boolean;
  /** The quality setting (sync item `quality`), e.g. `{ mode: 'best' }`. Absent: none (Balanced). */
  quality?: { mode: 'fast' | 'balanced' | 'best'; strategy?: string; keepDraftsOnScreen?: boolean };
  /** Routes the review role to a second mock model (REVIEW_MODEL). */
  reviewWith?: boolean;
  /** The per-page token ceiling (0: none). */
  budgetTokens?: number;
}

/**
 * What starts Chromium in `lang`. On Linux the launch env's `LANGUAGE` decides. On macOS the application
 * locale (the one the extension's messages resolve in) is the system's, which `-AppleLanguages` overrides for
 * one process. Playwright refuses that argument (its value reads as a second page to open), so a wrapper adds
 * it in place of the `about:blank` Playwright passes.
 */
function localeLaunch(lang: string): { env: Record<string, string>; executablePath?: string } {
  const env = { ...process.env, LANGUAGE: lang } as Record<string, string>;
  if (process.platform !== 'darwin') return { env };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-launcher-')), 'chromium.sh');
  const script = `#!/bin/sh\nfor a in "$@"; do shift; [ "$a" = about:blank ] || set -- "$@" "$a"; done\nexec "${chromium.executablePath()}" "$@" -AppleLanguages "(${lang})"\n`;
  fs.writeFileSync(file, script, { mode: 0o755 });
  return { env, executablePath: file };
}

export interface Extension {
  id: string;
  worker: Worker;
  /** Seeds the mock provider; `privacy: false` leaves the first-run notice unacknowledged. */
  seed(opts?: SeedOptions): Promise<void>;
  /** Opens a fixture (a path under fixtures/) in a new tab; `origin` is the fixture server's other host name (`http://localhost:4173`) when a flow needs a second origin. */
  open(fixture: string, origin?: string): Promise<Page>;
  /** Opens the panel in a tab of the same window; it stays in the background. */
  panel(): Promise<Page>;
  /** Opens the settings page in a tab of the same window, 1280×800. */
  options(): Promise<Page>;
  /** Makes `page` the active tab and does what Alt+T does: inject the content script, mark access ready. */
  translate(page: Page): Promise<void>;
}

interface Fixtures {
  extension: Extension;
  mock: MockControl;
  /** Console errors a test expects (e.g. the network error a mock 429 logs); every other error fails it. */
  allowedConsole: RegExp[];
}

interface Options {
  /** Chromium's UI language (`--lang`), which picks the extension's locale; unset: the browser's default. */
  uiLang: string | undefined;
}

export const test = base.extend<Fixtures & Options, { servers: MockControl; extPath: string }>({
  uiLang: [undefined, { option: true }],
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
  context: async ({ extPath, allowedConsole: allowed, uiLang }, use) => {
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
      args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`, ...CHROMIUM_ARGS, ...(uiLang ? [`--lang=${uiLang}`] : [])],
      // Playwright passes its own --lang (en-US) unless `locale` says otherwise.
      ...(uiLang ? { locale: uiLang, ...localeLaunch(uiLang) } : {}),
      viewport: { width: 1100, height: 800 },
    });
    // The site fixtures keep their <base href> (fixtures/sites/README.md): stylesheets, fonts and images
    // would come from the original hosts. Answer them empty, so runs are offline and deterministic
    // (web app manifest links are cut by the fixture server, servers.ts). Fonts are fetched in CORS mode
    // from the page's origin, hence the allow-origin header. The extension itself (worker, panel) talks
    // only to the mock: any request it makes elsewhere fails the test (DESIGN.md §8, nothing leaves
    // for a host the user did not choose).
    await context.route(new RegExp(`^https?://(?!127\\.0\\.0\\.1[:/]|localhost:${FIXTURE_PORT}/)`), (route) => {
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
      async seed(opts = {}) {
        const { privacy = true } = opts;
        await worker.evaluate(
          async ([sync, local]) => {
            await chrome.storage.sync.set(sync);
            await chrome.storage.local.set(local);
          },
          [syncFor(opts), { 'secret:mock': 'placeholder-key', ...(privacy ? { privacyNotice: { version: PRIVACY_NOTICE_VERSION, at: 1 } } : {}) }] as const,
        );
      },
      async open(fixture, origin = FIXTURE_ORIGIN) {
        const page = await context.newPage();
        await page.goto(`${origin}/${fixture}`);
        return page;
      },
      async panel() {
        const panel = await context.newPage();
        await panel.goto(`chrome-extension://${id}/sidepanel.html`);
        await expect(panel.locator('.state, [data-testid=job]').first()).toBeVisible();
        return panel;
      },
      async options() {
        const options = await context.newPage();
        await options.setViewportSize({ width: 1280, height: 800 });
        await options.goto(`chrome-extension://${id}/options.html`);
        return options;
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

/**
 * Waits until the job leaves `running`; returns its status. The job bar only shows what needs
 * attention, so with nothing to say it is a 1px strip: its status attribute is the signal, not its looks.
 */
export async function jobSettled(panel: Page): Promise<string | null> {
  const job = panel.locator('[data-testid=job]');
  await expect(job).toHaveAttribute('data-status', /.+/);
  await expect(job).not.toHaveAttribute('data-status', 'running', { timeout: 90_000 });
  return job.getAttribute('data-status');
}
