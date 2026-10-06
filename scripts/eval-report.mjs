// Eval report (plan M2-E8). Run: pnpm run eval:report -- <run-dir> …
import { runBundled } from './eval/bundle.mjs';

await runBundled('scripts/eval/report.ts');
