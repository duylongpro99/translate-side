// Node eval harness (plan M1-E11): runs the engine over fixtures/docs. Run: pnpm run eval -- [options]
import { runBundled } from './eval/bundle.mjs';

await runBundled('scripts/eval/run.ts');
