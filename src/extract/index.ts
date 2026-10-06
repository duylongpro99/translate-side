// Page extraction (plan M0-E5). Placeholder until the walk and Readability fallback land.
import type { ExtractResult } from '@/shared/protocol';

export function extractPage(doc: Document): ExtractResult {
  return { ok: false, reason: 'no-content', url: doc.URL };
}
