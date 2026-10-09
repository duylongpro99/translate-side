import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { PanelController, PanelView } from './controller.ts';
import { AboutDocument } from './AboutDocument.tsx';
import { DevView } from './DevView.tsx';
import { HeaderControls } from './HeaderControls.tsx';
import { readFollow, useScrollFollow, writeFollow } from './follow.ts';
import { JobBar, type JobActions } from './JobBar.tsx';
import type { Jobs, JobView } from './jobs.ts';
import { SegmentList } from './SegmentList.tsx';
import { PrivacyNotice } from './PrivacyNotice.tsx';
import type { PrefsStore } from './prefs.ts';
import type { Routed, RouteTarget } from './route.ts';
import { openOnboarding, readOnboarding, ONBOARDING_KEY, type OnboardingStatus } from '@/shared/onboarding';
import type { SwitcherState } from './switcher.ts';
import type { Translator } from './translator.ts';
import type { PrivacyGate, PrivacyState } from './privacy.ts';
import { SelectionView } from './SelectionView.tsx';
import { StateMessage } from './StateMessage.tsx';
import type { SnippetStore, SnippetView } from './snippet.ts';
import type { ViewportStore } from './viewport.ts';

/** What the panel needs from the translation side (translator.ts). Absent: the original only (M0). */
export interface TranslatorProps {
  jobs: Jobs;
  actions(tabId: number): JobActions;
  /** What is on screen per tab, for the scroll follow (plan M3-E7). */
  viewports?: ViewportStore;
  /** Selection mode (plan M3-E4): the selection of each tab, and the job that translates it. */
  snippets?: { jobs: Jobs; store: SnippetStore; actions(tabId: number): JobActions; close(tabId: number): void };
  /** The first-run privacy notice (plan M3-E10). */
  privacy?: PrivacyGate;
  /** The preferences the header switches (plan M3-E6). */
  prefs?: PrefsStore;
  /** The model and provider the translate role resolves to for a tab and page (§4.3.5). */
  routed?(target: RouteTarget): Promise<Routed | undefined>;
  /** The quick switcher (plan M4-E11). */
  switcher?: Translator['switcher'];
}

/** What the translate role resolves to for the tab and page on screen; re-read when they or the job change. */
function useRouted(translator: TranslatorProps | undefined, tabId: number | undefined, url: string | undefined, job: JobView | undefined): Routed | undefined {
  const [routed, setRouted] = useState<Routed | undefined>(undefined);
  const status = job?.status;
  useEffect(() => {
    if (!translator?.routed) return;
    let live = true;
    translator.routed({ tabId, url }).then(
      (r) => live && setRouted(r),
      () => live && setRouted(undefined),
    );
    return () => {
      live = false;
    };
  }, [translator, tabId, url, status]);
  return routed;
}

/** What the quick switcher shows for the tab and page on screen; read again after a choice, a job change or a settings change. */
function useSwitcher(translator: TranslatorProps | undefined, tabId: number | undefined, url: string | undefined, job: JobView | undefined, version: number): SwitcherState | undefined {
  const [state, setState] = useState<SwitcherState | undefined>(undefined);
  const status = job?.status;
  useEffect(() => {
    if (!translator?.switcher || tabId === undefined) return setState(undefined);
    let live = true;
    // Reads can finish out of order (a model change writes two items): the latest one decides.
    let latest = 0;
    const read = () => {
      const mine = ++latest;
      return translator.switcher?.read({ tabId, url }).then(
        (s) => live && mine === latest && setState(s),
        () => live && mine === latest && setState(undefined),
      );
    };
    void read();
    // A model, key or route changed in settings, or a tab choice was made elsewhere.
    const on = () => void read();
    browser.storage.sync.onChanged.addListener(on);
    browser.storage.local.onChanged.addListener(on);
    browser.storage.session.onChanged.addListener(on);
    return () => {
      live = false;
      browser.storage.sync.onChanged.removeListener(on);
      browser.storage.local.onChanged.removeListener(on);
      browser.storage.session.onChanged.removeListener(on);
    };
  }, [translator, tabId, url, status, version]);
  return state;
}

/** Has the first-run guide been finished or skipped on this device (M4-E13)? undefined until read, and while it is not. */
function useOnboarding(): { status: OnboardingStatus | undefined; read: boolean } {
  const [state, setState] = useState<{ status: OnboardingStatus | undefined; read: boolean }>({ status: undefined, read: false });
  useEffect(() => {
    const load = () =>
      readOnboarding(browser).then(
        (status) => setState({ status, read: true }),
        () => setState({ status: undefined, read: false }),
      );
    void load();
    const on = (changes: Record<string, unknown>) => {
      if (ONBOARDING_KEY in changes) void load();
    };
    browser.storage.local.onChanged.addListener(on);
    return () => browser.storage.local.onChanged.removeListener(on);
  }, []);
  return state;
}

