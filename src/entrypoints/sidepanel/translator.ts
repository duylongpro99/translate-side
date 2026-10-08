// Wires the page sessions (controller.ts) to the translation jobs (jobs.ts): a page that was read
// is translated at once (DESIGN.md §3 "starts translating at once"), its job stops when the page
// goes away, and settings changes restart a job that was waiting for them.
import type { browser } from 'wxt/browser';
import { chromeLanguageDetector, detectionSample, detectSourceLanguage, MIXED_LANGUAGE_DETECTION, sameLanguage, segmentsInLanguage, type LanguageDetectorPort } from '@/shared/language';
import type { GlossaryEntry } from '@/engine/types';
import { GLOSSARY_KEY, PREFS_KEY, readGlossary, readPreferences, SECRET_PREFIX, type Preferences } from '@/shared/settings';
import type { SessionHooks } from './controller.ts';
import type { JobActions } from './JobBar.tsx';
import { openTranslationCache } from '@/shared/cache';
import { SpendLedger } from '@/shared/spend';
import { anyDenylisted, clearSnippet, readSnippet, tabIdFromSnippetKey, type SnippetRecord } from '@/shared/snippet';
import { Jobs, type JobDeps, type JobDoc } from './jobs.ts';
import { snippetDocId, snippetView, SnippetStore } from './snippet.ts';
import { isProviderKey } from '@/shared/providers';
import { routedSummary, translateClient, type Routed, type RouteTarget } from './route.ts';
import { ViewportStore } from './viewport.ts';
import { PrivacyGate } from './privacy.ts';
import { PrefsStore } from './prefs.ts';

type Browser = typeof browser;

export interface Translator {
  jobs: Jobs;
  /** The selection, translated on its own (plan M3-E4): its jobs (one per tab, same Jobs class) and the records behind them. */
  snippets: { jobs: Jobs; store: SnippetStore; actions(tabId: number): JobActions; close(tabId: number): void };
  /** What is on screen per tab (scroll follow, plan M3-E7). */
  viewports: ViewportStore;
  /** The first-run privacy notice (plan M3-E10): nothing is sent before it is acknowledged. */
  privacy: PrivacyGate;
  /** The preferences the header shows and switches (plan M3-E6). */
  prefs: PrefsStore;
  hooks: SessionHooks;
  actions(tabId: number): JobActions;
  /** The model and provider the translate role resolves to for a tab and page now (§4.3.5), for the header and the privacy notice. */
  routed(target: RouteTarget): Promise<Routed | undefined>;
  /** Settings listeners and the panel-close cancel. Returns the cleanup. */
  watch(activeTab: () => number | undefined): () => void;
}

