// The harness's `--memory <file>`: a translation-memory export (the extension's own file, or one
// written by hand in the same shape) read as the examples of a run. Only entries of the run's target
// language count. Ids are hashes of the source (the harness has no panel to share its key scheme
// with): the run's logs carry them in place of text.
import type { MemoryExample } from '@/engine/index';
import { hashId } from '@/segment/hash';

export const MEMORY_FILE_FORMAT = 'translate-side-memory';
/** The extension's own cap on a memory. */
export const MEMORY_FILE_MAX = 5000;

export function parseMemoryFile(text: string, targetLang: string): MemoryExample[] {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error('--memory: the file is not JSON');
  }
  const file = root as { format?: unknown; entries?: unknown } | null;
  if (file?.format !== MEMORY_FILE_FORMAT || !Array.isArray(file.entries)) throw new Error(`--memory: not a ${MEMORY_FILE_FORMAT} file`);
  const out: MemoryExample[] = [];
  for (const raw of file.entries.slice(0, MEMORY_FILE_MAX) as unknown[]) {
    const e = raw as { source?: unknown; target?: unknown; targetLang?: unknown } | null;
    if (typeof e?.source !== 'string' || typeof e.target !== 'string' || e.source.trim() === '' || e.target.trim() === '') continue;
    if (typeof e.targetLang !== 'string' || e.targetLang.toLowerCase() !== targetLang.toLowerCase()) continue;
    out.push({ id: `m.${hashId(e.source)}`, source: e.source, target: e.target });
  }
  return out;
}
