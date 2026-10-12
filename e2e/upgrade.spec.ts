/* global chrome */
// Upgrade from an earlier build (`pnpm run e2e:upgrade`, scripts/e2e-upgrade.mjs; run locally, not in CI).
// The earlier build is loaded unpacked from one directory, given its settings and glossary, and fills the
// translation cache on a fixture page. The current build then overwrites that directory and the extension
// reloads: Chrome treats it as an update of the same extension, with the same storage.
// - The earlier build talks to its fixed provider host: those requests are answered by the mock (servers.ts).
// - `onInstalled` is observed from outside the extension: a CDP client pauses the new worker before its script
//   runs and adds a listener there, which logs the event's details on the worker's console.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { blockStatuses, jobSettled } from './fixtures.ts';
import { CHROMIUM_ARGS } from './playwright.config.ts';
import { FIXTURE_ORIGIN, FIXTURE_PORT, MOCK_BASE_URL, MOCK_PORT, fixtureServer, listen, mockServer } from './servers.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const OLD = process.env.UPGRADE_FROM ?? '';
const NEW = process.env.UPGRADE_TO ?? '';
const EXT = path.join(ROOT, '.output/e2e-upgrade/ext');
const DEBUG_PORT = 9339;
const PROVIDER = 'https://api.ai-box.vn/v1';
const PAGE = 'sites/goblog-pipelines.html';
const PROBE = 'upgrade-probe onInstalled ';

/** Copies a build into the one extension directory, with the fixture and provider hosts granted (a script cannot answer the prompt). */
function install(build: string): void {
  if (!fs.existsSync(path.join(build, 'manifest.json'))) throw new Error(`no build in ${build}`);
  fs.rmSync(EXT, { recursive: true, force: true });
  fs.cpSync(build, EXT, { recursive: true });
  const file = path.join(EXT, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as { host_permissions?: string[] };
  manifest.host_permissions = [...(manifest.host_permissions ?? []), 'http://127.0.0.1/*', 'https://api.ai-box.vn/*'];
  fs.writeFileSync(file, JSON.stringify(manifest));
}

type CdpMessage = { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string; result?: unknown; error?: { message: string } };

/**
 * Adds an onInstalled listener to the next extension worker before its script runs, through the browser's
 * CDP endpoint. Every other target that starts meanwhile is let go at once. Resolves once it is in place.
 */
async function watchNextWorker(extensionId: string): Promise<{ stop(): void }> {
  const version = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json()) as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let next = 0;
  const pending = new Map<number, (m: CdpMessage) => void>();
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<CdpMessage>((resolve) => {
      const id = ++next;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const workers = new Set<string>();
  ws.onmessage = (event) => {
    const m = JSON.parse(String(event.data)) as CdpMessage;
    if (m.id !== undefined) {
      pending.get(m.id)?.(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = m.params as { sessionId: string; targetInfo: { type: string; url: string } };
      if (targetInfo.type === 'service_worker' && targetInfo.url.startsWith(`chrome-extension://${extensionId}/`)) {
        workers.add(sessionId);
        void send('Debugger.enable', {}, sessionId)
          .then(() => send('Debugger.setInstrumentationBreakpoint', { instrumentation: 'beforeScriptExecution' }, sessionId))
          .then(() => send('Runtime.runIfWaitingForDebugger', {}, sessionId));
      } else void send('Runtime.runIfWaitingForDebugger', {}, sessionId);
    }
    if (m.method === 'Debugger.paused' && m.sessionId !== undefined && workers.has(m.sessionId)) {
      const sessionId = m.sessionId;
      const [frame] = (m.params as { callFrames: { callFrameId: string }[] }).callFrames;
      const expression = `chrome.runtime.onInstalled.addListener((d) => console.log(${JSON.stringify(PROBE)} + JSON.stringify(d)))`;
      void send('Debugger.evaluateOnCallFrame', { callFrameId: frame?.callFrameId, expression }, sessionId)
        .then(() => send('Debugger.removeInstrumentationBreakpoint', { instrumentation: 'beforeScriptExecution' }, sessionId))
        .then(() => send('Debugger.resume', {}, sessionId));
    }
  };
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  return { stop: () => ws.close() };
}

async function storage(worker: Worker): Promise<{ sync: Record<string, unknown>; local: Record<string, unknown> }> {
  return worker.evaluate(async () => ({ sync: await chrome.storage.sync.get(null), local: await chrome.storage.local.get(null) }));
}

/** Opens the fixture and the panel, and does what Alt+T does (as fixtures.ts `translate`). */
async function translatePage(context: BrowserContext, worker: Worker, id: string): Promise<{ page: Page; panel: Page }> {
  const page = await context.newPage();
  await page.goto(`${FIXTURE_ORIGIN}/${PAGE}`);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await expect(panel.locator('.state, [data-testid=job]').first()).toBeVisible();
  await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    if (tab?.id === undefined) throw new Error(`no tab for ${url}`);
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.storage.session.set({ [`access:${tab.id}`]: { status: 'injecting', at: Date.now() } });
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content-scripts/content.js'] });
    await chrome.storage.session.set({ [`access:${tab.id}`]: { status: 'ready', at: Date.now() } });
  }, page.url());
  return { page, panel };
}

/** Rows in the translation cache (segments and briefs), as the panel's origin sees them. */
async function cacheRows(panel: Page): Promise<number> {
  return panel.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('translate-side-cache');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['segments', 'briefs'], 'readonly');
          const segments = tx.objectStore('segments').count();
          const briefs = tx.objectStore('briefs').count();
          tx.oncomplete = () => {
            db.close();
            resolve(segments.result + briefs.result);
          };
        };
      }),
  );
}