export interface TranslatorOptions {
  /** The language-detection port (plan M2-E5); default Chrome's LanguageDetector when the browser has one. */
  detector?: LanguageDetectorPort | undefined;
  /** Per-segment detection for mixed-language pages; default MIXED_LANGUAGE_DETECTION (off). */
  mixedLanguage?: boolean;
  /** The first-run privacy notice; default one over `api.storage.local`. */
  privacy?: PrivacyGate;
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
  // The running total in settings (M3-E9): pages and selections alike.
  const ledger = new SpendLedger(api);
  deps = { onSpend: (delta) => void ledger.add(delta), ...deps };
  const jobs = new Jobs({ translateClient: (target) => translateClient(api, target), cache: openTranslationCache(), ...deps });
  // No cache: a selection is a one-off, and its text is not kept beyond the session.
  // Single-pass: one request per chunk, never the contextual brief (analyze) call for a selection.
  const snippetJobs = new Jobs({ translateClient: (target) => translateClient(api, target), ...deps, strategy: 'single-pass', cache: undefined });
  const snippetStore = new SnippetStore();
  const viewports = new ViewportStore();
  const detector = 'detector' in options ? options.detector : chromeLanguageDetector();
  const mixed = options.mixedLanguage ?? MIXED_LANGUAGE_DETECTION;
  const privacy = options.privacy ?? new PrivacyGate(api);
  const prefs = new PrefsStore(api);
  const pageKey = (tabId: number) => `page:${tabId}`;
  const snippetKey = (tabId: number) => `snippet:${tabId}`;

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
    const blocked = record.blocked !== undefined || anyDenylisted(record.url);
    const view = snippetView(blocked ? { at: record.at, url: record.url, blocked: 'denylisted' } : record);
    snippetJobs.drop(tabId);
    snippetStore.set(tabId, view);
    if (view.blocked || view.segments.length === 0) return;
    const translate = async (): Promise<void> => {
      const settings = await readSettings(api);
      // Detection only informs the prompt; a selection already in the target language is still translated (the user asked).
      const { doc } = await docFor(settings, view.url, '', undefined, view.segments);
      if (snippetStore.get(tabId)?.docId !== view.docId) return;
      // Nothing is sent before the first-run privacy notice is acknowledged (M3-E10); once it is,
      // the settings are read again, so a change made meanwhile applies.
      if (privacy.state === 'acknowledged') void snippetJobs.start(tabId, view.docId, doc);
      else privacy.whenAcknowledged(snippetKey(tabId), () => void translate().catch(() => {}));
    };
    await translate();
  };
  const closeSnippet = (tabId: number) => {
    privacy.forget(snippetKey(tabId));
    snippetJobs.drop(tabId);
    snippetStore.clear(tabId);
    clearSnippet(api, tabId).catch(() => {});
  };
  const loadSnippet = (tabId: number) => {
    readSnippet(api, tabId).then((record) => (record ? takeSnippet(tabId, record) : undefined)).catch(() => {});
  };

  const hooks: SessionHooks = {
    ready(tabId, docId, result) {
      live.set(tabId, docId);
      // Viewport first (plan M3-E1): what was on screen when the page was read.
      jobs.setViewport(tabId, docId, result.visible ?? []);
      // And where it was, so scroll follow (M3-E7) lines the panel up before the first scroll.
      viewports.set(tabId, docId, { visible: result.visible ?? [], ...(result.anchor ? { anchor: result.anchor } : {}) });
      const translate = () =>
        void readSettings(api).then(async (settings) => {
          const got = await prepare(tabId, settings, { url: result.url, title: result.title, pageLang: result.lang, segments: result.segments });
          if (got === undefined) return;
          // The page may have gone, or the tab closed, while the settings were read (review E-R1).
          if (!isLive(tabId, docId)) return got.unmark();
          if (privacy.state === 'acknowledged') return void begin(tabId, docId, got.prepared);
          // Nothing is sent before the first-run privacy notice is acknowledged (M3-E10). Once it
          // is, the settings are read again: the page never goes out once under stale ones.
          got.unmark();
          privacy.whenAcknowledged(pageKey(tabId), () => {
            if (isLive(tabId, docId)) translate();
          });
        });
      translate();
    },
    gone: (tabId) => {
      privacy.forget(pageKey(tabId));
      live.delete(tabId);
      jobs.cancel(tabId);
    },
    // A selection belongs to the page it was made on: a navigation or reload ends it. Not `gone`,
    // which also fires on the panel's own reconnects (a right-click on an error view, Try again).
    navigated: (tabId) => closeSnippet(tabId),
    closed: (tabId) => {
      privacy.forget(pageKey(tabId));
      privacy.forget(snippetKey(tabId));
      snippetJobs.drop(tabId);
      snippetStore.clear(tabId);
      live.delete(tabId);
      viewports.drop(tabId);
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
    viewport: (tabId, docId, viewport) => {
      jobs.setViewport(tabId, docId, viewport.visible);
      viewports.set(tabId, docId, viewport);
    },
  };

  const actions = (tabId: number): JobActions => ({
    cancel: () => jobs.cancel(tabId),
    resume: () => resume(tabId),
    openOptions: () => void api.runtime.openOptionsPage(),
    retrySegment: (id) => void jobs.retrySegment(tabId, id),
    retranslateSegment: (id) => void jobs.retranslateSegment(tabId, id),
    retranslatePage: () => retranslate(tabId),
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

  const snippetActions = (tabId: number): JobActions => ({
    ...actions(tabId),
    cancel: () => snippetJobs.cancel(tabId),
    resume: () => void snippetJobs.resume(tabId),
    retrySegment: (id) => void snippetJobs.retrySegment(tabId, id),
    retranslateSegment: (id) => void snippetJobs.retranslateSegment(tabId, id),
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
    /** Settings changed: the active tab's page is translated again if they concern it (refresh). */
    const onSync = (changes: Record<string, unknown>) => {
      // A connection, model or route changed (src/shared/providers.ts): a job stopped on it runs again.
      if (Object.keys(changes).some(isProviderKey)) retryStopped();
      if (!(PREFS_KEY in changes) && !(GLOSSARY_KEY in changes)) return;
      const tabId = activeTab();
      if (tabId !== undefined) refresh(tabId);
    };
    const onPagehide = () => {
      jobs.cancelAll();
      snippetJobs.cancelAll();
      // A selection belongs to this panel's session: a reopened panel starts clean.
      for (const tabId of snippetStore.tabs()) clearSnippet(api, tabId).catch(() => {});
    };
    api.storage.local.onChanged.addListener(onLocal);
    api.storage.sync.onChanged.addListener(onSync);
    api.permissions.onAdded.addListener(retryStopped);
    api.storage.session.onChanged.addListener(onSession);
    addEventListener('pagehide', onPagehide);
    return () => {
      api.storage.local.onChanged.removeListener(onLocal);
      api.storage.sync.onChanged.removeListener(onSync);
      api.permissions.onAdded.removeListener(retryStopped);
      api.storage.session.onChanged.removeListener(onSession);
      removeEventListener('pagehide', onPagehide);
    };
  };

  return { jobs, snippets: { jobs: snippetJobs, store: snippetStore, actions: snippetActions, close: closeSnippet }, viewports, privacy, prefs, hooks, actions, routed: (target) => routedSummary(api, target), watch };
}
