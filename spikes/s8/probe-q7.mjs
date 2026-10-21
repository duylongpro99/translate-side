// Q7 of spike S8: does Playwright's `context.addInitScript` reach `chrome-extension://<id>/` pages
// before the page's own scripts, so that a fake `Translator` / `LanguageModel` replaces the real ones
// of Chrome for Testing? Launched the way e2e/fixtures.ts launches the product (persistent context,
// channel `chromium`, --load-extension), with spikes/s8/ext as the extension.
//
// ext/probe.js is the panel's first script: it records `typeof Translator` and the fake's marker in
// `__s8AtLoad` before anything else runs. The probe reads it for:
//   1. a baseline context with no init script (does Chrome for Testing expose the real APIs?);
//   2. a context with the fake, the panel opened by `page.goto`;
//   3. the same context, the panel opened by the extension itself (`chrome.tabs.create` in the worker);
//   4. the extension's service worker (init scripts are for pages; recorded for completeness).
// With the fake in place it also clicks through the panel's harness (availability, create, Q3, Q4)
// as a smoke test of the spike's own code, since no real Nano runs here.
//
// Run from the repository root after `node spikes/s8/build.mjs`: `node spikes/s8/probe-q7.mjs`.
// Writes spikes/s8/results/q7.json.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const HERE = import.meta.dirname;
const EXT = path.join(HERE, 'ext');
const OUT = path.join(HERE, 'results');
// The flags e2e/playwright.config.ts CHROMIUM_ARGS passes (a background-tab panel would otherwise be throttled).
const ARGS = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];

function playwrightVersion() {
  const require = createRequire(import.meta.url);
  try {
    return require('@playwright/test/package.json').version;
  } catch {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve('@playwright/test')), 'package.json'), 'utf8')).version;
  }
}

/** The fake built-in AI, installed by addInitScript. Marked with `__s8Fake`. Plain enough to drive the harness. */
function installFake() {
  const est = (t) => Math.ceil(String(t).length / 3.5);
  const segs = (text) => [...String(text).matchAll(/<seg id="(\d+)"((?: n="[^"]*")?)>([\s\S]*?)<\/seg>/g)];
  class FakeSession {
    constructor(system) {
      this.system = system;
      this.contextWindow = 4096;
      this.contextUsage = est(system);
    }
    async clone() {
      return new FakeSession(this.system);
    }
    async measureContextUsage(text) {
      return est(text);
    }
    addEventListener() {}
    destroy() {}
    promptStreaming(input, options = {}) {
      const need = this.contextUsage + est(input);
      const found = segs(input);
      const answer = options.responseConstraint ? JSON.stringify(found.map((m) => `ES ${m[3]}`)) : found.map((m) => `<seg id="${m[1]}"${m[2]}>ES ${m[3]}</seg>`).join('\n');
      const window = this.contextWindow;
      return (async function* () {
        if (need > window) throw new DOMException(`input too large: ${need} > ${window}`, 'QuotaExceededError');
        for (let i = 0; i < answer.length; i += 40) yield answer.slice(i, i + 40);
      })();
    }
  }
  const LanguageModel = {
    __s8Fake: true,
    availability: async (o) => (o?.expectedOutputs?.[0]?.languages?.[0] === 'vi' ? 'unavailable' : 'available'),
    params: async () => ({ defaultTopK: 3, maxTopK: 8, defaultTemperature: 1, maxTemperature: 2 }),
    create: async (o = {}) => new FakeSession(o.initialPrompts?.[0]?.content ?? ''),
  };
  const Translator = {
    __s8Fake: true,
    availability: async () => 'available',
    create: async (o) => ({ inputQuota: Infinity, translate: async (t) => `[${o.targetLanguage}] ${t}`, destroy() {} }),
  };
  globalThis.LanguageModel = LanguageModel;
  globalThis.Translator = Translator;
}

async function launch() {
  return chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, ...ARGS],
  });
}

async function workerOf(context) {
  return context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
}

/** What the panel's first script saw, and what the page sees now. */
async function readPanel(page) {
  await page.waitForFunction(() => globalThis.__s8AtLoad !== undefined);
  return page.evaluate(() => ({
    url: location.protocol + '//<id>' + location.pathname,
    atLoad: globalThis.__s8AtLoad,
    chromeRuntime: typeof globalThis.chrome?.runtime,
    now: { Translator: typeof globalThis.Translator, translatorFake: globalThis.Translator?.__s8Fake === true, languageModelFake: globalThis.LanguageModel?.__s8Fake === true },
  }));
}

async function versions(page) {
  return page.evaluate(async () => {
    const ua = await navigator.userAgentData?.getHighEntropyValues(['fullVersionList', 'platform', 'platformVersion', 'architecture']);
    return { userAgent: navigator.userAgent, fullVersionList: ua?.fullVersionList, platform: ua?.platform, platformVersion: ua?.platformVersion, architecture: ua?.architecture };
  });
}