const nextFrame = (fn: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));

/**
 * The active tab's job, if it belongs to the document on screen. Updates are batched per frame:
 * a stream emits an event per text delta.
 */
function useJob(jobs: Jobs | undefined, tabId: number | undefined, docId: string | undefined): JobView | undefined {
  const read = () => (jobs && tabId !== undefined && docId !== undefined && jobs.docOf(tabId) === docId ? jobs.get(tabId) : undefined);
  const [job, setJob] = useState<JobView | undefined>(read);
  useEffect(() => {
    setJob(read());
    if (!jobs) return;
    let scheduled = false;
    const unsubscribe = jobs.subscribe((id) => {
      if (id !== tabId || scheduled) return;
      scheduled = true;
      nextFrame(() => {
        scheduled = false;
        setJob(read());
      });
    });
    return unsubscribe;
    // read() closes over exactly these three.
  }, [jobs, tabId, docId]);
  return job;
}

function useSnippet(store: SnippetStore | undefined, tabId: number | undefined): SnippetView | undefined {
  const [view, setView] = useState<SnippetView | undefined>(() => (store && tabId !== undefined ? store.get(tabId) : undefined));
  useEffect(() => {
    setView(store && tabId !== undefined ? store.get(tabId) : undefined);
    return store?.subscribe((id, v) => {
      if (id === tabId) setView(v);
    });
  }, [store, tabId]);
  return view;
}

function usePrivacy(gate: PrivacyGate | undefined): PrivacyState | undefined {
  const [state, setState] = useState(() => gate?.state);
  useEffect(() => {
    setState(gate?.state);
    return gate?.subscribe(setState);
  }, [gate]);
  return state;
}

function usePrefs(store: PrefsStore | undefined) {
  const [prefs, setPrefs] = useState(() => store?.get());
  useEffect(() => {
    setPrefs(store?.get());
    return store?.subscribe(setPrefs);
  }, [store]);
  return prefs;
}

