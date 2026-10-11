// `explain` (plan M5-E8): the ad-hoc strategy behind a block's "Explain this". One stage, no cache
// key: a note is never stored (DESIGN §7 caches translations only), so it has no cache version.
import { defineStrategy } from '../runner.ts';
import { explainStage } from '../stages/explain.ts';

export const EXPLAIN_ID = 'explain';
export const EXPLAIN_VERSION = 1;

export const explain = defineStrategy({ id: EXPLAIN_ID, version: EXPLAIN_VERSION, stages: [explainStage] });
