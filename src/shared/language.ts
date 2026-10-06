// Source-language detection (plan M2-E5, decision M2-D1): a shell port, not in engine/. The chain
// is the user's override, then Chrome's on-device `LanguageDetector` (DESIGN.md §2) on a text
// sample, then the page's `<html lang>`; when all of them are silent the job's sourceLang is ""
// and the brief's `language` fills it on the engine side (contextual, stages/analyze.ts).
//
// A page already in the target language is skipped before any model call (DESIGN.md §5.7 Step 0,
// plan M2 criterion 6). Mixed-language pages: per-segment detection is behind a flag, off by
// default (MIXED_LANGUAGE_DETECTION); when on, segments confidently in the target language are
// left as they are and the rest are translated, whatever the page language is.
import type { Segment } from '@/engine/types';

/** The Chrome LanguageDetector as this module uses it (a port, so tests pass a fake). */
export interface LanguageDetectorPort {
  /** Candidates, most likely first; Chrome's `detectedLanguage` is a BCP 47 tag or "und". */
  detect(text: string, signal?: AbortSignal): Promise<{ detectedLanguage: string; confidence: number }[]>;
}

export type DetectionSource = 'override' | 'detector' | 'html-lang' | 'unknown';

export interface Detection {
  /** BCP 47, or "" when unknown. */
  lang: string;
  via: DetectionSource;
  /** The detector's confidence, for `via: "detector"`. */
  confidence?: number;
}

/** Below this, the detector's answer is not trusted and the chain goes on. */
export const DETECTOR_MIN_CONFIDENCE = 0.6;
/** Characters of page text the page-level detection reads. */
export const SAMPLE_CHARS = 2000;
/** Per-segment detection skips shorter segments: too little text to tell. */
export const SEGMENT_MIN_CHARS = 24;
/** Feature flag (plan M2-E5): per-segment detection for mixed-language pages. Off by default. */
export const MIXED_LANGUAGE_DETECTION = false;
/** The detector must answer within this, or the chain goes on without it. */
export const DETECT_TIMEOUT_MS = 1500;

/** The text the page-level detection reads: translatable segments in page order, up to SAMPLE_CHARS. */
export function detectionSample(segments: readonly Segment[], maxChars = SAMPLE_CHARS): string {
  let out = '';
  for (const s of segments) {
    if (!s.translate || s.kind === 'code') continue;
    const text = s.text.trim();
    if (!text) continue;
    out = out ? `${out}\n${text}` : text;
    if (out.length >= maxChars) return out.slice(0, maxChars);
  }
  return out;
}

/** Normalizes a tag ("EN_us" → "en-US"); "" for empty, "und" or malformed. */
export function normalizeLang(tag: string | undefined): string {
  const t = (tag ?? '').trim().replace(/_/g, '-');
  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{1,8})*$/.test(t) || t.toLowerCase() === 'und') return '';
  try {
    return Intl.getCanonicalLocales(t)[0] ?? '';
  } catch {
    return '';
  }
}

const HANT_REGIONS = new Set(['TW', 'HK', 'MO']);

/** Chinese script: "Hant", "Hans", or undefined when the tag does not say. */
function chineseScript(tag: string): 'Hans' | 'Hant' | undefined {
  const parts = tag.split('-').slice(1);
  for (const p of parts) {
    if (/^hant$/i.test(p)) return 'Hant';
    if (/^hans$/i.test(p)) return 'Hans';
  }
  for (const p of parts) {
    if (HANT_REGIONS.has(p.toUpperCase())) return 'Hant';
    if (/^(CN|SG)$/i.test(p)) return 'Hans';
  }
  return undefined;
}

/**
 * Is a text in `source` already readable as `target`? Same primary language ("en-US" = "en",
 * "pt" = "pt-BR"), except Chinese, where the script must also match and an unknown script does
 * not count as the same (a Traditional reader may want a Simplified page translated). An unknown
 * source is never the same.
 */
