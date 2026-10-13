// The translation memory: the user's own corrections, as (source, corrected target) entries, in a
// database of its own (`translate-side-memory`), apart from the translation cache. The cache is
// disposable (LRU, "Clear cache"); edits are user data and survive both. Owned by the panel shell
// and the options page; the engine never sees this store (DESIGN.md §5.1).
//
// - An entry is keyed by the target language and the source text as the cache normalises it, so
//   an edit applies across models, strategies and styles.
// - `override` entries are shown in place of a translation (exact source), before the cache and
//   the engine, and are never sent. The user's own edits always override; imported entries only
//   when the user ticked "Also replace matching blocks".
// - Each entry records where it came from (`origin`, `localOnly`, `by`) so later readers can keep
//   corrections made under a local-only site rule, or on another site, away from cloud routes.
// - At most MAX_MEMORY_ENTRIES: a new edit at the cap replaces the least recently updated entry;
//   an import never evicts anything, and stores only what fits.
// - The memory has its own export file (`translate-side-memory`), separate from the settings file.
//   An imported file is untrusted: size-capped before parsing, validated entry by entry, checked
//   like a model's answer (`checkSegment`), and stripped of its provenance.
// - No migration: later schema changes bump this database's own version in `onupgradeneeded`.
import { i18n } from '#i18n';
import { checkSegment } from '@/engine/index';
import { hash53 } from '@/segment/hash';
import { normalizeForKey } from './cache.ts';

export const MEMORY_DB = 'translate-side-memory';
export const MEMORY_DB_VERSION = 1;
export const MAX_MEMORY_ENTRIES = 5000;
/** The most characters each side of an entry may have. */
export const MAX_MEMORY_TEXT = 4000;
export const MAX_MEMORY_IMPORT_BYTES = 10 * 1024 * 1024;
export const MEMORY_FORMAT = 'translate-side-memory';
export const MEMORY_FORMAT_VERSION = 1;
/** The `origin` of every imported entry: it was made on no page of this profile. */
export const IMPORT_ORIGIN = 'import';

export type MemoryBy = 'user' | 'import';

export interface MemoryEntry {
  /** memoryKey(targetLang, source). */
  key: string;
  /** The source as the cache normalises it (light markers kept). */
  source: string;
  target: string;
  /** "" when the page's language was not known. */
  sourceLang: string;
  targetLang: string;
  /** The page origin it was made on, or IMPORT_ORIGIN. */
  origin: string;
  /** Made, at least once, on a page under a local-only site rule. */
  localOnly: boolean;
  by: MemoryBy;
  /** Shown in place of the translation of the same source (never sent). */
  override: boolean;
  created: number;
  updated: number;
}

/** A correction the user made in the panel. */
export interface MemoryEdit {
  source: string;
  target: string;
  sourceLang: string;
  targetLang: string;
  origin: string;
  localOnly: boolean;
}

/** One entry of an import file that passed every check, ready to store. */
export interface ImportEntry {
  key: string;
  source: string;
  target: string;
  sourceLang: string;
  targetLang: string;
  created: number;
}

export interface ImportResult {
  /** Stored, new or replacing an earlier imported entry. */
  stored: number;
  /** Left alone: the user's own edit of the same source wins over a file. */
  kept: number;
  /** Not stored: the memory was full. */
  full: number;
}

export interface TranslationMemory {
  /** Saves the user's edit (by `user`, an override). Rejects a side over MAX_MEMORY_TEXT or empty. */
  put(edit: MemoryEdit): Promise<MemoryEntry>;
  getMany(keys: readonly string[]): Promise<Map<string, MemoryEntry>>;
  delete(keys: readonly string[]): Promise<void>;
  /** Up to `limit` entries of a target language. */
  list(targetLang: string, limit: number): Promise<MemoryEntry[]>;
  count(): Promise<number>;
  clear(): Promise<void>;
  /** The export file (JSON) and how many entries it holds. Provenance stays out of it. */
  exportFile(now?: Date): Promise<{ json: string; count: number }>;
  /** Stores entries from parseMemoryImport as `by: 'import'`; `override` when the user ticked it. */
  importMany(entries: readonly ImportEntry[], options: { override: boolean }): Promise<ImportResult>;
  /** A counter bumped by every write, from any page of the extension: a reader reloads when it changed. */
  version(): Promise<number>;
}

