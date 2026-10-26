// Wires the page sessions (controller.ts) to the translation jobs (jobs.ts): a page the user asked
// for is translated at once (DESIGN.md §3 "starts translating at once"), its job stops when the page
// goes away, and settings changes restart a job that was waiting for them. A page reached by a
// navigation is translated on its own only on an allowlisted site; elsewhere it waits for
// **Translate this page** (plan M5-E3, §8). A page that changes under the panel (an SPA, plan M5-E2)
// is translated again from the cache, so only new or changed blocks are sent.
import type { browser } from 'wxt/browser';
import { i18n } from '#i18n';
import { chromeLanguageDetector, detectionSample, detectSourceLanguage, MIXED_LANGUAGE_DETECTION, normalizeLang, sameLanguage, segmentsInLanguage, type LanguageDetectorPort } from '@/shared/language';
import type { GlossaryEntry } from '@/engine/types';
import { featureAvailable } from '@/shared/features';
import { QUALITY_KEY, readQuality, requestedStrategy, type Quality } from '@/shared/quality';
import { GLOSSARY_KEY, ON_DEVICE_CONNECTION, PREFS_KEY, readGlossary, readPreferences, SECRET_PREFIX, type Preferences } from '@/shared/settings';
import type { ReadInfo, SessionHooks } from './controller.ts';
import type { ExtractResult } from '@/shared/protocol';
import { addAllowlisted, cleanSiteList, hasSitePermission, isNeverTranslate, listedFor, readSiteLists, requestSitePermission, siteMode, siteOf, SITE_NEVER_KEY } from '@/shared/sites';
import { OfferStore } from './offers.ts';
import type { JobActions } from './JobBar.tsx';
import { openTranslationCache } from '@/shared/cache';
import { openTranslationMemory, readAcrossSites } from '@/shared/memory';
import { checkSpendLimit, continuePastLimit, SpendLedger } from '@/shared/spend';
import { createDiagnosticsLog } from '@/shared/diagnostics';
import { anyDenylisted, clearSnippet, readSnippet, tabIdFromSnippetKey, type SnippetRecord } from '@/shared/snippet';
import { NANO_MODEL } from '@/llm/chrome-builtin';
import { CHROME_TRANSLATOR_MODEL } from '@/llm/chrome-translator';
import { chromeTranslator } from '@/llm/chrome-translator';
import { prepareOnDevice, type OnDeviceEngine } from '@/llm/on-device';
import { openOnboarding } from '@/shared/onboarding';
import { Jobs, type JobDeps, type JobDoc, type PrivacyPort } from './jobs.ts';
import { snippetDocId, snippetView, SnippetStore } from './snippet.ts';
import { chooseForTab, makeDefault, readSwitcher, type SwitcherState } from './switcher.ts';
import { isErrorStatusWrite, onProviderSettingsChanged, readProviderSettings, saveConnectionStatus, siteRuleFor } from '@/shared/providers';
import { onListChanged } from '@/shared/sync-quota';
import { routedSummary, translateClient, type Routed, type RouteTarget } from './route.ts';
import { ViewportStore } from './viewport.ts';
import { HoverStore } from './hover.ts';
import { PrivacyGate } from './privacy.ts';
import { PrefsStore } from './prefs.ts';

type Browser = typeof browser;

export interface Translator {
  jobs: Jobs;
  /** The selection, translated on its own (plan M3-E4): its jobs (one per tab, same Jobs class) and the records behind them. */
  snippets: { jobs: Jobs; store: SnippetStore; actions(tabId: number): JobActions; close(tabId: number): void };
  /** What is on screen per tab (scroll follow, plan M3-E7). */
  viewports: ViewportStore;
  /** Which block the pointer is over on each tab's page (hover link, plan M5-E1). */
  hovers: HoverStore;
  /** The first-run privacy notice (plan M3-E10): nothing is sent before it is acknowledged. */
  privacy: PrivacyGate;
  /** The preferences the header shows and switches (plan M3-E6). */
  prefs: PrefsStore;
  /** Pages read but not translated on their own (plan M5-E3): Translate this page, or never on this site. */
  offers: OfferStore;
  /** Translate this page (the offer's button). */
  translatePage(tabId: number): void;
  /**
   * Always translate on this site: asks for the site's host permission (call it first in the click
   * handler, it needs the gesture), allowlists it, and translates the page. Resolves whether it was granted.
   */
  allowSite(tabId: number): Promise<boolean>;
  hooks: SessionHooks;
  actions(tabId: number): JobActions;
  /** The model and provider the translate role resolves to for a tab and page now (§4.3.5), for the header and the privacy notice. */
  routed(target: RouteTarget): Promise<Routed | undefined>;
  /** The quick switcher (plan M4-E11): the models to choose from for a tab, a tab-only choice, and "Make default". */
  switcher: {
    read(target: RouteTarget): Promise<SwitcherState>;
    /** This tab only (the routing is not touched), then the page is translated again under it; `undefined` goes back to the default. */
    choose(tabId: number, profileId: string | undefined): Promise<void>;
    makeDefault(tabId: number, profileId: string): Promise<void>;
  };
  /** Settings listeners and the panel-close cancel. Returns the cleanup. */
  watch(activeTab: () => number | undefined): () => void;
}

