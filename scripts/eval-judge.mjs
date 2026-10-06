// Eval judge (plan M2-E8). Run: pnpm run eval:judge -- <run-dir> …
import { runBundled } from './eval/bundle.mjs';

await runBundled('scripts/eval/judge.ts');
