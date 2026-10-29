// Selection mode (DESIGN.md §3, plan M3-E4). The worker takes the text a context-menu click hands
// over and leaves it for the panel in storage.session (decision S1: the worker holds no translation
// state and never waits on a model; the panel translates). The text is sent to the provider only
// because the user chose "Translate in side panel" (§8). A denylisted site's selection is never
// stored, so it can never be sent (decision M3-D13): the record says it was blocked instead.
import type { browser } from 'wxt/browser';
import { classifyUrl } from './denylist.ts';

type Browser = typeof browser;

/** Most characters of one selection that are sent; the rest is left out and the panel says so. */
export const MAX_SELECTION_CHARS = 20_000;

export interface SnippetRecord {
  /** Milliseconds since epoch; every click changes it, so a repeat of the same text translates again. */
  at: number;
  /** The page the selection was made on. */
  url: string;
  /** The selected text. Absent when `blocked`. */
  text?: string;
  /** The language the page marks the text with (BCP 47), when it marks one. */
  lang?: string;
  /** The selection came from a denylisted or never-translate site: nothing was kept, nothing will be sent. */
  blocked?: 'denylisted' | 'never';
}

const PREFIX = 'snippet:';
export const snippetKey = (tabId: number) => `${PREFIX}${tabId}`;

export function tabIdFromSnippetKey(key: string): number | null {
  if (!key.startsWith(PREFIX)) return null;
  const n = Number(key.slice(PREFIX.length));
  return Number.isInteger(n) ? n : null;
}

/** True when any of the URLs the click reports (the tab, the page, the frame the text is in) is on the denylist. */
export function anyDenylisted(...urls: (string | undefined)[]): boolean {
  return urls.some((u) => {
    if (!u) return false;
    const verdict = classifyUrl(u);
    return !verdict.ok && verdict.reason === 'denylisted';
  });
}

export async function readSnippet(api: Browser, tabId: number): Promise<SnippetRecord | undefined> {
  const key = snippetKey(tabId);
  const got = await api.storage.session.get(key);
  return got[key] as SnippetRecord | undefined;
}

export async function writeSnippet(api: Browser, tabId: number, record: Omit<SnippetRecord, 'at'>): Promise<void> {
  await api.storage.session.set({ [snippetKey(tabId)]: { ...record, at: Date.now() } satisfies SnippetRecord });
}

export async function clearSnippet(api: Browser, tabId: number): Promise<void> {
  await api.storage.session.remove(snippetKey(tabId));
}

/**
 * A selection the button's popup translates (src/entrypoints/selection-popup): the same record, kept
 * under the id the click made rather than the tab, so the side panel never takes it. `tabId` is the
 * tab the selection was made in, for the popup's Open in side panel.
 */
export interface PopupRecord extends SnippetRecord {
  tabId: number;
}

const POPUP_PREFIX = 'selectionPopup:';
export const popupKey = (id: string) => `${POPUP_PREFIX}${id}`;
/** A popup id: what crypto.randomUUID() makes. Anything else is not stored under. */
export const isPopupId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);

export async function readPopupRecord(api: Browser, id: string): Promise<PopupRecord | undefined> {
  const key = popupKey(id);
  const got = await api.storage.session.get(key);
  return got[key] as PopupRecord | undefined;
}

/** Keeps the record for popup `id`, replacing any other popup's record of the tab: a tab has one popup at a time. */
export async function writePopupRecord(api: Browser, id: string, record: Omit<PopupRecord, 'at'>): Promise<void> {
  await clearPopupRecords(api, record.tabId);
  await api.storage.session.set({ [popupKey(id)]: { ...record, at: Date.now() } satisfies PopupRecord });
}

/**
 * Drops the popup records of a tab (it closed, or a new popup replaces them). A popup removes its
 * own when it closes, but one closed before its page loaded, or by its tab closing, can't.
 */
export async function clearPopupRecords(api: Browser, tabId: number): Promise<void> {
  const all = await api.storage.session.get(null);
  const keys = Object.entries(all)
    .filter(([key, value]) => key.startsWith(POPUP_PREFIX) && (value as Partial<PopupRecord> | undefined)?.tabId === tabId)
    .map(([key]) => key);
  if (keys.length > 0) await api.storage.session.remove(keys);
}

export async function clearPopupRecord(api: Browser, id: string): Promise<void> {
  await api.storage.session.remove(popupKey(id));
}

/** The selection as paragraphs: split on blank lines, whitespace normalized, capped at MAX_SELECTION_CHARS. */
export function selectionParagraphs(text: string): { paragraphs: string[]; truncated: boolean } {
  const all = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p !== '');
  const paragraphs: string[] = [];
  let used = 0;
  let truncated = false;
  for (const p of all) {
    if (used + p.length > MAX_SELECTION_CHARS) {
      const room = MAX_SELECTION_CHARS - used;
      if (room > 0 && paragraphs.length === 0) paragraphs.push(p.slice(0, room));
      truncated = true;
      break;
    }
    paragraphs.push(p);
    used += p.length;
  }
  return { paragraphs, truncated };
}
