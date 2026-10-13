// Which paid features this device may use. One call site per feature id, in the code that owns
// the feature; sync code reads the answer its job stored at start and never calls this.
// Every feature is available for now; the answer must stay cheap (cached state, no network),
// because it is awaited on the path to a job's first request.

export type FeatureId = 'best-mode' | 'translation-memory';

export function featureAvailable(id: FeatureId): Promise<boolean> {
  // Nothing is gated yet: every id answers true.
  void id;
  return Promise.resolve(true);
}
