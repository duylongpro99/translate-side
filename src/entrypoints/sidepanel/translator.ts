// Wires the page sessions (controller.ts) to the translation jobs (jobs.ts): a page that was read
// is translated at once (DESIGN.md §3 "starts translating at once"), its job stops when the page
// goes away, and settings changes restart a job that was waiting for them.
import type { browser } from 'wxt/browser';
import { GEMINI_CONNECTION, GEMINI_ORIGIN, readPreferences, secretKey, sourceLanguage, type Preferences } from '@/shared/settings';
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

export function createTranslator(api: Browser, deps: Partial<JobDeps> = {}): Translator {
  const jobs = new Jobs({ translateClient: () => translateClient(api), ...deps });

  const docFor = (prefs: Preferences, url: string, title: string, pageLang: string | undefined, segments: JobDoc['segments']): JobDoc => ({
    url,
    title,
    ...(pageLang === undefined ? {} : { pageLang }),
    sourceLang: sourceLanguage(prefs, pageLang),
    targetLang: prefs.targetLang,
    segments,
  });

  /** The document each tab's session holds now: a job starts only for a page that is still there. */
  const live = new Map<number, string>();
  const isLive = (tabId: number, docId: string) => live.get(tabId) === docId;

  const hooks: SessionHooks = {
    ready(tabId, docId, result) {
      live.set(tabId, docId);
      void readPreferences(api).then((prefs) => {
        // The page may have gone, or the tab closed, while the settings were read (review E-R1).
        if (isLive(tabId, docId)) void jobs.start(tabId, docId, docFor(prefs, result.url, result.title, result.lang, result.segments));
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
      void readPreferences(api).then((prefs) => {
        const { doc, docId } = current;
        const next = docFor(prefs, doc.url, doc.title, doc.pageLang, doc.segments);
        if (next.targetLang === doc.targetLang && next.sourceLang === doc.sourceLang) return;
        if (isLive(tabId, docId) && jobs.docOf(tabId) === docId) void jobs.start(tabId, docId, next, { keepCost: true });
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
