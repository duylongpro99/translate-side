/* global chrome */
// Extension-side provider run (plan M4 §3 #1, M4-F): the built extension (.output/chrome-mv3) in Chrome for
// Testing, a fixture page served from 127.0.0.1, one provider seeded into storage, the panel driven to
// translate the page, a screenshot of the result. Needs playwright-core (not a dependency of this repo):
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core  CHROME=<Chrome for Testing binary>
//   node scripts/eval/ext-run.mjs <provider> [--fixture goblog-pipelines] [--out dir] [--model id] [--reasoning low --reserve 6000] [--protocol auto|anthropic-messages]
// Providers: gemini | ollama-cloud | apibox | anthropic | openrouter | openrouter-anthropic (keys from .env, never printed).
// The build is copied to a temp dir with host_permissions for the page and the provider origin added, because a
// headless run cannot answer Chrome's permission prompt (the permission request itself is covered by unit tests).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const provider = args[0];
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const fixture = opt('fixture', 'goblog-pipelines');
const outDir = path.resolve(opt('out', 'eval-results/ext'));
fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');

const P = {
  gemini: { key: 'GEMINI_API_KEY', conn: 'gemini', profile: 'gemini-flash-lite', origin: 'https://generativelanguage.googleapis.com/*' },
  apibox: { key: 'AIBOX_API_KEY', conn: 'apibox', profile: 'apibox-qwen3.8-flash', origin: 'https://api.ai-box.vn/*' },
  'ollama-cloud': { key: 'OLLAMA_API_KEY', conn: 'ollama-cloud', origin: 'https://ollama.com/*', model: opt('model', 'gemma4:31b'), baseUrl: 'https://ollama.com/v1', presetId: 'ollama-cloud', protocol: 'openai-chat', auth: 'bearer', max: 4, chunk: 1200 },
  openrouter: { key: 'OPENROUTER_API_KEY', conn: 'openrouter', origin: 'https://openrouter.ai/*', model: opt('model', 'anthropic/claude-haiku-4.5'), baseUrl: opt('base', 'https://openrouter.ai/api/v1'), presetId: 'openrouter', protocol: 'openai-chat', auth: 'bearer', max: Number(opt('max', '2')), chunk: Number(opt('chunk', '1200')) },
  anthropic: { key: 'ANTHROPIC_API_KEY', conn: 'anthropic', profile: 'anthropic-haiku-4-5', origin: 'https://api.anthropic.com/*' },
}[provider];
if (!P) throw new Error('provider?');
const key = process.env[P.key];
if (!key) { console.log(`not run — no key (${P.key})`); process.exit(2); }

// The page.
const html = fs.readFileSync(path.join(ROOT, 'fixtures/sites', `${fixture}.html`));
const srv = http.createServer((_, res) => (res.setHeader('content-type', 'text/html; charset=utf-8'), res.end(html)));
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const pageUrl = `http://127.0.0.1:${srv.address().port}/`;

// The extension, with host permissions.
const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-'));
fs.cpSync(path.join(ROOT, '.output/chrome-mv3'), ext, { recursive: true });
const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
mf.host_permissions = ['http://127.0.0.1/*', P.origin];
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(mf));

