// Selection mode (DESIGN.md §3, plan M3-E4). The worker takes the text a context-menu click hands
// over and leaves it for the panel in storage.session (decision S1: the worker holds no translation
// state and never waits on a model; the panel translates). The text is sent to the provider only
// because the user chose "Translate in side panel" (§8). A denylisted site's selection is never
// stored, so it can never be sent (decision M3-D13): the record says it was blocked instead.
import type { browser } from 'wxt/browser';
import { classifyUrl } from './denylist.ts';

type Browser = typeof browser;

/** What the panel shows when a selection came from a denylisted site. Same wording as the page state. */
export const DENYLIST_MESSAGE = 'Translate Side never reads this site (mail and sign-in pages are on a built-in denylist).';

/** The hint of a page whose text could not be extracted (plan M3 §2). */
export const EXTRACTION_HINT = "Couldn't read this page. Select text to translate it.";

/** Most characters of one selection that are sent; the rest is left out and the panel says so. */
export const MAX_SELECTION_CHARS = 20_000;

export interface SnippetRecord {
  /** Milliseconds since epoch; every click changes it, so a repeat of the same text translates again. */
  at: number;
  /** The page the selection was made on. */
  url: string;
  /** The selected text. Absent when `blocked`. */
  text?: string;
  /** The selection came from a denylisted site: nothing was kept, nothing will be sent. */
  blocked?: 'denylisted';
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
