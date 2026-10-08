// The translation cache (DESIGN.md §7, plan M3-E2): IndexedDB, owned by the panel shell. The engine
// never sees it (§5.1); jobs.ts looks segments up before a run and stores what a run produced.
//
// - Key (M3-D1): hash(normalized segment text + kind + targetLang + model + style + gloss +
//   strategy@version + prompt versions + glossaryHash). The brief is deliberately NOT in it (M3-D2).
// - Only the highest (revision, attempt) of a segment is stored; a failure removes the entry.
// - LRU by `used`, evicting to stay under `maxBytes` (~50 MB).
// - Briefs: by `url + contentHash + targetLang + analyze prompt` (engine briefCacheKey).
import { hash53 as cyrb53 } from '@/segment/hash';
import { CONTEXTUAL_CACHE_KEY, SINGLE_PASS_CACHE_KEY, glossaryHash, type DocumentBrief, type GlossaryEntry, type GlossMode, type Segment, type StrategyId, type StyleMode } from '@/engine/index';

export const CACHE_DB = 'translate-side-cache';
export const CACHE_MAX_BYTES = 50 * 1024 * 1024;
/** Briefs are small; they are kept by count, least recently used first out. */
export const BRIEF_MAX_ENTRIES = 200;

export interface CachedSegment {
  text: string;
  revision: number;
  attempt: number;
}

export interface CacheStats {
  entries: number;
  bytes: number;
  briefs: number;
  maxBytes: number;
}

export interface TranslationCache {
  /** The entries found for `keys` (their LRU stamp is refreshed). */
  getMany(keys: readonly string[]): Promise<Map<string, CachedSegment>>;
  /**
   * Stores each entry unless a higher revision/attempt is already there. `replace` (a retranslate,
   * which the user asked for) stores it whatever is there.
   */
  putMany(entries: ReadonlyMap<string, CachedSegment>, options?: { replace?: boolean }): Promise<void>;
  delete(keys: readonly string[]): Promise<void>;
  getBrief(key: string): Promise<DocumentBrief | undefined>;
  putBrief(key: string, brief: DocumentBrief): Promise<void>;
  stats(): Promise<CacheStats>;
  clear(): Promise<void>;
}

// ---- The key ---------------------------------------------------------------------------------

const ZERO_WIDTH = new RegExp('[\\u200B-\\u200D\\uFEFF]', 'g');

/**
 * What a segment's text is hashed as: Unicode NFC, every run of whitespace (and zero-width
 * characters a page may add or drop between visits) one space, trimmed. A re-extraction of the
 * same page then lands on the same key (plan M3 §8 risk). The light markers stay: they are part of
 * what the model translates.
 */
export function normalizeForKey(text: string): string {
  return text.normalize('NFC').replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();
}

export interface StrategyKeyInfo {
  strategy: string;
  version: number;
  promptIds: readonly string[];
}

/** `strategy@version` and the prompt versions of a strategy (§5.5); unknown ids (test engines) key on the id alone. */
export function strategyKeyInfo(id: StrategyId): StrategyKeyInfo {
  if (id === CONTEXTUAL_CACHE_KEY.strategy) return { strategy: id, version: CONTEXTUAL_CACHE_KEY.version, promptIds: CONTEXTUAL_CACHE_KEY.promptIds };
  if (id === SINGLE_PASS_CACHE_KEY.strategy) return { strategy: id, version: SINGLE_PASS_CACHE_KEY.version, promptIds: [SINGLE_PASS_CACHE_KEY.promptId] };
  return { strategy: id, version: 0, promptIds: [] };
}

/** What every segment key of a run shares. */
export interface KeyScope {
  targetLang: string;
  model: string;
  style: StyleMode;
  gloss: GlossMode;
  strategy: StrategyKeyInfo;
  glossary: readonly GlossaryEntry[];
}

export function keyScope(s: { targetLang: string; model: string; style?: StyleMode | undefined; gloss?: GlossMode | undefined; strategy: StrategyId; glossary?: readonly GlossaryEntry[] | undefined }): KeyScope {
  return { targetLang: s.targetLang, model: s.model, style: s.style ?? 'natural', gloss: s.gloss ?? 'first', strategy: strategyKeyInfo(s.strategy), glossary: s.glossary ?? [] };
}

/** The scope part, hashed once per run. */
export function scopeHash(scope: KeyScope): string {
  const { strategy: st } = scope;
  return cyrb53(JSON.stringify([scope.targetLang, scope.model, scope.style, scope.gloss, `${st.strategy}@${st.version}`, st.promptIds, glossaryHash(scope.glossary)])).toString(36);
}

/** The cache key of one segment under a scope (`scopeHash(scope)`). Two hashes keep collisions out of reach. */
export function segmentKey(scope: string, segment: Pick<Segment, 'kind' | 'inlineMarkup' | 'text'>): string {
  const text = normalizeForKey(segment.inlineMarkup || segment.text);
  const body = `${scope}\u0000${segment.kind}\u0000${text}`;
  return `${scope}.${cyrb53(body).toString(36)}.${cyrb53(body, 1).toString(36)}`;
}

// ---- IndexedDB ---------------------------------------------------------------------------------