// ---- The key and the text rules -----------------------------------------------------------------

/** The memory key of a source in a target language. Two hashes keep collisions out of reach. */
export function memoryKey(targetLang: string, source: string): string {
  const body = `${targetLang.toLowerCase()}\u0000${normalizeForKey(source)}`;
  return `m.${hash53(body).toString(36)}.${hash53(body, 1).toString(36)}`;
}

/** C0 and C1 control characters other than tab, line feed and carriage return. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
// eslint-disable-next-line no-control-regex
const CONTROL_ALL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** An edit as typed, made storable: control characters out, trimmed. */
export const cleanEditText = (text: string): string => text.replace(CONTROL_ALL, '').trim();

const LANG_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/;

export const memoryExportFileName = (now: Date = new Date()) => `${MEMORY_FORMAT}-${now.toISOString().slice(0, 10)}.json`;

// ---- Import: parse and validate -----------------------------------------------------------------

export type MemoryImportParse = { ok: true; entries: ImportEntry[]; skipped: number } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One raw entry of a file, or undefined when it fails any check. Its own key and provenance are never read. */
function importEntry(raw: unknown, now: number): ImportEntry | undefined {
  if (!isRecord(raw)) return undefined;
  const { source, target, sourceLang = '', targetLang, created } = raw;
  if (typeof source !== 'string' || typeof target !== 'string' || typeof targetLang !== 'string' || typeof sourceLang !== 'string') return undefined;
  if (source.length > MAX_MEMORY_TEXT || target.length > MAX_MEMORY_TEXT) return undefined;
  if (CONTROL.test(source) || CONTROL.test(target)) return undefined;
  if (!LANG_TAG.test(targetLang) || (sourceLang !== '' && !LANG_TAG.test(sourceLang))) return undefined;
  const src = normalizeForKey(source);
  const tgt = target.trim();
  if (src === '' || tgt === '') return undefined;
  // Checked as a model's answer would be: code spans, links, URLs and numbers kept, a sane length, the right script.
  if (checkSegment(src, tgt, targetLang).length > 0) return undefined;
  const stamp = typeof created === 'number' && Number.isFinite(created) && created >= 0 && created <= now ? created : now;
  return { key: memoryKey(targetLang, src), source: src, target: tgt, sourceLang, targetLang, created: stamp };
}

/**
 * A memory file, checked before anything is stored: its size before it is parsed, its format and
 * version, then each entry (lengths, control characters, languages, `checkSegment`). Entries that
 * fail are skipped and counted, as are those past MAX_MEMORY_ENTRIES; a later entry for the same
 * source replaces an earlier one.
 */
export function parseMemoryImport(text: string, now: number = Date.now()): MemoryImportParse {
  if (text.length > MAX_MEMORY_IMPORT_BYTES || new TextEncoder().encode(text).byteLength > MAX_MEMORY_IMPORT_BYTES) return { ok: false, error: i18n.t('options.memory.tooLarge') };
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, error: i18n.t('options.portable.notJson') };
  }
  if (!isRecord(root) || root.format !== MEMORY_FORMAT || !Array.isArray(root.entries)) return { ok: false, error: i18n.t('options.memory.notOurs') };
  if (typeof root.formatVersion !== 'number' || !Number.isInteger(root.formatVersion) || root.formatVersion < 1) return { ok: false, error: i18n.t('options.memory.noVersion') };
  if (root.formatVersion > MEMORY_FORMAT_VERSION) return { ok: false, error: i18n.t('options.memory.newerVersion') };
  const raw = root.entries as unknown[];
  const byKey = new Map<string, ImportEntry>();
  let skipped = Math.max(0, raw.length - MAX_MEMORY_ENTRIES);
  for (const r of raw.slice(0, MAX_MEMORY_ENTRIES)) {
    const e = importEntry(r, now);
    if (e === undefined) skipped++;
    else {
      byKey.delete(e.key);
      byKey.set(e.key, e);
    }
  }
  return { ok: true, entries: [...byKey.values()], skipped };
}