export function App({ controller, translator }: { controller: PanelController; translator?: TranslatorProps }) {
  const [view, setView] = useState<PanelView>(controller.view);
  const [tabId, setTabId] = useState<number | undefined>(controller.tabId);
  const [dev, setDev] = useState(false);
  const [follow, setFollow] = useState(() => readFollow());
  useEffect(
    () =>
      controller.subscribe((v, t) => {
        setView(v);
        setTabId(t);
      }),
    [controller],
  );
  const job = useJob(translator?.jobs, tabId, view.kind === 'ready' ? view.docId : undefined);
  const privacy = usePrivacy(translator?.privacy);
  const prefs = usePrefs(translator?.prefs);
  const routed = useRouted(translator, tabId, view.kind === 'ready' ? view.result.url : undefined, job);
  const [switcherVersion, setSwitcherVersion] = useState(0);
  const switcherState = useSwitcher(translator, tabId, view.kind === 'ready' ? view.result.url : undefined, job, switcherVersion);
  const onboarding = useOnboarding();
  // No route can run here yet and the guide was never finished: offer it (the page still reads as the original).
  const offerSetup = onboarding.read && onboarding.status === undefined && switcherState !== undefined && switcherState.currentUsable === false;
  const [switcherError, setSwitcherError] = useState<string | undefined>();
  const switcherActions =
    translator?.switcher && tabId !== undefined
      ? {
          state: switcherState,
          error: switcherError,
          onChoose: (profileId: string | undefined) => {
            setSwitcherError(undefined);
            translator.switcher?.choose(tabId, profileId).then(
              () => setSwitcherVersion((v) => v + 1),
              () => setSwitcherError("Couldn't switch the model for this tab. Try again."),
            );
          },
          onMakeDefault: (profileId: string) => {
            setSwitcherError(undefined);
            translator.switcher?.makeDefault(tabId, profileId).then(
              () => setSwitcherVersion((v) => v + 1),
              () => setSwitcherError("Couldn't save the default. Try again, or set it in settings."),
            );
          },
        }
      : undefined;
  const snippet = useSnippet(translator?.snippets?.store, tabId);
  const snippetJob = useJob(translator?.snippets?.jobs, tabId, snippet?.docId);
  // A site on the denylist is never read, selection included (M3-D13): its own message wins.
  const selecting = snippet !== undefined && translator?.snippets !== undefined && !(view.kind === 'blocked' && view.reason === 'denylisted');
  // One-way page → panel (M3-E7); not over the dev view, whose blocks are not the reading list.
  useScrollFollow(translator?.viewports, tabId, view.kind === 'ready' ? view.docId : undefined, follow && !dev);
  const toggleFollow = () => {
    writeFollow(!follow);
    setFollow(!follow);
  };

  const pageActions = translator && tabId !== undefined ? translator.actions(tabId) : undefined;
  /**
   * A header switch: saved like the options page saves it, and the settings listener translates
   * the page again (from the cache where it can). A page the user cancelled is not restarted by
   * that listener (translator.ts refresh), so the switch, an explicit ask, restarts it here.
   */
  const [prefsError, setPrefsError] = useState(false);
  const switchPrefs = (patch: Parameters<PrefsStore['update']>[0]) => {
    const status = job?.status;
    setPrefsError(false);
    void translator?.prefs
      ?.update(patch)
      .then(() => {
        if (status === 'cancelled') pageActions?.resume();
      })
      // The store put the saved value back; say why the switch did not stick.
      .catch(() => setPrefsError(true));
  };

  const openOptions = () => {
    void browser.runtime.openOptionsPage();
  };
  // Open-only toolbar/Alt+T in M0 (D11): the panel closes here. sidePanel.close is Chrome 141+.
  const closePanel = async () => {
    const win = await browser.windows.getCurrent();
    if (typeof browser.sidePanel.close === 'function' && win.id !== undefined) await browser.sidePanel.close({ windowId: win.id });
    else window.close();
  };
  return (
    <main class="panel">
      <header class="panel__header">
        <div class="panel__row">
          <h1 title={view.kind === 'ready' ? view.result.title : undefined}>{view.kind === 'ready' ? view.result.title || 'Translate Side' : 'Translate Side'}</h1>
          {import.meta.env.DEV && view.kind === 'ready' ? (
            <button type="button" class="panel__icon panel__dev" aria-pressed={dev} title="Segment view (dev build only)" onClick={() => setDev(!dev)}>
              {'{ }'}
            </button>
          ) : null}
          {view.kind === 'ready' && translator?.viewports ? (
            <button
              type="button"
              class="panel__icon panel__follow"
              aria-pressed={follow}
              data-testid="scroll-follow"
              title={follow ? 'Following the page as it scrolls (click to stop)' : 'Follow the page as it scrolls'}
              aria-label="Follow page scroll"
              onClick={toggleFollow}
            >
              ⇅
            </button>
          ) : null}
          <button type="button" class="panel__icon" title="Settings" aria-label="Settings" onClick={openOptions}>
            ⚙
          </button>
          <button type="button" class="panel__icon" title="Close" aria-label="Close panel" onClick={() => void closePanel()}>
            ✕
          </button>
        </div>
        {view.kind === 'ready' && translator && !selecting && !(import.meta.env.DEV && dev) ? <HeaderControls job={job} prefs={prefs} routedModel={routed?.model} switcher={switcherActions} actions={job ? pageActions : undefined} onPrefs={switchPrefs} error={prefsError ? "Couldn't save that setting. Try again, or change it in settings." : undefined} /> : null}
      </header>
      {offerSetup ? (
        <section class="setup-offer" data-testid="setup-offer">
          <p>New here? Set up a translation provider to start translating.</p>
          <button type="button" class="job__button" data-testid="setup-open" onClick={() => void openOnboarding(browser)}>
            Set up Translate Side
          </button>
        </section>
      ) : null}
      {privacy === 'needed' && translator?.privacy ? <PrivacyNotice to={routed} onAcknowledge={() => void translator.privacy?.acknowledge().catch(() => {})} /> : null}
      {selecting && tabId !== undefined && snippet && translator?.snippets ? (
        <SelectionView snippet={snippet} job={snippetJob} actions={translator.snippets.actions(tabId)} onClose={() => translator.snippets?.close(tabId)} pageReady={view.kind === 'ready'} />
      ) : view.kind !== 'ready' ? (
        <StateMessage view={view} onRetry={() => controller.retry()} />
      ) : import.meta.env.DEV && dev ? (
        <DevView segments={view.result.segments} via={view.result.via} docId={view.docId} />
      ) : (
        <>
          {job && translator && tabId !== undefined ? (
            <JobBar job={job} actions={translator.actions(tabId)} cancel={false} />
          ) : (
            <p class="panel__meta" data-testid="panel-ready">
              Original text · {view.result.segments.length} blocks
            </p>
          )}
          {job?.brief ? <AboutDocument brief={job.brief} sourceLang={job.sourceLang} /> : null}
          <SegmentList segments={job?.segments ?? view.result.segments} states={job?.segs} {...(job?.model ? { model: job.model } : {})} {...(job && pageActions ? { actions: { retry: pageActions.retrySegment, retranslate: pageActions.retranslateSegment } } : {})} />
        </>
      )}
    </main>
  );
}