const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'udd-'));
const ctx = await chromium.launchPersistentContext(udd, {
  executablePath: process.env.CHROME,
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run'],
  viewport: { width: 1100, height: 800 },
});
const netLog = [];
if (opt('net', '')) {
  const t00 = Date.now();
  ctx.on('request', (r) => { if (/openrouter|ollama|generativelanguage|ai-box|anthropic\.com|127\.0\.0\.1:1809[89]/.test(r.url())) r.__t = Date.now(); });
  ctx.on('response', (r) => netLog.push({ t: Date.now() - t00, url: r.url().replace(/\?.*/, ''), method: r.request().method(), status: r.status(), ms: Date.now() - (r.request().__t ?? Date.now()), from: r.request().serviceWorker() ? 'worker' : 'page' }));
  ctx.on('requestfailed', (r) => netLog.push({ t: Date.now() - t00, url: r.url().replace(/\?.*/, ''), method: r.method(), failed: r.failure()?.errorText }));
}
try {
  let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  const sync = { schemaVersion: 1, prefs: { targetLang: 'vi', sourceLang: 'auto', style: 'natural', gloss: 'first', budgetTokens: 0 }, glossary: [] };
  const local = { [`secret:${P.conn}`]: key, privacyNotice: { version: 1, at: 1 } };
  if (P.model) {
    const pid = `${P.conn}-${P.model.replace(/[^a-z0-9]+/gi, '-')}`;
    // `--protocol auto` (OpenRouter): what Auto-detect saves on a dual-protocol gateway (src/shared/connect.ts, per-protocol auth);
    // `--protocol anthropic-messages` forces that path (profile protocolOverride).
    const auto = opt('protocol', '') === 'auto' || opt('protocol', '') === 'anthropic-messages';
    sync[`conn:${P.conn}`] = { id: P.conn, label: P.conn, presetId: P.presetId, protocol: auto ? 'auto' : P.protocol, baseUrl: P.baseUrl, auth: { style: P.auth }, quirks: {}, status: 'ok', ...(auto ? { detectedProtocols: ['openai-chat', 'anthropic-messages'], authByProtocol: { 'anthropic-messages': { style: 'x-api-key' }, 'openai-chat': { style: 'bearer' } } } : {}) };
    sync[`profile:${pid}`] = { id: pid, connectionId: P.conn, model: P.model, maxConcurrency: P.max, chunkTokens: P.chunk, ...(opt('protocol', '') === 'anthropic-messages' ? { protocolOverride: 'anthropic-messages' } : {}), ...(opt('reasoning', '') ? { quirks: { reasoning: { control: 'effort', lowest: opt('reasoning', ''), reserveTokens: Number(opt('reserve', '6000')) } } } : {}) };
    sync.routing = { translate: pid };
    // `--fallback-base URL` adds a second connection and profile (an OpenAI-compatible endpoint, e.g. a mock) as the routing fallback.
    if (opt('fallback-base', '')) {
      const fb = { conn: 'fallback-conn', pid: 'fallback-profile', model: opt('fallback-model', 'mock/fallback-model') };
      sync[`conn:${fb.conn}`] = { id: fb.conn, label: 'fallback', presetId: 'custom-openai', protocol: 'openai-chat', baseUrl: opt('fallback-base', ''), auth: { style: 'bearer' }, quirks: {}, status: 'ok' };
      sync[`profile:${fb.pid}`] = { id: fb.pid, connectionId: fb.conn, model: fb.model, maxConcurrency: 2, chunkTokens: P.chunk };
      sync.routing = { translate: pid, fallback: [fb.pid] };
      local[`secret:${fb.conn}`] = key;
    }
  } else sync.routing = { translate: P.profile };
  await sw.evaluate(async ([s, l]) => { await chrome.storage.sync.set(s); await chrome.storage.local.set(l); }, [sync, local]);

  const page = await ctx.newPage();
  await page.goto(pageUrl);
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await page.bringToFront();
  await panel.waitForTimeout(1500);
  await panel.screenshot({ path: path.join(outDir, `${provider}-0-before.png`) });
  // Alt+T / the toolbar icon cannot be pressed from a script: do what the worker's action handler does
  // (src/shared/inject.ts): inject the content script and write the tab's access record.
  await sw.evaluate(async (u) => {
    const [t] = await chrome.tabs.query({ url: u + '*' });
    await chrome.tabs.update(t.id, { active: true });
    await chrome.storage.session.set({ [`access:${t.id}`]: { status: 'injecting', at: Date.now() } });
    await chrome.scripting.executeScript({ target: { tabId: t.id, frameIds: [0] }, files: ['content-scripts/content.js'] });
    await chrome.storage.session.set({ [`access:${t.id}`]: { status: 'ready', at: Date.now() } });
  }, pageUrl);
  const job = panel.locator('[data-testid=job]');
  const t0 = Date.now();
  await job.waitFor({ timeout: 30000 });
  await panel.waitForFunction(() => { const j = document.querySelector('[data-testid=job]'); return j && j.getAttribute('data-status') !== 'running'; }, null, { timeout: Number(opt('timeout', '300')) * 1000 }).catch(() => {});
  const status = await job.getAttribute('data-status');
  const text = (await job.innerText()).replace(/\s+/g, ' ');
  const cost = (await panel.locator('[data-testid=job-cost]').first().innerText().catch(() => '')) || null;
  const costTitle = await panel.locator('[data-testid=job-cost]').first().getAttribute('title').catch(() => null);
  const failedBlocks = await panel.locator('[data-status=failed]').count();
  await panel.screenshot({ path: path.join(outDir, `${provider}.png`) });
  const result = { provider, model: P.model ?? null, status, jobText: text, cost, costTitle, failedBlocks, wallSeconds: Math.round((Date.now() - t0) / 100) / 10 };
  fs.writeFileSync(path.join(outDir, `${provider}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (opt('net', '')) console.log('NET ' + JSON.stringify(netLog.filter((e) => /openrouter|127\.0\.0\.1:1809[89]/.test(e.url))));
  console.log(JSON.stringify({ extId, pageUrl }));
  await new Promise((r) => setTimeout(r, Number(opt('wait', '0')) * 1000));
} finally {
  await ctx.close();
  srv.close();
  fs.rmSync(udd, { recursive: true, force: true });
  fs.rmSync(ext, { recursive: true, force: true });
}
