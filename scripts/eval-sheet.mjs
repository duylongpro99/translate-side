// Eval sheet (plan M2-E8). Run: pnpm run eval:sheet -- <run-dir> …
import { runBundled } from './eval/bundle.mjs';

await runBundled('scripts/eval/sheet.ts');
