// Latency harness (plan M3 §3 #1, #2): see scripts/eval/latency.ts. Run: pnpm run latency -- [options]
import { runBundled } from './eval/bundle.mjs';

await runBundled('scripts/eval/latency.ts');