/** The job stopped because on-device translation can't run yet: Chrome may have changed that meanwhile. */
const ON_DEVICE_STOPS: ReadonlySet<unknown> = new Set(['onDeviceSetup', 'onDeviceDownloading', 'onDeviceUnavailable']);

export interface TranslatorOptions {
  /** The language-detection port (plan M2-E5); default Chrome's LanguageDetector when the browser has one. */
  detector?: LanguageDetectorPort | undefined;
  /** Per-segment detection for mixed-language pages; default MIXED_LANGUAGE_DETECTION (off). */
  mixedLanguage?: boolean;
  /** The first-run privacy notice; default one over `api.storage.local`. */
  privacy?: PrivacyGate;
  /** Where Chrome's built-in AI lives (`Translator`, `LanguageModel`); default the panel's window. */
  scope?: object;
}

/** What a job reads from the settings: the preferences, the personal glossary and the quality setting (all storage.sync). */
interface Settings {
  prefs: Preferences;
  glossary: GlossaryEntry[];
  quality: Quality;
}

async function readSettings(api: Browser): Promise<Settings> {
  const [prefs, glossary, quality] = await Promise.all([readPreferences(api), readGlossary(api), readQuality(api)]);
  return { prefs, glossary, quality };
}

/** Why "Continue anyway" could not go on (review 3 #3): the bar shows it instead of nothing. */
const limitFailure = (err: unknown) => i18n.t('panel.job.limitSaveFailed', [err instanceof Error ? err.message : String(err)]);

