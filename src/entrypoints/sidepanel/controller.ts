// Tab-scoped routing in the panel (plan M0-E4, decision S1). The panel is global to its window
// and follows the window's active tab. Per tab it reads the worker's access record, connects to
// the content script with tabs.connect, says hello, and asks for the page's segments.
import type { browser } from 'wxt/browser';
import { readAccess, tabIdFromKey, type AccessReason, type TabAccess } from '@/shared/access';
import {
  CONTENT_PORT_NAME,
  createClient,
  PROTOCOL_VERSION,
  ProtocolError,
  type Client,
  type ContentApi,
  type ExtractResult,
  type PortLike,
  type Viewport,
} from '@/shared/protocol';

type Browser = typeof browser;

export type PanelView =
  /** No injection yet for this tab: the user has to click the icon or press Alt+T. */
  | { kind: 'idle' }
  | { kind: 'loading' }
  /** Chrome or the denylist forbids reading the page. */
  | { kind: 'blocked'; reason: AccessReason | 'denylisted'; detail?: string }
  /**
   * The activeTab grant ended (cross-origin navigation); a new gesture is needed (S5). Without a
   * grant Chrome hides the tab's URL, so a move to a browser page or the Web Store looks the same.
   */
  | { kind: 'lost' }
  /** Neither the walk nor Readability found the text: the selection hint (S3). */
  | { kind: 'empty'; url: string }
  | { kind: 'ready'; result: Extract<ExtractResult, { ok: true }>; docId: string }
  | { kind: 'error'; message: string };

interface TabSession {
  view: PanelView;
  client?: Client<ContentApi>;
  port?: PortLike;
  /** `at` of the access record this session last acted on. */
  accessAt?: number;
  /** From the content script's hello: the document the live connection talks to. */
  docId?: string;
  /** Bumped on every (re)connect, so a stale async step can tell it lost the race. */
  generation: number;
  /** Between tabs.onUpdated 'loading' and 'complete'. */
  pageLoading?: boolean;
  /** The view a page load replaced with "loading", restored if the document survives (same-document navigation). */
  beforeLoad?: PanelView;
  /** Waiting for the worker's re-injection: the "lost" timer starts once the page has loaded. */
  awaiting?: { generation: number; accessAt: number | undefined };
  lostTimer?: ReturnType<typeof setTimeout>;
}

export interface ControllerOptions {
  /** How long to show "loading" before "idle" when a tab has no access record yet. */
  idleGraceMs?: number;
  requestTimeoutMs?: number;
  /** The hello is answered at once by a live content script; a slow one means a stale or broken copy. */
  helloTimeoutMs?: number;
  /** After the page has loaded, how long to wait for the worker's re-injection before "lost". */
  lostAfterMs?: number;
  /** Job lifecycle (plan M1-E8): what the page's translation job follows. */
  hooks?: SessionHooks;
}

/** The panel's view of a tab's document, for the job that translates it (sidepanel/jobs.ts). */
export interface SessionHooks {
  /** The document's segments were read (a new document, or the same one read again). */
  ready?(tabId: number, docId: string, result: Extract<ExtractResult, { ok: true }>): void;
  /**
   * The connection to the document ended: a navigation or reload, a lost grant, a re-read.
   * Its job must stop.
   */
  gone?(tabId: number): void;
  /** The tab closed or moved to another window: its job is forgotten. */
  closed?(tabId: number): void;
  /** The window's active tab (pause on tab switch, D14). */
  active?(tabId: number | undefined): void;
  /** What is on screen in the document changed (plan M3-E1 priority, M3-E7 scroll follow). */
  viewport?(tabId: number, docId: string, viewport: Viewport): void;
}