const entries = (page, kind) => page.evaluate((k) => globalThis.__s8Log?.filter((e) => e.kind === k) ?? [], kind);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // The build Playwright launches for channel `chromium` (its folder and app name, no home path).
  const result = { ranAt: new Date().toISOString(), playwright: playwrightVersion(), browserBuild: chromium.executablePath().split(path.sep).slice(-6, -3).join('/') };

  // 1. Baseline: no init script.
  {
    const context = await launch();
    try {
      const worker = await workerOf(context);
      const id = new URL(worker.url()).host;
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/sidepanel.html`);
      result.browser = await versions(page);
      result.baseline = await readPanel(page);
      result.baseline.realAvailability = await page.evaluate(async () => {
        const out = {};
        const t = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r('timeout 5 s'), 5000))]);
        try {
          out.translatorEnEs = typeof Translator === 'undefined' ? 'no API' : await t(Translator.availability({ sourceLanguage: 'en', targetLanguage: 'es' }));
        } catch (e) {
          out.translatorEnEs = `${e.name}: ${e.message}`;
        }
        try {
          out.languageModel = typeof LanguageModel === 'undefined' ? 'no API' : await t(LanguageModel.availability());
        } catch (e) {
          out.languageModel = `${e.name}: ${e.message}`;
        }
        return out;
      });
      result.baseline.worker = await worker.evaluate(() => ({ Translator: typeof self.Translator, LanguageModel: typeof self.LanguageModel }));
    } finally {
      await context.close();
    }
  }

  // 2–4. The fake, installed for the whole context before any page opens.
  {
    const context = await launch();
    const pageErrors = [];
    context.on('page', (p) => p.on('pageerror', (e) => pageErrors.push(`${p.url().replace(/^chrome-extension:\/\/[a-z]+/, 'chrome-extension://<id>')}: ${e.message}\n${e.stack ?? ''}`)));
    try {
      await context.addInitScript(installFake);
      const worker = await workerOf(context);
      const id = new URL(worker.url()).host;
      const url = `chrome-extension://${id}/sidepanel.html`;

      const viaGoto = await context.newPage();
      await viaGoto.goto(url);
      result.viaGoto = await readPanel(viaGoto);

      const opened = context.waitForEvent('page');
      await worker.evaluate((u) => chrome.tabs.create({ url: u }), url);
      const viaExtension = await opened;
      await viaExtension.waitForLoadState('load');
      result.viaExtensionTab = await readPanel(viaExtension);

      // window.open from the panel itself (an extension page opening another).
      const popupP = context.waitForEvent('page');
      await viaGoto.evaluate((u) => void window.open(u), url);
      const popup = await popupP;
      await popup.waitForLoadState('load');
      result.viaWindowOpen = await readPanel(popup);

      result.worker = await worker.evaluate(() => ({ Translator: typeof self.Translator, translatorFake: self.Translator?.__s8Fake === true }));

      // Smoke test of the spike's harness against the fake (proves the panel opens and its code runs).
      const p = viaGoto;
      const until = async (kind, n = 1) => {
        for (let i = 0; i < 300; i++) {
          if ((await entries(p, kind)).length >= n) return entries(p, kind);
          await p.waitForTimeout(100);
        }
        throw new Error(`no ${kind} entry`);
      };
      await p.click('#avail');
      await until('availability.done');
      await p.click('#tr-click');
      await until('Translator.translate');
      await p.click('#nano-click');
      await until('LanguageModel.create.ok');
      await p.click('#q4-limits');
      await until('q4.limits');
      await p.click('#q4-speed');
      await until('q4.speed');
      await p.click('#q4-max');
      await until('q4.max.roundtrip');
      await p.click('#q3-format');
      const es = await until('q3.summary', 2);
      await p.selectOption('#nano-tgt', 'en');
      await p.click('#q3-format');
      const en = await until('q3.summary', 4);
      const pick = (e) => ({ format: e.format, sourceLang: e.sourceLang, target: e.target, chunks: e.chunks, segments: e.segments, segmentsFailed: e.segmentsFailed });
      result.harnessSmoke = {
        availability: (await entries(p, 'availability')).map((e) => `${e.label}: ${e.state}`),
        translate: (await entries(p, 'Translator.translate'))[0]?.output,
        q4Limits: (await entries(p, 'q4.limits'))[0],
        q4Speed: (({ output, ...rest }) => rest)((await entries(p, 'q4.speed'))[0]),
        q4Measured: (await entries(p, 'q4.max.measured'))[0],
        q4Confirm: await entries(p, 'q4.max.confirm'),
        q3: [...es.slice(0, 2), ...en.slice(2, 4)].map(pick),
        errors: (await p.evaluate(() => globalThis.__s8Log.filter((e) => e.kind.endsWith('error')))).map((e) => `${e.kind}: ${JSON.stringify(e.error)}`),
      };
      result.pageErrors = pageErrors;
    } finally {
      await context.close();
    }
  }

  fs.writeFileSync(path.join(OUT, 'q7.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

await main();