test.skip(!OLD || !NEW, 'run through `pnpm run e2e:upgrade`, which builds both versions');

test('an earlier build upgrades in place: settings, glossary, key and cache survive, and the cached page makes no calls', async () => {
  const fixtures = fixtureServer();
  const { server, control: mock } = mockServer();
  await listen(fixtures, FIXTURE_PORT);
  await listen(server, MOCK_PORT);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'translate-side-upgrade-'));
  install(OLD);
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--remote-debugging-port=${DEBUG_PORT}`, ...CHROMIUM_ARGS],
    viewport: { width: 1100, height: 800 },
  });
  const errors: string[] = [];
  const probe: string[] = [];
  // Closing the browser makes the worker's tab cleanup fail with "The browser is shutting down": dropped once
  // the close starts, as in fixtures.ts.
  let closing = false;
  const watch = (where: string) => (m: { type(): string; text(): string }) => {
    if (m.type() === 'error' && !(closing && /The browser is shutting down/.test(m.text()))) errors.push(`${where}: ${m.text()}`);
    if (m.text().startsWith(PROBE)) probe.push(m.text().slice(PROBE.length));
  };
  context.on('page', (p) => p.on('console', watch('page')));
  context.on('serviceworker', (w) => w.on('console', watch('worker')));
  try {
    // The provider host goes to the mock; page assets from elsewhere are answered empty (as fixtures.ts).
    let providerCalls = 0;
    await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, async (route) => {
      const url = route.request().url();
      if (!url.startsWith(PROVIDER)) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '' });
      providerCalls++;
      const response = await route.fetch({ url: MOCK_BASE_URL + url.slice(PROVIDER.length) });
      return route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
    });
    const before = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    before.on('console', watch('worker'));
    const id = new URL(before.url()).host;

    // The earlier build's settings, glossary and key (placeholder), as tests/fixtures/storage/m3.json.
    const shape = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/storage/m3.json'), 'utf8')) as { sync: Record<string, unknown>; local: Record<string, unknown> };
    await before.evaluate(async ([sync, local]) => {
      await chrome.storage.sync.set(sync);
      await chrome.storage.local.set(local);
    }, [shape.sync, shape.local] as const);
    const first = await translatePage(context, before, id);
    expect(await jobSettled(first.panel)).toBe('done');
    expect(providerCalls).toBeGreaterThan(0);
    const translated = await blockStatuses(first.panel);
    expect(translated.final).toBeGreaterThan(0);
    // The panel writes the cache as blocks land: wait until it has settled before the upgrade.
    let rows = -1;
    await expect
      .poll(
        async () => {
          const [last, now] = [rows, (rows = await cacheRows(first.panel))];
          return now > 0 && now === last;
        },
        { intervals: [500] },
      )
      .toBe(true);
    const seeded = await storage(before);
    console.log(`earlier build: ${providerCalls} provider calls, blocks ${JSON.stringify(translated)}, ${rows} cache rows`);
    await first.panel.close();
    await first.page.close();

    // The current build over the same directory, then a reload as chrome://extensions does it: an update
    // of the same extension. A reloaded unpacked extension needs developer mode (the user's toggle there).
    const extensions = await context.newPage();
    await extensions.goto('chrome://extensions');
    install(NEW);
    const watcher = await watchNextWorker(id);
    const restarted = context.waitForEvent('serviceworker');
    await extensions.evaluate(async (extensionId) => {
      const dev = (globalThis as unknown as { chrome: { developerPrivate: { updateProfileConfiguration(c: object): Promise<void>; reload(id: string, o: object): Promise<unknown> } } }).chrome.developerPrivate;
      await dev.updateProfileConfiguration({ inDeveloperMode: true });
      const error = await dev.reload(extensionId, { failQuietly: false });
      if (error) throw new Error(`reload failed: ${JSON.stringify(error)}`);
    }, id);
    const after = await restarted;
    await extensions.close();
    await expect.poll(() => probe.length).toBeGreaterThan(0);
    watcher.stop();
    const details = JSON.parse(probe[0] ?? '{}') as { reason?: string; previousVersion?: string };
    console.log(`onInstalled after the reload: ${probe[0]}`);
    expect(details.reason).toBe('update');
    expect(after.url()).toBe(`chrome-extension://${id}/background.js`);
    // An update opens no first-run guide.
    expect(context.pages().filter((p) => p.url().startsWith(`chrome-extension://${id}/`))).toEqual([]);

    // Everything the earlier build stored is still there, as it was (the migration only adds).
    await expect.poll(async () => (await storage(after)).sync.schemaVersion).toBe(1);
    const upgraded = await storage(after);
    for (const [key, value] of Object.entries(seeded.sync)) expect(upgraded.sync[key], `sync ${key}`).toEqual(value);
    for (const [key, value] of Object.entries(seeded.local)) expect(upgraded.local[key], `local ${key}`).toEqual(value);
    console.log(`kept: sync ${Object.keys(seeded.sync).join(', ')}; local ${Object.keys(seeded.local).join(', ')}`);
    console.log(`added: sync ${Object.keys(upgraded.sync).filter((k) => !(k in seeded.sync)).join(', ')}; local ${Object.keys(upgraded.local).filter((k) => !(k in seeded.local)).join(', ')}`);

    // The same page again: every block comes from the cache the earlier build filled.
    const calls = providerCalls;
    const again = await translatePage(context, after, id);
    expect(await jobSettled(again.panel)).toBe('done');
    expect(await blockStatuses(again.panel)).toEqual(translated);
    expect(providerCalls - calls, `calls after the upgrade: ${JSON.stringify(mock.calls.slice(calls).map((c) => [c.kind, c.segments.length]))}`).toBe(0);
    console.log(`current build, same page: ${providerCalls - calls} provider calls, blocks ${JSON.stringify(await blockStatuses(again.panel))}`);
    expect(mock.calls.length).toBe(calls);
  } finally {
    closing = true;
    await context.close();
    await Promise.all([new Promise((r) => fixtures.close(r)), new Promise((r) => server.close(r))]);
    fs.rmSync(profile, { recursive: true, force: true });
  }
  expect(errors, 'console errors from the worker, the panel and the page').toEqual([]);
});
