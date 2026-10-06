// Wires the page sessions (controller.ts) to the translation jobs (jobs.ts): a page that was read
// is translated at once (DESIGN.md §3 "starts translating at once"), its job stops when the page
// goes away, and settings changes restart a job that was waiting for them.
import type { browser } from 'wxt/browser';
import { chromeLanguageDetector, detectionSample, detectSourceLanguage, MIXED_LANGUAGE_DETECTION, sameLanguage, segmentsInLanguage, type LanguageDetectorPort } from '@/shared/language';
import { GEMINI_CONNECTION, GEMINI_ORIGIN, readPreferences, secretKey, type Preferences } from '@/shared/settings';
import type { SessionHooks } from './controller.ts';
import type { JobActions } from './JobBar.tsx';
import { Jobs, type JobDeps, type JobDoc } from './jobs.ts';
import { translateClient } from './route.ts';

type Browser = typeof browser;

export interface Translator {
  jobs: Jobs;
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

export function createTranslator(api: Browser, deps: Partial<JobDeps> = {}, options: TranslatorOptions = {}): Translator {
  const jobs = new Jobs({ translateClient: () => translateClient(api), ...deps });
  const detector = 'detector' in options ? options.detector : chromeLanguageDetector();
  const mixed = options.mixedLanguage ?? MIXED_LANGUAGE_DETECTION;

  /**
   * The job document for a page under these preferences: its source language from the detection
   * chain (src/shared/language.ts), and whether it is already in the target language (skip, no
   * model call). With per-segment detection on, the segments already in the target language are
   * kept as they are, and the page is skipped only when nothing else is left.
   */
  const docFor = async (prefs: Preferences, url: string, title: string, pageLang: string | undefined, segments: JobDoc['segments']): Promise<{ doc: JobDoc; skip: boolean }> => {
    const detection = await detectSourceLanguage({ override: prefs.sourceLang === 'auto' ? undefined : prefs.sourceLang, sample: detectionSample(segments), pageLang }, detector);
    const base = { url, title, ...(pageLang === undefined ? {} : { pageLang }), sourceLang: detection.lang, targetLang: prefs.targetLang, detection, segments };
    if (!mixed) return { doc: base, skip: sameLanguage(detection.lang, prefs.targetLang) };
    const keep = await segmentsInLanguage(segments, prefs.targetLang, detector);
    const left = segments.some((s) => s.translate && !keep.has(s.id));
    return { doc: keep.size ? { ...base, keep } : base, skip: !left && segments.some((s) => s.translate) };
  };

  const begin = (tabId: number, docId: string, prepared: { doc: JobDoc; skip: boolean }, opts?: { keepCost?: boolean }) =>
    prepared.skip ? jobs.skip(tabId, docId, prepared.doc) : jobs.start(tabId, docId, prepared.doc, opts);

  /** The document each tab's session holds now: a job starts only for a page that is still there. */
  const live = new Map<number, string>();
  const isLive = (tabId: number, docId: string) => live.get(tabId) === docId;

  const hooks: SessionHooks = {
    ready(tabId, docId, result) {
      live.set(tabId, docId);
      void readPreferences(api)
        .then((prefs) => docFor(prefs, result.url, result.title, result.lang, result.segments))
        .then((prepared) => {
          // The page may have gone, or the tab closed, while the settings were read (review E-R1).
          if (isLive(tabId, docId)) void begin(tabId, docId, prepared);
        });
    },
    gone: (tabId) => {
      live.delete(tabId);
      jobs.cancel(tabId);
    },
    closed: (tabId) => {
      live.delete(tabId);
      jobs.drop(tabId);
    },
    active: (tabId) => jobs.setActive(tabId),
  };

  const actions = (tabId: number): JobActions => ({
    cancel: () => jobs.cancel(tabId),
    resume: () => void jobs.resume(tabId),
    openOptions: () => void api.runtime.openOptionsPage(),
    grantAccess: () => {
      // First call in the click handler: permissions.request needs the gesture (§4.3.3 step 3).
      void api.permissions.request({ origins: [GEMINI_ORIGIN] }).then((granted) => {
        if (granted) void jobs.resume(tabId);
      });
    },
  });

  const watch = (activeTab: () => number | undefined) => {
    /** A job that stopped for want of a key or access starts again once that is fixed. */
    const retryStopped = () => {
      const tabId = activeTab();
      if (tabId !== undefined && jobs.get(tabId)?.status === 'stopped') void jobs.resume(tabId);
    };
    const onLocal = (changes: Record<string, unknown>) => {
      if (secretKey(GEMINI_CONNECTION.id) in changes) retryStopped();
    };
    /**
     * New languages: translate the active tab's page again, from scratch, keeping what the earlier
     * runs cost in the page total (review E-R3). A background tab's job keeps the languages it
     * started with until its page is read again (reopened or reloaded).
     */
    const onSync = (changes: Record<string, unknown>) => {
      if (!('prefs' in changes)) return;
      const tabId = activeTab();
      const current = tabId === undefined ? undefined : jobs.docFor(tabId);
      if (tabId === undefined || current === undefined) return;
      const { doc, docId } = current;
      void readPreferences(api)
        .then((prefs) => docFor(prefs, doc.url, doc.title, doc.pageLang, doc.segments))
        .then((next) => {
          if (next.doc.targetLang === doc.targetLang && next.doc.sourceLang === doc.sourceLang) return;
          if (isLive(tabId, docId) && jobs.docOf(tabId) === docId) void begin(tabId, docId, next, { keepCost: true });
        });
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

  return { jobs, hooks, actions, watch };
}
