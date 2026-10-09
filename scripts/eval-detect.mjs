// Auto-detect against a live gateway (M4-F): see scripts/eval/detect.ts. Run: pnpm run eval:detect -- [options]
import { runBundled } from './eval/bundle.mjs';

await runBundled('scripts/eval/detect.ts');
