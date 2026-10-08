// Fault-injection harness (plan M3 §3 #4, #6): see scripts/eval/faults.ts. Run: pnpm run faults -- [options]
import { runBundled } from './eval/bundle.mjs';

await runBundled('scripts/eval/faults.ts');