interface SegmentRow extends CachedSegment {
  key: string;
  bytes: number;
  used: number;
}
interface BriefRow {
  key: string;
  brief: DocumentBrief;
  used: number;
}
interface MetaRow {
  key: 'segments';
  bytes: number;
  entries: number;
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

export const rowBytes = (key: string, text: string) => 2 * (key.length + text.length) + 64;

export interface IdbCacheOptions {
  /** Default: the global `indexedDB`. */
  factory?: IDBFactory;
  name?: string;
  maxBytes?: number;
  now?: () => number;
}

/** The IndexedDB cache, or undefined where the browser has none (a job then simply runs uncached). */
export function openTranslationCache(options: IdbCacheOptions = {}): TranslationCache | undefined {
  const factory = options.factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
  if (!factory) return undefined;
  const maxBytes = options.maxBytes ?? CACHE_MAX_BYTES;
  const now = options.now ?? Date.now;
  let opening: Promise<IDBDatabase> | undefined;
  const db = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open(options.name ?? CACHE_DB, 1);
      open.onupgradeneeded = () => {
        const d = open.result;
        d.createObjectStore('segments', { keyPath: 'key' }).createIndex('used', 'used');
        d.createObjectStore('briefs', { keyPath: 'key' }).createIndex('used', 'used');
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
        reject(new DOMException('the cache database is blocked', 'InvalidStateError'));
      };
      open.onerror = () => {
        opening = undefined;
        reject(open.error);
      };
    }));

  const readMeta = async (meta: IDBObjectStore): Promise<MetaRow> => ((await req(meta.get('segments'))) as MetaRow | undefined) ?? { key: 'segments', bytes: 0, entries: 0 };

  return {
    async getMany(keys) {
      const found = new Map<string, CachedSegment>();
      if (keys.length === 0) return found;
      const tx = (await db()).transaction('segments', 'readwrite');
      const store = tx.objectStore('segments');
      const stamp = now();
      await Promise.all(
        keys.map(async (key) => {
          const row = (await req(store.get(key))) as SegmentRow | undefined;
          if (!row) return;
          found.set(key, { text: row.text, revision: row.revision, attempt: row.attempt });
          store.put({ ...row, used: stamp });
        }),
      );
      await done(tx);
      return found;
    },

    async putMany(entries, { replace = false } = {}) {
      if (entries.size === 0) return;
      const tx = (await db()).transaction(['segments', 'meta'], 'readwrite');
      const store = tx.objectStore('segments');
      const metaStore = tx.objectStore('meta');
      const meta = await readMeta(metaStore);
      const stamp = now();
      for (const [key, e] of entries) {
        const old = (await req(store.get(key))) as SegmentRow | undefined;
        // §5.2: a higher revision always wins; for the same revision a higher attempt does.
        if (!replace && old && (old.revision > e.revision || (old.revision === e.revision && old.attempt > e.attempt))) continue;
        const bytes = rowBytes(key, e.text);
        store.put({ key, text: e.text, revision: e.revision, attempt: e.attempt, bytes, used: stamp } satisfies SegmentRow);
        meta.bytes += bytes - (old?.bytes ?? 0);
        if (!old) meta.entries++;
      }
      // LRU: the least recently used go first until the rest fits.
      if (meta.bytes > maxBytes) {
        const cursor = store.index('used').openCursor();
        await new Promise<void>((resolve, reject) => {
          cursor.onerror = () => reject(cursor.error);
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (!c || meta.bytes <= maxBytes) return resolve();
            const row = c.value as SegmentRow;
            meta.bytes -= row.bytes;
            meta.entries--;
            c.delete();
            c.continue();
          };
        });
      }
      metaStore.put(meta);
      await done(tx);
    },

    async delete(keys) {
      if (keys.length === 0) return;
      const tx = (await db()).transaction(['segments', 'meta'], 'readwrite');
      const store = tx.objectStore('segments');
      const metaStore = tx.objectStore('meta');
      const meta = await readMeta(metaStore);
      for (const key of keys) {
        const old = (await req(store.get(key))) as SegmentRow | undefined;
        if (!old) continue;
        store.delete(key);
        meta.bytes -= old.bytes;
        meta.entries--;
      }
      metaStore.put(meta);
      await done(tx);
    },

    async getBrief(key) {
      const tx = (await db()).transaction('briefs', 'readwrite');
      const store = tx.objectStore('briefs');
      const row = (await req(store.get(key))) as BriefRow | undefined;
      if (row) store.put({ ...row, used: now() });
      await done(tx);
      return row?.brief;
    },

    async putBrief(key, brief) {
      const tx = (await db()).transaction('briefs', 'readwrite');
      const store = tx.objectStore('briefs');
      store.put({ key, brief, used: now() } satisfies BriefRow);
      const count = await req(store.count());
      if (count > BRIEF_MAX_ENTRIES) {
        let extra = count - BRIEF_MAX_ENTRIES;
        const cursor = store.index('used').openCursor();
        await new Promise<void>((resolve, reject) => {
          cursor.onerror = () => reject(cursor.error);
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (!c || extra <= 0) return resolve();
            extra--;
            c.delete();
            c.continue();
          };
        });
      }
      await done(tx);
    },

    async stats() {
      const tx = (await db()).transaction(['meta', 'briefs'], 'readonly');
      const meta = await readMeta(tx.objectStore('meta'));
      const briefs = await req(tx.objectStore('briefs').count());
      await done(tx);
      return { entries: meta.entries, bytes: meta.bytes, briefs, maxBytes };
    },

    async clear() {
      const tx = (await db()).transaction(['segments', 'briefs', 'meta'], 'readwrite');
      tx.objectStore('segments').clear();
      tx.objectStore('briefs').clear();
      tx.objectStore('meta').clear();
      await done(tx);
    },
  };
}
