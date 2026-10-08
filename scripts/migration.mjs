// Migration harness (plan M4 §3 #7): see scripts/eval/migration.ts. Run: pnpm run migration
import { runBundled } from './eval/bundle.mjs';

await runBundled('scripts/eval/migration.ts');