export function sameLanguage(source: string, target: string): boolean {
  const a = normalizeLang(source);
  const b = normalizeLang(target);
  if (!a || !b) return false;
  const pa = a.split('-')[0]?.toLowerCase();
  const pb = b.split('-')[0]?.toLowerCase();
  if (pa !== pb) return false;
  if (pa !== 'zh') return true;
  const sa = chineseScript(a);
  return sa !== undefined && sa === chineseScript(b);
}

/** The detector's top answer if it is a language and confident enough; undefined otherwise or on any failure. */
async function detectTop(detector: LanguageDetectorPort | undefined, text: string, timeoutMs: number): Promise<{ lang: string; confidence: number } | undefined> {
  if (!detector || !text.trim()) return undefined;
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        ac.abort();
        resolve(undefined);
      }, timeoutMs);
    });
    const results = await Promise.race([detector.detect(text, ac.signal), timeout]);
    const top = results?.[0];
    if (!top) return undefined;
    const lang = normalizeLang(top.detectedLanguage);
    return lang && top.confidence >= DETECTOR_MIN_CONFIDENCE ? { lang, confidence: top.confidence } : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** The fallback chain: override → detector → `<html lang>` → unknown (the brief decides, engine side). */
export async function detectSourceLanguage(
  input: { override?: string | undefined; sample: string; pageLang?: string | undefined },
  detector: LanguageDetectorPort | undefined,
  timeoutMs = DETECT_TIMEOUT_MS,
): Promise<Detection> {
  const override = normalizeLang(input.override);
  if (override) return { lang: override, via: 'override' };
  const top = await detectTop(detector, input.sample, timeoutMs);
  if (top) return { lang: top.lang, via: 'detector', confidence: top.confidence };
  const html = normalizeLang(input.pageLang);
  if (html) return { lang: html, via: 'html-lang' };
  return { lang: '', via: 'unknown' };
}

/**
 * Per-segment detection (behind MIXED_LANGUAGE_DETECTION): ids of translatable segments the
 * detector confidently reads as `targetLang`. Short segments and failures count as "translate".
 */
export async function segmentsInLanguage(segments: readonly Segment[], targetLang: string, detector: LanguageDetectorPort | undefined, timeoutMs = DETECT_TIMEOUT_MS): Promise<Set<string>> {
  const out = new Set<string>();
  if (!detector) return out;
  for (const s of segments) {
    if (!s.translate || s.kind === 'code' || s.text.trim().length < SEGMENT_MIN_CHARS) continue;
    const top = await detectTop(detector, s.text, timeoutMs);
    if (top && sameLanguage(top.lang, targetLang)) out.add(s.id);
  }
  return out;
}

// ---- Chrome's LanguageDetector (Chrome 138+), behind the port --------------------------------

interface ChromeLanguageDetector {
  detect(text: string, opts?: { signal?: AbortSignal }): Promise<{ detectedLanguage: string; confidence: number }[]>;
}
interface ChromeLanguageDetectorStatic {
  availability(): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(opts?: { signal?: AbortSignal }): Promise<ChromeLanguageDetector>;
}

/**
 * The browser's detector, created once on first use; undefined when the API is missing or its
 * model is unavailable. A model that still has to be downloaded may need a user gesture to
 * create; if creating fails the port answers nothing and the chain moves on.
 */
export function chromeLanguageDetector(scope: object = globalThis): LanguageDetectorPort | undefined {
  const api = (scope as { LanguageDetector?: ChromeLanguageDetectorStatic }).LanguageDetector;
  if (api === undefined || typeof api.create !== 'function') return undefined;
  let instance: Promise<ChromeLanguageDetector | undefined> | undefined;
  const get = () =>
    (instance ??= api
      .availability()
      .then((a) => (a === 'unavailable' ? undefined : api.create()))
      .catch(() => {
        // Not created (e.g. the download needs a gesture): try again on the next page.
        instance = undefined;
        return undefined;
      }));
  return {
    async detect(text, signal) {
      const d = await get();
      if (d === undefined) return [];
      return d.detect(text, signal ? { signal } : undefined);
    },
  };
}