export class PanelController {
  private readonly sessions = new Map<number, TabSession>();
  private activeTabId: number | undefined;
  private windowId: number | undefined;
  private readonly listeners = new Set<(view: PanelView, tabId: number | undefined) => void>();
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly api: Browser,
    private readonly opts: ControllerOptions = {},
  ) {}

  subscribe(fn: (view: PanelView, tabId: number | undefined) => void): () => void {
    this.listeners.add(fn);
    fn(this.view, this.activeTabId);
    return () => this.listeners.delete(fn);
  }

  /** The window's active tab. */
  get tabId(): number | undefined {
    return this.activeTabId;
  }

  get view(): PanelView {
    return this.activeTabId === undefined ? { kind: 'idle' } : (this.sessions.get(this.activeTabId)?.view ?? { kind: 'loading' });
  }

  async start(): Promise<void> {
    const win = await this.api.windows.getCurrent();
    this.windowId = win.id;
    this.api.tabs.onActivated.addListener(({ tabId, windowId }) => {
      if (windowId !== this.windowId) return;
      this.setActive(tabId);
    });
    this.api.tabs.onUpdated.addListener((tabId, info) => {
      const s = this.sessions.get(tabId);
      if (!s) return;
      if (info.status === 'loading') this.pageLoading(tabId, s);
      else if (info.status === 'complete') this.pageComplete(tabId, s);
    });
    this.api.tabs.onRemoved.addListener((tabId) => this.drop(tabId));
    this.api.tabs.onDetached.addListener((tabId, info) => {
      if (info.oldWindowId === this.windowId) this.drop(tabId);
    });
    this.api.storage.session.onChanged.addListener((changes) => {
      for (const key of Object.keys(changes)) {
        const tabId = tabIdFromKey(key);
        if (tabId !== null && tabId === this.activeTabId) void this.refresh(tabId);
      }
    });
    const [tab] = await this.api.tabs.query({ active: true, windowId: this.windowId });
    if (tab?.id !== undefined) this.setActive(tab.id);
  }

  /** Re-run extraction for the active tab (the error state's "Try again"). */
  retry(): void {
    if (this.activeTabId === undefined) return;
    this.disconnect(this.activeTabId);
    void this.refresh(this.activeTabId, { force: true });
  }

  private setActive(tabId: number): void {
    this.activeTabId = tabId;
    this.opts.hooks?.active?.(tabId);
    this.emit();
    void this.refresh(tabId);
  }

  private session(tabId: number): TabSession {
    let s = this.sessions.get(tabId);
    if (!s) {
      s = { view: { kind: 'loading' }, generation: 0 };
      this.sessions.set(tabId, s);
    }
    return s;
  }

  private setView(tabId: number, view: PanelView): void {
    this.session(tabId).view = view;
    if (tabId === this.activeTabId) this.emit();
  }

  private emit(): void {
    const view = this.view;
    for (const fn of this.listeners) fn(view, this.activeTabId);
  }

  private async refresh(tabId: number, { force = false } = {}): Promise<void> {
    clearTimeout(this.idleTimer);
    const access = await readAccess(this.api, tabId).catch(() => undefined);
    if (tabId !== this.activeTabId) return;
    const s = this.session(tabId);
    if (!access) {
      // The worker writes the record right after it opens the panel; give it a moment.
      if (s.view.kind !== 'loading') this.setView(tabId, { kind: 'loading' });
      this.idleTimer = setTimeout(() => {
        if (tabId === this.activeTabId && !s.accessAt) this.setView(tabId, { kind: 'idle' });
      }, this.opts.idleGraceMs ?? 1500);
      return;
    }
    const changed = access.at !== s.accessAt;
    s.accessAt = access.at;
    this.apply(tabId, s, access, force || changed);
  }

  private apply(tabId: number, s: TabSession, access: TabAccess, changed: boolean): void {
    switch (access.status) {
      case 'injecting':
        if (!s.client || s.client.closed) this.setView(tabId, { kind: 'loading' });
        return;
      case 'blocked':
        this.disconnect(tabId);
        this.setView(tabId, { kind: 'blocked', reason: access.reason ?? 'restricted', ...(access.detail ? { detail: access.detail } : {}) });
        return;
      case 'lost':
        this.disconnect(tabId);
        this.setView(tabId, { kind: 'lost' });
        return;
      case 'ready':
        // A live connection to the same document stays as it is (hash/pushState changes and
        // repeat clicks re-inject as "already injected"). SPA re-extraction is M5. A new gesture
        // on a page that came out empty or failed reads it again on the same connection.
        if (s.client && !s.client.closed) {
          if (!changed || (s.view.kind !== 'empty' && s.view.kind !== 'error')) return;
          if (s.docId === undefined) void this.connect(tabId);
          else void this.extract(tabId, s, s.client, s.generation);
          return;
        }
        if (!changed && s.view.kind !== 'loading' && s.view.kind !== 'idle') return;
        void this.connect(tabId);
        return;
    }
  }

  private async connect(tabId: number): Promise<void> {
    const s = this.session(tabId);
    this.disconnect(tabId);
    const generation = ++s.generation;
    delete s.awaiting;
    clearTimeout(s.lostTimer);
    this.setView(tabId, { kind: 'loading' });
    let port: PortLike;
    try {
      port = this.api.tabs.connect(tabId, { name: CONTENT_PORT_NAME, frameId: 0 });
    } catch (err) {
      this.setView(tabId, { kind: 'error', message: messageOf(err) });
      return;
    }
    const onEvent = (event: { name: 'viewport'; body: Viewport }) => {
      if (s.generation === generation && s.docId !== undefined && event.name === 'viewport') this.opts.hooks?.viewport?.(tabId, s.docId, event.body);
    };
    const client = createClient<ContentApi>(port, { onEvent, ...(this.opts.requestTimeoutMs ? { timeoutMs: this.opts.requestTimeoutMs } : {}) });
    s.port = port;
    s.client = client;
    port.onDisconnect.addListener(() => {
      if (s.generation === generation) this.opts.hooks?.gone?.(tabId);
      if (s.generation === generation && (s.view.kind === 'ready' || s.pageLoading)) this.awaitReinjection(tabId, s, generation);
    });
    try {
      const hello = await client.request('hello', { v: PROTOCOL_VERSION }, { timeoutMs: this.opts.helloTimeoutMs ?? 5000 });
      if (s.generation !== generation) return;
      s.docId = hello.docId;
    } catch (err) {
      this.fail(tabId, s, generation, err);
      return;
    }
    await this.extract(tabId, s, client, generation);
  }

  private async extract(tabId: number, s: TabSession, client: Client<ContentApi>, generation: number): Promise<void> {
    this.setView(tabId, { kind: 'loading' });
    try {
      const result = await client.request('extract', {});
      if (s.generation !== generation) return;
      if (result.ok) {
        this.setView(tabId, { kind: 'ready', result, docId: s.docId ?? '' });
        this.opts.hooks?.ready?.(tabId, s.docId ?? '', result);
      }
      else if (result.reason === 'denylisted') this.setView(tabId, { kind: 'blocked', reason: 'denylisted' });
      else this.setView(tabId, { kind: 'empty', url: result.url });
    } catch (err) {
      this.fail(tabId, s, generation, err);
    }
  }

  private fail(tabId: number, s: TabSession, generation: number, err: unknown): void {
    if (s.generation !== generation) return;
    if (err instanceof ProtocolError && err.code === 'disconnected') this.awaitReinjection(tabId, s, generation);
    else this.setView(tabId, { kind: 'error', message: messageOf(err) });
  }

  /** A navigation started: the panel shows "loading" until the page settles. */
  private pageLoading(tabId: number, s: TabSession): void {
    s.pageLoading = true;
    if (s.view.kind === 'ready' || s.view.kind === 'empty') {
      s.beforeLoad = s.view;
      this.setView(tabId, { kind: 'loading' });
    }
  }

  private pageComplete(tabId: number, s: TabSession): void {
    s.pageLoading = false;
    const before = s.beforeLoad;
    delete s.beforeLoad;
    if (s.awaiting) this.startLostTimer(tabId, s);
    // Same-document navigation: the connection survived, so the page is what it was.
    else if (before && s.view.kind === 'loading' && s.client && !s.client.closed) this.setView(tabId, before);
  }

  /**
   * The page side went away: a navigation or reload (the worker re-injects on load complete and
   * updates the access record, which brings us back through refresh()), or no content script at
   * all. If no new record arrives within lostAfterMs of the page loading, the grant did not
   * follow the page (S5). A slow page keeps "loading" for as long as it loads.
   */
  private awaitReinjection(tabId: number, s: TabSession, generation: number): void {
    s.awaiting = { generation, accessAt: s.accessAt };
    delete s.beforeLoad;
    this.setView(tabId, { kind: 'loading' });
    if (!s.pageLoading) this.startLostTimer(tabId, s);
  }

  private startLostTimer(tabId: number, s: TabSession): void {
    const awaiting = s.awaiting;
    if (!awaiting) return;
    clearTimeout(s.lostTimer);
    s.lostTimer = setTimeout(() => {
      if (s.awaiting !== awaiting) return;
      delete s.awaiting;
      if (s.generation === awaiting.generation && s.accessAt === awaiting.accessAt && s.view.kind === 'loading') this.setView(tabId, { kind: 'lost' });
    }, this.opts.lostAfterMs ?? 4000);
  }

  private disconnect(tabId: number): void {
    const s = this.sessions.get(tabId);
    if (!s?.port) return;
    this.opts.hooks?.gone?.(tabId);
    s.generation++;
    delete s.docId;
    try {
      s.port.disconnect();
    } catch {
      // Already gone.
    }
    delete s.port;
    delete s.client;
  }

  private drop(tabId: number): void {
    this.disconnect(tabId);
    this.opts.hooks?.closed?.(tabId);
    clearTimeout(this.sessions.get(tabId)?.lostTimer);
    this.sessions.delete(tabId);
    if (tabId === this.activeTabId) {
      this.activeTabId = undefined;
      this.opts.hooks?.active?.(undefined);
      this.emit();
    }
  }
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
