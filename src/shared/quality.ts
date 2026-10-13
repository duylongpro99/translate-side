// The quality setting: Fast, Balanced (the default) or Best, an optional exact strategy that
// overrides the mode, and whether Best's refined text waits for its block to leave the screen.
// It is its own storage.sync item, never a field of `prefs`: a build that does not know it
// rewrites `prefs` from the fields it knows, and would erase a quality field kept there.
import type { browser } from 'wxt/browser';
import type { StrategyId } from '@/engine/types';

type Browser = typeof browser;

export const QUALITY_KEY = 'quality';

/**
 * Whether Best is offered at all. False: Best is listed nowhere (not even locked), `refine` is not
 * an override, and a job asked for `refine` runs `contextual` (Jobs.start).
 */
export const BEST_MODE_RELEASED = true;

export type QualityMode = 'fast' | 'balanced' | 'best';
export type QualityStrategy = 'single-pass' | 'contextual' | 'refine';

export interface Quality {
  mode: QualityMode;
  /** The advanced override: this strategy instead of the mode's. */
  strategy?: QualityStrategy | undefined;
  keepDraftsOnScreen: boolean;
}

export const QUALITY_MODES: readonly QualityMode[] = ['fast', 'balanced', 'best'];
export const MODE_STRATEGIES: Readonly<Record<QualityMode, QualityStrategy>> = { fast: 'single-pass', balanced: 'contextual', best: 'refine' };
export const QUALITY_STRATEGIES: readonly QualityStrategy[] = ['single-pass', 'contextual', 'refine'];

export const defaultQuality = (): Quality => ({ mode: 'balanced', keepDraftsOnScreen: false });

/** A stored or imported value, cleaned: an unknown mode is Balanced, an unknown strategy is none. */
export function cleanQuality(raw: unknown): Quality {
  const out = defaultQuality();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const { mode, strategy, keepDraftsOnScreen } = raw as Record<string, unknown>;
  if (QUALITY_MODES.includes(mode as QualityMode)) out.mode = mode as QualityMode;
  if (QUALITY_STRATEGIES.includes(strategy as QualityStrategy)) out.strategy = strategy as QualityStrategy;
  if (keepDraftsOnScreen === true) out.keepDraftsOnScreen = true;
  return out;
}

/** Whether `raw` carries at least one value this build understands (an import of nothing else is skipped). */
export function hasKnownQuality(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const { mode, strategy, keepDraftsOnScreen } = raw as Record<string, unknown>;
  return QUALITY_MODES.includes(mode as QualityMode) || QUALITY_STRATEGIES.includes(strategy as QualityStrategy) || typeof keepDraftsOnScreen === 'boolean';
}

/**
 * The strategy a job asks for: the override if set, else the mode's. Whether `refine` may run is
 * decided once when the job starts (Jobs.start); this never consults features.
 */
export const requestedStrategy = (q: Quality): StrategyId => q.strategy ?? MODE_STRATEGIES[q.mode];

export async function readQuality(api: Browser): Promise<Quality> {
  try {
    return cleanQuality((await api.storage.sync.get(QUALITY_KEY))[QUALITY_KEY]);
  } catch {
    return defaultQuality();
  }
}

let write: Promise<unknown> = Promise.resolve();

/**
 * Applies `patch` to the stored item. Updates run one after another, each on what the last one
 * wrote. The patch lands on the raw stored record, so fields and modes a newer build wrote (and
 * this one does not know) survive; only what the patch names is overwritten. A patch with
 * `strategy: undefined` clears the override. Returns the cleaned result.
 */
export function updateQuality(api: Browser, patch: Partial<Quality>): Promise<Quality> {
  const run = write.then(async () => {
    const stored = (await api.storage.sync.get(QUALITY_KEY))[QUALITY_KEY];
    const next: Record<string, unknown> = typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? { ...defaultQuality(), ...stored } : { ...defaultQuality() };
    if (patch.mode !== undefined && QUALITY_MODES.includes(patch.mode)) next.mode = patch.mode;
    if ('strategy' in patch) {
      if (patch.strategy !== undefined && QUALITY_STRATEGIES.includes(patch.strategy)) next.strategy = patch.strategy;
      else delete next.strategy;
    }
    if (patch.keepDraftsOnScreen !== undefined) next.keepDraftsOnScreen = patch.keepDraftsOnScreen;
    await api.storage.sync.set({ [QUALITY_KEY]: next });
    return cleanQuality(next);
  });
  write = run.catch(() => undefined);
  return run;
}
