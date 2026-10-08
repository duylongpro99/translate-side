// Wires the page sessions (controller.ts) to the translation jobs (jobs.ts): a page that was read
// is translated at once (DESIGN.md §3 "starts translating at once"), its job stops when the page
// goes away, and settings changes restart a job that was waiting for them.
import type { browser } from 'wxt/browser';
import { chromeLanguageDetector, detectionSample, detectSourceLanguage, MIXED_LANGUAGE_DETECTION, sameLanguage, segmentsInLanguage, type LanguageDetectorPort } from '@/shared/language';
import type { GlossaryEntry } from '@/engine/types';
import { DEFAULT_CONNECTION, DEFAULT_ORIGIN, GLOSSARY_KEY, PREFS_KEY, readGlossary, readPreferences, secretKey, type Preferences } from '@/shared/settings';
import type { SessionHooks } from './controller.ts';
import type { JobActions } from './JobBar.tsx';
import { Jobs, type JobDeps, type JobDoc } from './jobs.ts';
import { translateClient } from './route.ts';
import { ViewportStore } from './viewport.ts';

type Browser = typeof browser;

export interface Translator {
  jobs: Jobs;
  /** What is on screen per tab (scroll follow, plan M3-E7). */
  viewports: ViewportStore;
  hooks: SessionHooks;
  actions(tabId: number): JobActions;
  /** Settings listeners and the panel-close cancel. Returns the cleanup. */
  watch(activeTab: () => number | undefined): () => void;
}

export interface TranslatorOptions {
  /** The language-detection port (plan M2-E5); default Chrome's LanguageDetector when the browser has one. */
  detector?: LanguageDetectorPort | undefined;
  /** Per-segment detection for mixed-language pages; default MIXED_LANGUAGE_DETECTION (off). */
  mixedLanguage?: boolean;
}

/** What a job reads from the settings: the preferences and the personal glossary (both storage.sync). */
interface Settings {
  prefs: Preferences;
  glossary: GlossaryEntry[];
}

async function readSettings(api: Browser): Promise<Settings> {
  const [prefs, glossary] = await Promise.all([readPreferences(api), readGlossary(api)]);
  return { prefs, glossary };
}

export function createTranslator(api: Browser, deps: Partial<JobDeps> = {}, options: TranslatorOptions = {}): Translator {
  const jobs = new Jobs({ translateClient: () => translateClient(api), ...deps });
  const viewports = new ViewportStore();
  const detector = 'detector' in options ? options.detector : chromeLanguageDetector();
  const mixed = options.mixedLanguage ?? MIXED_LANGUAGE_DETECTION;

  /**
   * The job document for a page under these preferences: its source language from the detection
   * chain (src/shared/language.ts), and whether it is already in the target language (skip, no
   * model call). With per-segment detection on, the segments already in the target language are
   * kept as they are, and the page is skipped only when nothing else is left.
   */
  const docFor = async ({ prefs, glossary }: Settings, url: string, title: string, pageLang: string | undefined, segments: JobDoc['segments']): Promise<{ doc: JobDoc; skip: boolean }> => {
    const detection = await detectSourceLanguage({ override: prefs.sourceLang === 'auto' ? undefined : prefs.sourceLang, sample: detectionSample(segments), pageLang }, detector);
    const base = { url, title, ...(pageLang === undefined ? {} : { pageLang }), sourceLang: detection.lang, targetLang: prefs.targetLang, detection, segments, style: prefs.style, gloss: prefs.gloss, glossary, budgetTokens: prefs.budgetTokens };
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
  const settingsKey = (settings: Settings) => JSON.stringify([settings.prefs, settings.glossary]);
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
    output: next.style !== doc.style || next.gloss !== doc.gloss || JSON.stringify(next.glossary ?? []) !== JSON.stringify(doc.glossary ?? []),
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
      const { languages, output } = changes(doc, next.doc);
      // Same job either way (e.g. an unrelated preference): the key stays, no detection next time.
      if (!languages && !output) return;
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
      const { languages, output } = changes(doc, next.doc);
      if (!languages && !output) return void jobs.resume(tabId);
      void jobs.start(tabId, docId, next.doc, { keepCost: true, keepBrief: true });
    });
  };

  const hooks: SessionHooks = {
    ready(tabId, docId, result) {
      live.set(tabId, docId);
      // Viewport first (plan M3-E1): what was on screen when the page was read.
      jobs.setViewport(tabId, docId, result.visible ?? []);
      // And where it was, so scroll follow (M3-E7) lines the panel up before the first scroll.
      viewports.set(tabId, docId, { visible: result.visible ?? [], ...(result.anchor ? { anchor: result.anchor } : {}) });
      void readSettings(api).then(async (settings) => {
        const got = await prepare(tabId, settings, { url: result.url, title: result.title, pageLang: result.lang, segments: result.segments });
        if (got === undefined) return;
        // The page may have gone, or the tab closed, while the settings were read (review E-R1).
        if (isLive(tabId, docId)) void begin(tabId, docId, got.prepared);
        else got.unmark();
      });
    },
    gone: (tabId) => {
      live.delete(tabId);
      jobs.cancel(tabId);
    },
    closed: (tabId) => {
      live.delete(tabId);
      viewports.drop(tabId);
      used.delete(tabId);
      jobs.drop(tabId);
    },
    active: (tabId) => {
      jobs.setActive(tabId);
      if (tabId !== undefined) refresh(tabId);
    },
    viewport: (tabId, docId, viewport) => {
      jobs.setViewport(tabId, docId, viewport.visible);
      viewports.set(tabId, docId, viewport);
    },
  };

  const actions = (tabId: number): JobActions => ({
    cancel: () => jobs.cancel(tabId),
    resume: () => resume(tabId),
    openOptions: () => void api.runtime.openOptionsPage(),
    grantAccess: () => {
      // First call in the click handler: permissions.request needs the gesture (§4.3.3 step 3).
      void api.permissions.request({ origins: [DEFAULT_ORIGIN] }).then((granted) => {
        if (granted) resume(tabId);
      });
    },
  });

  const watch = (activeTab: () => number | undefined) => {
    /** A job that stopped for want of a key or access starts again once that is fixed. */
    const retryStopped = () => {
      const tabId = activeTab();
      if (tabId !== undefined && jobs.get(tabId)?.status === 'stopped') resume(tabId);
    };
    const onLocal = (changes: Record<string, unknown>) => {
      if (secretKey(DEFAULT_CONNECTION.id) in changes) retryStopped();
    };
    /** Settings changed: the active tab's page is translated again if they concern it (refresh). */
    const onSync = (changes: Record<string, unknown>) => {
      if (!(PREFS_KEY in changes) && !(GLOSSARY_KEY in changes)) return;
      const tabId = activeTab();
      if (tabId !== undefined) refresh(tabId);
    };
    const onPagehide = () => jobs.cancelAll();
    api.storage.local.onChanged.addListener(onLocal);
    api.storage.sync.onChanged.addListener(onSync);
    api.permissions.onAdded.addListener(retryStopped);
    addEventListener('pagehide', onPagehide);
    return () => {
      api.storage.local.onChanged.removeListener(onLocal);
      api.storage.sync.onChanged.removeListener(onSync);
      api.permissions.onAdded.removeListener(retryStopped);
      removeEventListener('pagehide', onPagehide);
    };
  };

  return { jobs, viewports, hooks, actions, watch };
}