export function createTranslator(api: Browser, deps: Partial<JobDeps> = {}, options: TranslatorOptions = {}): Translator {
  // The running total in settings (M3-E9): pages and selections alike.
  const ledger = new SpendLedger(api);
  // The local diagnostics log (Settings exports it): page jobs only, never a selection's.
  const diagnostics = createDiagnosticsLog(api);
  deps = {
    onSpend: (delta) => void ledger.add(delta),
    onJobRecord: (record) => void diagnostics.record(record),
    // §4.3.5: a key the provider refused marks its connection `error` in settings ("Fix key" there too).
    onAuthError: (connectionId, error) =>
      void saveConnectionStatus(api, connectionId, { status: 'error', lastError: error.message, lastErrorKind: 'auth' }).catch((err: unknown) => {
        console.warn('[translate-side] could not mark the connection', err);
      }),
    spendLimit: () => checkSpendLimit(api),
    ...deps,
  };
  // Chrome's Translator, the `basic` fallback's translator (M5-E7); undefined in a browser without it.
  const scope = options.scope ?? globalThis;
  const privacy = options.privacy ?? new PrivacyGate(api);
  /** The gate as one Jobs asks it: page and selection jobs of a tab wait apart. */
  const gateFor = (prefix: string): PrivacyPort => ({
    acknowledged: () => privacy.state === 'acknowledged',
    whenAcknowledged: (key, run) => privacy.whenAcknowledged(`${prefix}:${key}`, run),
    forget: (key) => privacy.forget(`${prefix}:${key}`),
  });
  const mt = 'mt' in deps ? deps.mt : chromeTranslator(scope);
  const jobs = new Jobs({ translateClient: (target) => translateClient(api, target, scope), privacy: gateFor('page'), cache: openTranslationCache(), memory: openTranslationMemory(), siteLocalOnly: async (url) => siteRuleFor((await readProviderSettings(api)).routing, url)?.localOnly === true, featureAvailable, acrossSites: () => readAcrossSites(api.storage.local), ...deps, mt });
  // The corrections for the language in use are read while the panel opens, not on the first run's way.
  void readPreferences(api).then((p) => jobs.warmMemory(p.targetLang), () => {});
  // No cache and no translation memory: a selection is a one-off, and its text is not kept beyond the session.
  // Single-pass: one request per chunk, never the contextual brief (analyze) call for a selection.
  const snippetJobs = new Jobs({ translateClient: (target) => translateClient(api, target, scope), privacy: gateFor('snippet'), ...deps, mt, strategy: 'single-pass', cache: undefined, memory: undefined, lazyAbove: Infinity, onJobRecord: undefined });
  const snippetStore = new SnippetStore();
  const viewports = new ViewportStore();
  const hovers = new HoverStore();
  const detector = 'detector' in options ? options.detector : chromeLanguageDetector();
  const mixed = options.mixedLanguage ?? MIXED_LANGUAGE_DETECTION;
  const prefs = new PrefsStore(api);
  const offers = new OfferStore();
  /** The turn-on downloads in flight, per tab job (pages and selections apart), for Cancel. */
  const downloads = new Map<string, AbortController>();
  const pageKey = (tabId: number) => `page:${tabId}`;
  const snippetKey = (tabId: number) => `snippet:${tabId}`;

  /**
   * The job document for a page under these preferences: its source language from the detection
   * chain (src/shared/language.ts), and whether it is already in the target language (skip, no
   * model call). With per-segment detection on, the segments already in the target language are
   * kept as they are, and the page is skipped only when nothing else is left.
   */
  const docFor = async ({ prefs, glossary, quality }: Settings, url: string, title: string, pageLang: string | undefined, segments: JobDoc['segments']): Promise<{ doc: JobDoc; skip: boolean }> => {
    const detection = await detectSourceLanguage({ override: prefs.sourceLang === 'auto' ? undefined : prefs.sourceLang, sample: detectionSample(segments), pageLang }, detector);
    void jobs.warmMemory(prefs.targetLang);
    const base = { url, title, ...(pageLang === undefined ? {} : { pageLang }), sourceLang: detection.lang, targetLang: prefs.targetLang, detection, segments, style: prefs.style, gloss: prefs.gloss, glossary, budgetTokens: prefs.budgetTokens, media: { captions: prefs.captions, altText: prefs.altText }, strategy: requestedStrategy(quality), ...(quality.keepDraftsOnScreen && requestedStrategy(quality) === 'refine' ? { keepDraftsOnScreen: true } : {}) };
    if (!mixed) return { doc: base, skip: sameLanguage(detection.lang, prefs.targetLang) };
    const keep = await segmentsInLanguage(segments, prefs.targetLang, detector);
    const left = segments.some((s) => s.translate && !keep.has(s.id));
    return { doc: keep.size ? { ...base, keep } : base, skip: !left && segments.some((s) => s.translate) };
  };

  /**
   * The raw settings (prefs + personal glossary) each tab's job was built from, to skip detection
   * when nothing changed. A key is marked before the detection await, so two refreshes in flight
   * (onSync and `active` together) restart the job once (review N2); `unmark` puts the old key
   * back when the job was not rebuilt after all.
   */
  const used = new Map<number, string>();
  const settingsKey = (settings: Settings) => JSON.stringify([settings.prefs, settings.glossary, settings.quality]);
  const mark = (tabId: number, key: string) => {
    const before = used.get(tabId);
    used.set(tabId, key);
    return () => {
      if (used.get(tabId) !== key) return;
      if (before === undefined) used.delete(tabId);
      else used.set(tabId, before);
    };
  };

  /**
   * The job document under `settings`, detected with their key marked (mark). Undefined when that
   * read was overtaken: the detection failed (the old key is put back, review R2), or newer
   * settings were marked meanwhile, e.g. A→B then B→A while B was detected (review R1): the newer
   * read decides.
   */
  const prepare = async (tabId: number, settings: Settings, page: { url: string; title: string; pageLang?: string | undefined; segments: JobDoc['segments'] }) => {
    const key = settingsKey(settings);
    const unmark = mark(tabId, key);
    try {
      const prepared = await docFor(settings, page.url, page.title, page.pageLang, page.segments);
      return used.get(tabId) === key ? { prepared, unmark } : undefined;
    } catch {
      unmark();
      return undefined;
    }
  };

  const begin = (tabId: number, docId: string, prepared: { doc: JobDoc; skip: boolean }, opts?: { keepCost?: boolean; keepBrief?: boolean }) =>
    prepared.skip ? jobs.skip(tabId, docId, prepared.doc) : jobs.start(tabId, docId, prepared.doc, opts);

  /** What differs between a job's document and one built from the current settings. */
  const changes = (doc: JobDoc, next: JobDoc) => ({
    languages: next.targetLang !== doc.targetLang || next.sourceLang !== doc.sourceLang,
    output: next.style !== doc.style || next.gloss !== doc.gloss || next.media?.captions !== doc.media?.captions || next.media?.altText !== doc.media?.altText || JSON.stringify(next.glossary ?? []) !== JSON.stringify(doc.glossary ?? []),
    quality: next.strategy !== doc.strategy || (next.keepDraftsOnScreen ?? false) !== (doc.keepDraftsOnScreen ?? false),
  });

  /** The document each tab's session holds now: a job starts only for a page that is still there. */
  const live = new Map<number, string>();
  const isLive = (tabId: number, docId: string) => live.get(tabId) === docId;

  /**
   * Translates the tab's page again, from scratch, if the settings changed since its job started
   * (languages, style, gloss setting, personal glossary): the earlier runs' cost stays in the page
   * total (review E-R3), and the brief stays when the target language is the same (plan M2 §7
   * demo 4–5). Called on a settings change for the active tab, and when a tab becomes active, so
   * an edit made in the options tab applies once the page's tab is back in front.
   *
   * Cheap when nothing changed: the raw settings are compared first, and the page's language is
   * detected again only when they differ (review). A job the user cancelled is never restarted:
   * Resume picks up the new settings (resume below).
   */
  const refresh = (tabId: number) => {
    const current = jobs.docFor(tabId);
    if (current === undefined) return;
    const { doc, docId } = current;
    const stillThere = () => isLive(tabId, docId) && jobs.docOf(tabId) === docId && jobs.get(tabId)?.status !== 'cancelled';
    if (!stillThere()) return;
    void readSettings(api).then(async (settings) => {
      const key = settingsKey(settings);
      if (key === used.get(tabId)) return;
      const got = await prepare(tabId, settings, doc);
      if (got === undefined) return;
      const { prepared: next, unmark } = got;
      const { languages, output, quality } = changes(doc, next.doc);
      // Same job either way (e.g. an unrelated preference): the key stays, no detection next time.
      if (!languages && !output && !quality) return;
      if (stillThere()) void begin(tabId, docId, next, { keepCost: true, keepBrief: !languages });
      else unmark();
    });
  };

  /**
   * Resume (the button, a granted access, a saved key) with the current settings (review N3): a
   * job cancelled or stopped under other settings would otherwise mix the old style and glossary
   * with the new. Unchanged settings: the job's leftover segments are translated. Changed: the
   * page is translated from scratch with the new ones, its cost kept, and its brief kept when the
   * target language is the same (jobs.start). A page skipped as already in the target language is
   * translated anyway, as Resume asks.
   */
  const resume = (tabId: number) => {
    const current = jobs.docFor(tabId);
    if (current === undefined || jobs.get(tabId)?.status === 'running') return;
    const { doc, docId } = current;
    void readSettings(api).then(async (settings) => {
      const key = settingsKey(settings);
      if (key === used.get(tabId)) return void jobs.resume(tabId);
      const got = await prepare(tabId, settings, doc);
      if (got === undefined) return;
      const { prepared: next, unmark } = got;
      if (jobs.docOf(tabId) !== docId || jobs.get(tabId)?.status === 'running') return unmark();
      const { languages, output, quality } = changes(doc, next.doc);
      if (!languages && !output && !quality) return void jobs.resume(tabId);
      void jobs.start(tabId, docId, next.doc, { keepCost: true, keepBrief: true });
    });
  };

  /**
   * Retranslate page (the header, plan M3-E6): the whole page again with the current settings,
   * skipping the translation cache (decision M3-D2: what it produces replaces the stored entries),
   * a running job included. The page's cost so far stays in its total. A page skipped as already
   * in the target language is translated anyway: the user asked.
   */
  const retranslate = (tabId: number) => {
    const current = jobs.docFor(tabId);
    if (current === undefined) return;
    const { doc, docId } = current;
    void readSettings(api).then(async (settings) => {
      const got = await prepare(tabId, settings, doc);
      if (got === undefined) return;
      if (jobs.docOf(tabId) !== docId || !isLive(tabId, docId)) return got.unmark();
      void jobs.start(tabId, docId, got.prepared.doc, { fresh: true, keepCost: true });
    });
  };

  /**
   * A selection arrived (the worker left it in storage.session): translate it now, whatever the
   * page is (plan M3-E4). The user's click was the explicit action that lets it go to the provider
   * (§8); a record from a denylisted site, or whose url is one, is shown as blocked and never sent
   * (M3-D13), however it got here. The same record twice is the same click.
   */
  const takeSnippet = async (tabId: number, record: SnippetRecord) => {
    if (snippetStore.get(tabId)?.docId === snippetDocId(record)) return;
    const blocked = record.blocked ?? (anyDenylisted(record.url) ? 'denylisted' : (await isNeverTranslate(api, record.url)) ? 'never' : undefined);
    if (snippetStore.get(tabId)?.docId === snippetDocId(record)) return;
    const view = snippetView(blocked ? { at: record.at, url: record.url, blocked } : record);
    snippetJobs.drop(tabId);
    snippetStore.set(tabId, view);
    if (view.blocked || view.segments.length === 0) return;
    const translate = async (): Promise<void> => {
      const settings = await readSettings(api);
      // Detection only informs the prompt; a selection already in the target language is still translated (the user asked).
      const { doc } = await docFor(settings, view.url, '', normalizeLang(view.lang) || pageLanguage(tabId, view.url), view.segments);
      if (snippetStore.get(tabId)?.docId !== view.docId) return;
      // A route that sends text off the device waits for the first-run privacy notice (jobs.ts).
      void snippetJobs.start(tabId, view.docId, doc);
    };
    await translate();
  };
  /**
   * What the panel already knows of the language of the page a selection came from, for when the
   * detector can't tell from the selection (too short) and the record names none (a context-menu
   * click): the page job's detected language, else the last read's `<html lang>`. Undefined for
   * another page or one not read yet.
   */
  const pageLanguage = (tabId: number, url: string): string | undefined => {
    const doc = jobs.docFor(tabId)?.doc;
    if (doc?.url === url && doc.sourceLang) return doc.sourceLang;
    const read = latest.get(tabId)?.result;
    return read?.url === url ? read.lang : undefined;
  };
  const closeSnippet = (tabId: number) => {
    snippetJobs.drop(tabId);
    snippetStore.clear(tabId);
    clearSnippet(api, tabId).catch(() => {});
  };
  const loadSnippet = (tabId: number) => {
    readSnippet(api, tabId).then((record) => (record ? takeSnippet(tabId, record) : undefined)).catch(() => {});
  };

  /** The latest read of each tab's document, for Translate this page and the SPA updates. */
  type Page = Extract<ExtractResult, { ok: true }>;
  const latest = new Map<number, { docId: string; result: Page }>();
  const isLatest = (tabId: number, result: Page) => latest.get(tabId)?.result === result;
  /** A same-page update that arrived while the page's job was running: applied when it ends (no request in flight is thrown away). */
  const pending = new Map<number, { docId: string; result: Page }>();

  /** Translates a read of the page, once the first-run privacy notice allows it (M3-E10). */
  const translateRead = (tabId: number, docId: string, result: Page, opts: { keepCost?: boolean; keepBrief?: boolean } = {}): void =>
    void readSettings(api).then(async (settings) => {
      const got = await prepare(tabId, settings, { url: result.url, title: result.title, pageLang: result.lang, segments: result.segments });
      if (got === undefined) return;
      // The page may have gone, been read again, or the tab closed, while the settings were read (review E-R1).
      if (!isLive(tabId, docId) || !isLatest(tabId, result)) return got.unmark();
      // A site on the never-translate list (sites.ts): nothing is sent, the page says why.
      const never = await isNeverTranslate(api, result.url);
      if (!isLive(tabId, docId) || !isLatest(tabId, result)) return got.unmark();
      if (never) {
        got.unmark();
        return hold(tabId, docId, result, 'never');
      }
      // Nothing leaves the device before the first-run privacy notice is acknowledged (M3-E10):
      // the job checks it on the route it resolves, so an on-device route never waits for it.
      begin(tabId, docId, got.prepared, opts);
    });

  /** The page is shown as the original and waits (an offer); a job of an earlier read of it is let go. */
  const hold = (tabId: number, docId: string, result: Page, reason: 'ask' | 'never') => {
    pending.delete(tabId);
    if (jobs.docOf(tabId) === docId) jobs.drop(tabId);
    jobs.setViewport(tabId, docId, result.visible ?? [], result.fixed);
    offers.set(tabId, { docId, url: result.url, reason, site: siteOf(result.url) });
  };

  /**
   * The same page changed (an SPA rendered more, or changed blocks, plan M5-E2). A page that waits
   * for Translate this page keeps waiting; one the user cancelled waits again (its old blocks are
   * gone); otherwise it is translated again under the same brief and cost, from the cache, so only
   * new or changed blocks are sent. A running job finishes first.
   */
  const updatePage = (tabId: number, docId: string, result: Page) => {
    const offer = offers.get(tabId);
    if (offer?.docId === docId) return offers.set(tabId, { ...offer, url: result.url });
    const status = jobs.docOf(tabId) === docId ? jobs.get(tabId)?.status : undefined;
    if (status === 'running') return void pending.set(tabId, { docId, result });
    if (status === 'cancelled') return hold(tabId, docId, result, 'ask');
    translateRead(tabId, docId, result, { keepCost: true, keepBrief: true });
  };
  jobs.subscribe((tabId, view) => {
    const next = pending.get(tabId);
    if (!next || view?.status === 'running') return;
    pending.delete(tabId);
    if (view === undefined) return;
    // The run's last finals are still being stored: the next run reads them from the cache.
    void jobs.cacheIdle().then(() => {
      if (isLatest(tabId, next.result) && isLive(tabId, next.docId) && !pending.has(tabId)) updatePage(tabId, next.docId, next.result);
    });
  });

  /**
   * What a read of the page leads to: never on a never-translate site; at once when the user asked
   * (a gesture) or the site is allowlisted with its permission held; otherwise Translate this page.
   */
  const onRead = async (tabId: number, docId: string, result: Page, read: ReadInfo) => {
    // Asked for: at once (translateRead still checks the never-translate list before sending).
    if (read.asked && !read.update) {
      pending.delete(tabId);
      offers.clear(tabId);
      return translateRead(tabId, docId, result);
    }
    const lists = await readSiteLists(api).catch(() => ({ allow: [], never: [] }));
    if (!isLatest(tabId, result)) return;
    const mode = siteMode(lists, result.url);
    if (mode === 'never') return hold(tabId, docId, result, 'never');
    if (read.update && !read.update.urlChanged) return updatePage(tabId, docId, result);
    const auto = read.asked || (mode === 'allow' && (await hasSitePermission(api, result.url)));
    if (!isLatest(tabId, result)) return;
    if (!auto) return hold(tabId, docId, result, 'ask');
    pending.delete(tabId);
    offers.clear(tabId);
    translateRead(tabId, docId, result);
  };

  const translatePage = (tabId: number) => {
    const offer = offers.get(tabId);
    const page = latest.get(tabId);
    if (offer?.reason !== 'ask' || !page || page.docId !== offer.docId || !isLive(tabId, page.docId)) return;
    offers.clear(tabId);
    translateRead(tabId, page.docId, page.result);
  };

  const allowSite = async (tabId: number): Promise<boolean> => {
    const site = offers.get(tabId)?.site ?? siteOf(latest.get(tabId)?.result.url);
    if (!site) return false;
    // First await in the click handler: the prompt needs the gesture (S5).
    const granted = await requestSitePermission(api, site);
    if (!granted) return false;
    await addAllowlisted(api, site);
    translatePage(tabId);
    return true;
  };

  const forgetPage = (tabId: number) => {
    live.delete(tabId);
    latest.delete(tabId);
    pending.delete(tabId);
    offers.clear(tabId);
  };

  const hooks: SessionHooks = {
    ready(tabId, docId, result, read = { asked: true }) {
      live.set(tabId, docId);
      latest.set(tabId, { docId, result });
      // Viewport first (plan M3-E1): what was on screen when the page was read.
      jobs.setViewport(tabId, docId, result.visible ?? [], result.fixed);
      // And where it was, so scroll follow (M3-E7) lines the panel up before the first scroll.
      viewports.set(tabId, docId, { visible: result.visible ?? [], ...(result.anchor ? { anchor: result.anchor } : {}) });
      void onRead(tabId, docId, result, read);
    },
    gone: (tabId) => {
      hovers.set(tabId, '', undefined);
      forgetPage(tabId);
      jobs.cancel(tabId);
    },
    // A selection belongs to the page it was made on: a navigation or reload ends it. Not `gone`,
    // which also fires on the panel's own reconnects (a right-click on an error view, Try again).
    navigated: (tabId) => closeSnippet(tabId),
    closed: (tabId) => {
      forgetPage(tabId);
      snippetJobs.drop(tabId);
      snippetStore.clear(tabId);
      viewports.drop(tabId);
      hovers.drop(tabId);
      used.delete(tabId);
      jobs.drop(tabId);
    },
    active: (tabId) => {
      jobs.setActive(tabId);
      snippetJobs.setActive(tabId);
      if (tabId !== undefined) {
        refresh(tabId);
        // A selection made while this panel was closed or on another tab.
        if (!snippetStore.get(tabId)) loadSnippet(tabId);
      }
    },
    hover: (tabId, docId, id) => hovers.set(tabId, docId, id),
    viewport: (tabId, docId, viewport) => {
      jobs.setViewport(tabId, docId, viewport.visible, viewport.fixed);
      viewports.set(tabId, docId, viewport);
    },
    // Asked again on a running page from another screen (M3 dogfood B5): that screen goes next.
    // On a page waiting for Translate this page, the gesture is that click (plan M5-E3).
    asked: (tabId, docId) => {
      const offer = offers.get(tabId);
      if (offer?.docId === docId && offer.reason === 'ask') translatePage(tabId);
      else void jobs.refocus(tabId, docId);
    },
  };

  /**
   * The quick switcher's choice took effect (plan M4-E11): the page is translated again under the
   * route as it resolves now, keeping its cost and brief. Not "Retranslate page": the cache is read,
   * and its key holds the model, so a model already used on this page comes back from it and a new
   * one translates. A page skipped as already in the target language stays as it is.
   */
  const rerun = (tabId: number) => {
    const current = jobs.docFor(tabId);
    if (current === undefined || jobs.get(tabId)?.status === 'skipped') return;
    const { doc, docId } = current;
    void readSettings(api).then(async (settings) => {
      const got = await prepare(tabId, settings, doc);
      if (got === undefined) return;
      if (jobs.docOf(tabId) !== docId || !isLive(tabId, docId)) return got.unmark();
      void jobs.start(tabId, docId, got.prepared.doc, { keepCost: true, keepBrief: true });
    });
  };

  const switcher: Translator['switcher'] = {
    // The route the page's job resolved to decides whether it runs on the device (route.ts), the same resolution the job used.
    read: async (target) => {
      const state = await readSwitcher(api, target);
      const job = target.tabId === undefined ? undefined : jobs.get(target.tabId);
      // A job the on-device route stopped (no engine can run yet) names no model: it is not on the device.
      const engine = job?.connection?.id !== ON_DEVICE_CONNECTION.id ? undefined : job.model === NANO_MODEL ? 'nano' : job.model === CHROME_TRANSLATOR_MODEL ? 'translator' : undefined;
      return engine ? { ...state, onDevice: engine } : state;
    },
    choose: async (tabId, profileId) => {
      await chooseForTab(api, tabId, profileId);
      rerun(tabId);
    },
    // The page already runs on the profile (it was this tab's choice): nothing to translate again.
    makeDefault: (tabId, profileId) => makeDefault(api, tabId, profileId),
  };

  /**
   * The turn-on click for `owner`'s job (the page's or the selection's): the engine is created
   * first, synchronously in the click, then the download shows in the bar and the job runs again.
   */
  const turnOn = (owner: Jobs, key: string, tabId: number, again: () => void) => (engine: OnDeviceEngine, from: string, to: string) => {
    downloads.get(key)?.abort(new DOMException('replaced', 'AbortError'));
    const controller = new AbortController();
    const show = (loaded: number, error?: string) => owner.onDeviceDownload(tabId, { engine, from, to, loaded, ...(error === undefined ? {} : { error }) });
    const ready = prepareOnDevice(scope, mt, engine, from, to, { signal: controller.signal, progress: (loaded) => show(loaded) });
    downloads.set(key, controller);
    show(0);
    ready.then(
      () => {
        if (downloads.get(key) !== controller) return;
        downloads.delete(key);
        owner.onDeviceDownload(tabId, undefined, true);
        // A second pair turned on while the page still runs: its blocks are translated once the run ends.
        if (owner.get(tabId)?.status !== 'running') return again();
        const stop = owner.subscribe((id, view) => {
          if (id !== tabId || view?.status === 'running') return;
          stop();
          if (view !== undefined) again();
        });
      },
      (err: unknown) => {
        if (downloads.get(key) !== controller) return;
        downloads.delete(key);
        if (controller.signal.aborted) owner.onDeviceDownload(tabId, undefined);
        else show(0, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      },
    );
  };
  const cancelDownload = (key: string) => () => downloads.get(key)?.abort(new DOMException('cancelled', 'AbortError'));

  const actions = (tabId: number): JobActions => ({
    cancel: () => jobs.cancel(tabId),
    turnOnDevice: turnOn(jobs, pageKey(tabId), tabId, () => resume(tabId)),
    cancelOnDevice: cancelDownload(pageKey(tabId)),
    setUpProvider: () => void openOnboarding(api).catch((err: unknown) => console.warn('[translate-side] onboarding could not open', err)),
    resume: () => resume(tabId),
    // A long page translates around the reader (M5-E4); this does all of it.
    translateRest: () => void jobs.translateRest(tabId),
    openOptions: () => void api.runtime.openOptionsPage(),
    retrySegment: (id) => void jobs.retrySegment(tabId, id),
    retranslateSegment: (id) => void jobs.retranslateSegment(tabId, id),
    explainSegment: (id) => void jobs.explainSegment(tabId, id),
    retranslatePage: () => retranslate(tabId),
    // The soft limit's "Continue anyway" (M4-E10): holds for the rest of the month.
    // It carries out what the limit stopped: a Retranslate page skips the cache, a block redo redoes it.
    continuePastLimit: () =>
      void continuePastLimit(api).then(
        () => {
          const next = jobs.takeAfterLimit(tabId);
          if (next) void next();
          else resume(tabId);
        },
        (err: unknown) => jobs.limitFailed(tabId, limitFailure(err)),
      ),
    grantAccess: () => {
      // The job's own connection's origin, never a default one (§8: per origin, the one in use).
      // Without one (a base URL that does not parse), the settings are where to fix it.
      const origin = jobs.get(tabId)?.connection?.origin;
      if (origin === undefined) return void api.runtime.openOptionsPage();
      // First call in the click handler: permissions.request needs the gesture (§4.3.3 step 3).
      void api.permissions.request({ origins: [origin] }).then((granted) => {
        if (granted) resume(tabId);
      });
    },
  });

  /** A page's actions, with its blocks' corrections (the translation memory): kept on this device, shown on later runs. */
  const pageActions = (tabId: number): JobActions => ({
    ...actions(tabId),
    editSegment: (id, text) => void jobs.edit(tabId, id, text),
    discardEdit: (id) => void jobs.discardEdit(tabId, id),
  });

  // A selection is not kept, so its blocks have no Edit.
  const snippetActions = (tabId: number): JobActions => ({
    ...actions(tabId),
    cancel: () => snippetJobs.cancel(tabId),
    resume: () => void snippetJobs.resume(tabId),
    turnOnDevice: turnOn(snippetJobs, snippetKey(tabId), tabId, () => void snippetJobs.resume(tabId)),
    cancelOnDevice: cancelDownload(snippetKey(tabId)),
    continuePastLimit: () =>
      void continuePastLimit(api).then(
        () => void (snippetJobs.takeAfterLimit(tabId) ?? (() => snippetJobs.resume(tabId)))(),
        (err: unknown) => snippetJobs.limitFailed(tabId, limitFailure(err)),
      ),
    retrySegment: (id) => void snippetJobs.retrySegment(tabId, id),
    retranslateSegment: (id) => void snippetJobs.retranslateSegment(tabId, id),
    explainSegment: (id) => void snippetJobs.explainSegment(tabId, id),
    // A selection has no cache to skip: translating it again is a new run of the same text.
    retranslatePage: () => {
      const current = snippetJobs.docFor(tabId);
      if (current) void snippetJobs.start(tabId, current.docId, current.doc, { keepCost: true });
    },
    grantAccess: () => {
      const origin = snippetJobs.get(tabId)?.connection?.origin;
      if (origin === undefined) return void api.runtime.openOptionsPage();
      void api.permissions.request({ origins: [origin] }).then((granted) => {
        if (granted) void snippetJobs.resume(tabId);
      });
    },
  });

  const watch = (activeTab: () => number | undefined) => {
    /** A job that stopped for want of a key or access starts again once that is fixed. */
    const retryStopped = () => {
      const tabId = activeTab();
      if (tabId === undefined) return;
      if (jobs.get(tabId)?.status === 'stopped') resume(tabId);
      if (snippetJobs.get(tabId)?.status === 'stopped') void snippetJobs.resume(tabId);
    };
    /** A selection left by the worker (a context-menu click) for any tab of this window. */
    const onSession = (changes: Record<string, { newValue?: unknown }>) => {
      for (const [key, change] of Object.entries(changes)) {
        const tabId = tabIdFromSnippetKey(key);
        if (tabId === null) continue;
        if (change.newValue) void takeSnippet(tabId, change.newValue as SnippetRecord);
      }
    };
    // Any connection's key: "Fix key" applies to whichever connection the job ran on (M3-E8).
    const onLocal = (changes: Record<string, unknown>) => {
      if (Object.keys(changes).some((k) => k.startsWith(SECRET_PREFIX))) retryStopped();
    };
    // A connection, model or route changed (src/shared/providers.ts): a job stopped on it runs
    // again. Not the panel's own mark of a refused key (onAuthError): that changes nothing.
    const onProviders = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => {
      if (Object.entries(changes).some(([k, c]) => !isErrorStatusWrite(k, c))) retryStopped();
    };
    /** Settings changed: the active tab's page is translated again if they concern it (refresh). */
    const refreshActive = () => {
      const tabId = activeTab();
      if (tabId !== undefined) refresh(tabId);
    };
    const onSync = (changes: Record<string, unknown>) => {
      if (PREFS_KEY in changes || QUALITY_KEY in changes) refreshActive();
    };
    // The lists as this device keeps them: in sync, or here when too large to sync (sync-quota.ts).
    const onList = (key: string, value: unknown) => {
      if (key === GLOSSARY_KEY) return refreshActive();
      // A site put on the never-translate list (review N1, D23): a selection from it stops at once.
      // The page itself is let go by the controller, which closes its connection (`gone`).
      const never = cleanSiteList(value);
      for (const tabId of snippetStore.tabs()) {
        const view = snippetStore.get(tabId);
        if (view && !view.blocked && listedFor(never, view.url) !== undefined) closeSnippet(tabId);
      }
    };
    const onPagehide = () => {
      jobs.cancelAll();
      snippetJobs.cancelAll();
      // A selection belongs to this panel's session: a reopened panel starts clean.
      for (const tabId of snippetStore.tabs()) clearSnippet(api, tabId).catch(() => {});
    };
    api.storage.local.onChanged.addListener(onLocal);
    api.storage.sync.onChanged.addListener(onSync);
    const stopProviders = onProviderSettingsChanged(api, onProviders);
    const stopLists = onListChanged(api, [GLOSSARY_KEY, SITE_NEVER_KEY], onList);
    // Chrome may have finished a download (or been set up) while the panel was in the background:
    // a job stopped because on-device translation could not run yet asks again (no network, no create).
    const onFocus = () => {
      const tabId = activeTab();
      if (tabId === undefined) return;
      const stopped = (j: Jobs) => {
        const view = j.get(tabId);
        return view?.status === 'stopped' && view.onDeviceDownload === undefined && ON_DEVICE_STOPS.has((view.stopError?.raw as { ui?: unknown } | undefined)?.ui);
      };
      if (stopped(jobs)) resume(tabId);
      if (stopped(snippetJobs)) void snippetJobs.resume(tabId);
    };
    api.permissions.onAdded.addListener(retryStopped);
    api.storage.session.onChanged.addListener(onSession);
    addEventListener('pagehide', onPagehide);
    addEventListener('focus', onFocus);
    return () => {
      api.storage.local.onChanged.removeListener(onLocal);
      api.storage.sync.onChanged.removeListener(onSync);
      stopProviders();
      stopLists();
      api.permissions.onAdded.removeListener(retryStopped);
      api.storage.session.onChanged.removeListener(onSession);
      removeEventListener('pagehide', onPagehide);
      removeEventListener('focus', onFocus);
    };
  };

  return { jobs, snippets: { jobs: snippetJobs, store: snippetStore, actions: snippetActions, close: closeSnippet }, viewports, hovers, privacy, prefs, offers, translatePage, allowSite, hooks, actions: pageActions, switcher, routed: (target) => routedSummary(api, target, scope), watch };
}
