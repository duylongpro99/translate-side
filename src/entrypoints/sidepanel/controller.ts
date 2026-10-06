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
} from '@/shared/protocol';

type Browser = typeof browser;

export type PanelView =
  /** No injection yet for this tab: the user has to click the icon or press Alt+T. */
  | { kind: 'idle' }
  | { kind: 'loading' }
  /** Chrome or the denylist forbids reading the page. */
  | { kind: 'blocked'; reason: AccessReason | 'denylisted'; detail?: string }
  /** The activeTab grant ended (cross-origin navigation); a new gesture is needed (S5). */
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
  /** Bumped on every (re)connect, so a stale async step can tell it lost the race. */
  generation: number;
}

export interface ControllerOptions {
  /** How long to show "loading" before "idle" when a tab has no access record yet. */
  idleGraceMs?: number;
  requestTimeoutMs?: number;
  /** After the page side disconnects, how long to wait for the worker's re-injection before "lost". */
  lostAfterMs?: number;
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
        // repeat clicks re-inject as "already injected"). SPA re-extraction is M5.
        if (s.client && !s.client.closed && s.view.kind !== 'error') return;
        if (!changed && s.view.kind !== 'loading' && s.view.kind !== 'idle') return;
        void this.connect(tabId);
        return;
    }
  }

  private async connect(tabId: number): Promise<void> {
    const s = this.session(tabId);
    this.disconnect(tabId);
    const generation = ++s.generation;
    this.setView(tabId, { kind: 'loading' });
    let port: PortLike;
    try {
      port = this.api.tabs.connect(tabId, { name: CONTENT_PORT_NAME, frameId: 0 });
    } catch (err) {
      this.setView(tabId, { kind: 'error', message: messageOf(err) });
      return;
    }
    const client = createClient<ContentApi>(port, this.opts.requestTimeoutMs ? { timeoutMs: this.opts.requestTimeoutMs } : {});
    s.port = port;
    s.client = client;
    port.onDisconnect.addListener(() => {
      if (s.generation === generation && s.view.kind === 'ready') this.awaitReinjection(tabId, s, generation);
    });
    try {
      const hello = await client.request('hello', { v: PROTOCOL_VERSION });
      const result = await client.request('extract', {});
      if (s.generation !== generation) return;
      if (result.ok) this.setView(tabId, { kind: 'ready', result, docId: hello.docId });
      else if (result.reason === 'denylisted') this.setView(tabId, { kind: 'blocked', reason: 'denylisted' });
      else this.setView(tabId, { kind: 'empty', url: result.url });
    } catch (err) {
      if (s.generation !== generation) return;
      if (err instanceof ProtocolError && err.code === 'disconnected') this.awaitReinjection(tabId, s, generation);
      else this.setView(tabId, { kind: 'error', message: messageOf(err) });
    }
  }

  /**
   * The page side went away: a navigation or reload (the worker re-injects on load complete and
   * updates the access record, which brings us back through refresh()), or no content script at
   * all. If no new record arrives in time, the grant did not follow the page (S5).
   */
  private awaitReinjection(tabId: number, s: TabSession, generation: number): void {
    const accessAt = s.accessAt;
    this.setView(tabId, { kind: 'loading' });
    setTimeout(() => {
      if (s.generation === generation && s.accessAt === accessAt && s.view.kind === 'loading') this.setView(tabId, { kind: 'lost' });
    }, this.opts.lostAfterMs ?? 4000);
  }

  private disconnect(tabId: number): void {
    const s = this.sessions.get(tabId);
    if (!s?.port) return;
    s.generation++;
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
    this.sessions.delete(tabId);
    if (tabId === this.activeTabId) {
      this.activeTabId = undefined;
      this.emit();
    }
  }
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