// ---- IndexedDB ------------------------------------------------------------------------------------

interface VersionRow {
  key: 'version';
  n: number;
}

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('aborted', 'AbortError'));
  });

/** Bumps the write counter inside a write transaction. */
async function bump(meta: IDBObjectStore): Promise<void> {
  const row = (await req(meta.get('version'))) as VersionRow | undefined;
  meta.put({ key: 'version', n: (row?.n ?? 0) + 1 } satisfies VersionRow);
}

/** Deletes the least recently updated entries (other than `keep`) until `extra` are gone. */
function evict(store: IDBObjectStore, extra: number, keep: string): Promise<void> {
  if (extra <= 0) return Promise.resolve();
  const cursor = store.index('updated').openCursor();
  return new Promise<void>((resolve, reject) => {
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c || extra <= 0) return resolve();
      if ((c.value as MemoryEntry).key !== keep) {
        c.delete();
        extra--;
      }
      c.continue();
    };
  });
}

export interface IdbMemoryOptions {
  /** Default: the global `indexedDB`. */
  factory?: IDBFactory;
  name?: string;
  maxEntries?: number;
  now?: () => number;
}

/** The IndexedDB memory, or undefined where the browser has none (edits then last for the session only). */
export function openTranslationMemory(options: IdbMemoryOptions = {}): TranslationMemory | undefined {
  const factory = options.factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
  if (!factory) return undefined;
  const maxEntries = options.maxEntries ?? MAX_MEMORY_ENTRIES;
  const now = options.now ?? Date.now;
  let opening: Promise<IDBDatabase> | undefined;
  const db = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open(options.name ?? MEMORY_DB, MEMORY_DB_VERSION);
      open.onupgradeneeded = () => {
        const d = open.result;
        const entries = d.createObjectStore('entries', { keyPath: 'key' });
        entries.createIndex('targetLang', 'targetLang');
        entries.createIndex('updated', 'updated');
        d.createObjectStore('meta', { keyPath: 'key' });
      };
      open.onsuccess = () => {
        const d = open.result;
        // Another tab upgrades or deletes the database, or the browser drops the connection: let go
        // and open again on the next call, rather than keeping a dead handle.
        const forget = () => {
          if (opening !== undefined) opening = undefined;
          d.close();
        };
        d.onversionchange = forget;
        d.onclose = () => (opening = undefined);
        resolve(d);
      };
      open.onblocked = () => {
        opening = undefined;
        reject(new DOMException('the memory database is blocked', 'InvalidStateError'));
      };
      open.onerror = () => {
        opening = undefined;
        reject(open.error);
      };
    }));

  return {
    async put(edit) {
      const source = normalizeForKey(edit.source);
      const target = edit.target.trim();
      if (source === '' || target === '') throw new RangeError('an empty side');
      if (source.length > MAX_MEMORY_TEXT || target.length > MAX_MEMORY_TEXT) throw new RangeError(`a side over ${MAX_MEMORY_TEXT} characters`);
      const key = memoryKey(edit.targetLang, source);
      const tx = (await db()).transaction(['entries', 'meta'], 'readwrite');
      const store = tx.objectStore('entries');
      const old = (await req(store.get(key))) as MemoryEntry | undefined;
      const stamp = now();
      const entry: MemoryEntry = {
        key,
        source,
        target,
        sourceLang: edit.sourceLang,
        targetLang: edit.targetLang,
        origin: edit.origin,
        // Once made under a local-only rule, an entry stays local-only, whatever later edits it.
        localOnly: edit.localOnly || (old?.by === 'user' && old.localOnly),
        by: 'user',
        override: true,
        created: old?.created ?? stamp,
        updated: stamp,
      };
      store.put(entry);
      if (!old) await evict(store, (await req(store.count())) - maxEntries, key);
      await bump(tx.objectStore('meta'));
      await done(tx);
      return entry;
    },

    async getMany(keys) {
      const found = new Map<string, MemoryEntry>();
      if (keys.length === 0) return found;
      const tx = (await db()).transaction('entries', 'readonly');
      const store = tx.objectStore('entries');
      await Promise.all(
        [...new Set(keys)].map(async (key) => {
          const row = (await req(store.get(key))) as MemoryEntry | undefined;
          if (row) found.set(key, row);
        }),
      );
      await done(tx);
      return found;
    },

    async delete(keys) {
      if (keys.length === 0) return;
      const tx = (await db()).transaction(['entries', 'meta'], 'readwrite');
      const store = tx.objectStore('entries');
      for (const key of keys) store.delete(key);
      await bump(tx.objectStore('meta'));
      await done(tx);
    },

    async list(targetLang, limit) {
      // IndexedDB reads a count of 0 as "all".
      if (limit < 1) return [];
      const tx = (await db()).transaction('entries', 'readonly');
      const rows = (await req(tx.objectStore('entries').index('targetLang').getAll(targetLang, Math.floor(limit)))) as MemoryEntry[];
      await done(tx);
      return rows;
    },

    async count() {
      const tx = (await db()).transaction('entries', 'readonly');
      const n = await req(tx.objectStore('entries').count());
      await done(tx);
      return n;
    },

    async clear() {
      const tx = (await db()).transaction(['entries', 'meta'], 'readwrite');
      tx.objectStore('entries').clear();
      await bump(tx.objectStore('meta'));
      await done(tx);
    },

    async exportFile(at = new Date()) {
      const tx = (await db()).transaction('entries', 'readonly');
      const rows = (await req(tx.objectStore('entries').getAll())) as MemoryEntry[];
      await done(tx);
      rows.sort((a, b) => a.created - b.created);
      // Where an entry was made (its site, a local-only rule) stays on this device.
      const entries = rows.map(({ source, target, sourceLang, targetLang, created, updated }) => ({ source, target, sourceLang, targetLang, created, updated }));
      const json = JSON.stringify({ format: MEMORY_FORMAT, formatVersion: MEMORY_FORMAT_VERSION, exportedAt: at.toISOString(), entries }, null, 2);
      return { json, count: entries.length };
    },

    async importMany(entries, { override }) {
      const result: ImportResult = { stored: 0, kept: 0, full: 0 };
      if (entries.length === 0) return result;
      const tx = (await db()).transaction(['entries', 'meta'], 'readwrite');
      const store = tx.objectStore('entries');
      let size = await req(store.count());
      const stamp = now();
      for (const e of entries) {
        const old = (await req(store.get(e.key))) as MemoryEntry | undefined;
        if (old?.by === 'user') {
          result.kept++;
          continue;
        }
        if (!old && size >= maxEntries) {
          result.full++;
          continue;
        }
        // The file's own provenance is never trusted: an import is from no site and under no rule.
        store.put({ key: e.key, source: e.source, target: e.target, sourceLang: e.sourceLang, targetLang: e.targetLang, origin: IMPORT_ORIGIN, localOnly: false, by: 'import', override, created: e.created, updated: stamp } satisfies MemoryEntry);
        if (!old) size++;
        result.stored++;
      }
      if (result.stored > 0) await bump(tx.objectStore('meta'));
      await done(tx);
      return result;
    },

    async version() {
      const tx = (await db()).transaction('meta', 'readonly');
      const row = (await req(tx.objectStore('meta').get('version'))) as VersionRow | undefined;
      await done(tx);
      return row?.n ?? 0;
    },
  };
}
