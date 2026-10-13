import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { i18n } from '#i18n';
import type { PanelController, PanelView } from './controller.ts';
import { AboutDocument } from './AboutDocument.tsx';
import { DevView } from './DevView.tsx';
import { closePanel } from './toggle.ts';
import { ShortcutList } from './ShortcutList.tsx';
import { HeaderControls } from './HeaderControls.tsx';
import { readFollow, useHoverLink, useScrollFollow, writeFollow, type SendToPage } from './follow.ts';
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
import { OfferBar } from './OfferBar.tsx';
import type { OfferStore, PageOffer } from './offers.ts';
import { StateMessage } from './StateMessage.tsx';
import type { SnippetStore, SnippetView } from './snippet.ts';
import type { HoverStore } from './hover.ts';
import type { ViewportStore } from './viewport.ts';

/** What the panel needs from the translation side (translator.ts). Absent: the original only (M0). */
export interface TranslatorProps {
  jobs: Jobs;
  actions(tabId: number): JobActions;
  /** What is on screen per tab, for the scroll follow (plan M3-E7). */
  viewports?: ViewportStore;
  /** Which block the pointer is over on the page, and the way to tell the page (plan M5-E1: hover link, scroll sync both ways). */
  hovers?: HoverStore;
  send?: SendToPage;
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
  /** Pages read but not translated on their own (plan M5-E3), and their two actions. */
  offers?: OfferStore;
  translatePage?(tabId: number): void;
  allowSite?(tabId: number): Promise<boolean>;
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
    let live = true;
    const unsubscribe = jobs.subscribe((id) => {
      if (id !== tabId || scheduled) return;
      scheduled = true;
      nextFrame(() => {
        scheduled = false;
        // A frame queued for an earlier document must not overwrite the current one's job.
        if (live) setJob(read());
      });
    });
    return () => {
      live = false;
      unsubscribe();
    };
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

/** The tab's offer, if it belongs to the document on screen. */
function useOffer(store: OfferStore | undefined, tabId: number | undefined, docId: string | undefined): PageOffer | undefined {
  const read = () => {
    const offer = store && tabId !== undefined ? store.get(tabId) : undefined;
    return offer && offer.docId === docId ? offer : undefined;
  };
  const [offer, setOffer] = useState<PageOffer | undefined>(read);
  useEffect(() => {
    setOffer(read());
    return store?.subscribe((id) => {
      if (id === tabId) setOffer(read());
    });
    // read() closes over exactly these three.
  }, [store, tabId, docId]);
  return offer;
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

function useQuality(store: PrefsStore | undefined) {
  const [quality, setQuality] = useState(() => store?.quality());
  useEffect(() => {
    setQuality(store?.quality());
    return store?.subscribeQuality(setQuality);
  }, [store]);
  return quality;
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
  const offer = useOffer(translator?.offers, tabId, view.kind === 'ready' ? view.docId : undefined);
  const privacy = usePrivacy(translator?.privacy);
  const prefs = usePrefs(translator?.prefs);
  const quality = useQuality(translator?.prefs);
  const routed = useRouted(translator, tabId, view.kind === 'ready' ? view.result.url : undefined, job);
  const [switcherVersion, setSwitcherVersion] = useState(0);
  const switcherState = useSwitcher(translator, tabId, view.kind === 'ready' ? view.result.url : undefined, job, switcherVersion);
  // The job bar sticks under the header: its offset is the header's real height, which grows when the controls wrap.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--panel-header-h', `${el.offsetHeight}px`);
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(set);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
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
              () => setSwitcherError(i18n.t('panel.header.switchFailed')),
            );
          },
          onMakeDefault: (profileId: string) => {
            setSwitcherError(undefined);
            translator.switcher?.makeDefault(tabId, profileId).then(
              () => setSwitcherVersion((v) => v + 1),
              () => setSwitcherError(i18n.t('panel.header.defaultFailed')),
            );
          },
        }
      : undefined;
  const snippet = useSnippet(translator?.snippets?.store, tabId);
  const snippetJob = useJob(translator?.snippets?.jobs, tabId, snippet?.docId);
  // A site on the denylist is never read, selection included (M3-D13): its own message wins.
  const selecting = snippet !== undefined && translator?.snippets !== undefined && !(view.kind === 'blocked' && view.reason === 'denylisted');
  // Both ways (M3-E7, M5-E1); not over the dev view, whose blocks are not the reading list, nor a selection's.
  const pageDoc = view.kind === 'ready' ? view.docId : undefined;
  useScrollFollow(translator?.viewports, tabId, pageDoc, follow && !dev && !selecting, translator?.send);
  useHoverLink(translator?.hovers, tabId, pageDoc, translator?.send, !dev && !selecting);
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
  const switchSetting = (save: Promise<unknown> | undefined) => {
    const status = job?.status;
    setPrefsError(false);
    void save
      ?.then(() => {
        if (status === 'cancelled') pageActions?.resume();
      })
      // The store put the saved value back; say why the switch did not stick.
      .catch(() => setPrefsError(true));
  };
  const switchPrefs = (patch: Parameters<PrefsStore['update']>[0]) => switchSetting(translator?.prefs?.update(patch));
  const switchQuality = (patch: Parameters<PrefsStore['updateQuality']>[0]) => switchSetting(translator?.prefs?.updateQuality(patch));

  const openOptions = () => {
    void browser.runtime.openOptionsPage();
  };
  const closeThisPanel = () => void closePanel(browser);
  const [help, setHelp] = useState(false);
  const helpButton = useRef<HTMLButtonElement>(null);
  const closeHelp = () => {
    setHelp(false);
    helpButton.current?.focus();
  };
  return (
    <main class="panel" onKeyDown={(e) => help && e.key === 'Escape' && closeHelp()}>
      <header class="panel__header" ref={headerRef}>
        <div class="panel__row">
          <h1 title={view.kind === 'ready' ? view.result.title : undefined}>{view.kind === 'ready' ? view.result.title || i18n.t('panel.appName') : i18n.t('panel.appName')}</h1>
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
              title={i18n.t(follow ? 'panel.header.followOn' : 'panel.header.followOff')}
              aria-label={i18n.t('panel.header.follow')}
              onClick={toggleFollow}
            >
              ⇅
            </button>
          ) : null}
          <button type="button" class="panel__icon" ref={helpButton} data-testid="shortcuts-button" title={i18n.t('panel.header.shortcuts')} aria-label={i18n.t('panel.header.shortcuts')} aria-expanded={help} aria-controls="shortcuts" onClick={() => setHelp(!help)}>
            ?
          </button>
          <button type="button" class="panel__icon" title={i18n.t('panel.header.settings')} aria-label={i18n.t('panel.header.settings')} onClick={openOptions}>
            ⚙
          </button>
          <button type="button" class="panel__icon" title={i18n.t('panel.header.close')} aria-label={i18n.t('panel.header.closePanel')} onClick={closeThisPanel}>
            ✕
          </button>
        </div>
        {view.kind === 'ready' && translator && !selecting && !(import.meta.env.DEV && dev) ? <HeaderControls job={job} prefs={prefs} quality={quality} routedModel={routed?.model} switcher={switcherActions} actions={job ? pageActions : undefined} onPrefs={switchPrefs} onQuality={switchQuality} error={prefsError ? i18n.t('panel.header.prefsFailed') : undefined} /> : null}
      </header>
      {help ? <ShortcutList id="shortcuts" onClose={closeHelp} /> : null}
      {offerSetup ? (
        <section class="setup-offer" data-testid="setup-offer">
          <p>{i18n.t('panel.setup.text')}</p>
          <button type="button" class="job__button" data-testid="setup-open" onClick={() => void openOnboarding(browser)}>
            {i18n.t('panel.setup.button')}
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
          ) : offer && translator && tabId !== undefined ? (
            <OfferBar offer={offer} blocks={view.result.segments.length} onTranslate={() => translator.translatePage?.(tabId)} onAllow={() => translator.allowSite?.(tabId) ?? Promise.resolve(false)} onSettings={openOptions} />
          ) : (
            <p class="panel__meta" data-testid="panel-ready">
              {i18n.t('panel.meta.original', view.result.segments.length)}
            </p>
          )}
          {job?.brief ? <AboutDocument brief={job.brief} sourceLang={job.sourceLang} /> : null}
          <SegmentList segments={job?.segments ?? view.result.segments} states={job?.segs} busy={job?.status === 'running'} {...(job ? { targetLang: job.targetLang, ...(job.sourceLang ? { sourceLang: job.sourceLang } : {}) } : {})} {...(job?.model ? { model: job.model } : {})} {...(job && pageActions ? { actions: { retry: pageActions.retrySegment, retranslate: pageActions.retranslateSegment, explain: pageActions.explainSegment } } : {})} />
        </>
      )}
    </main>
  );
}
