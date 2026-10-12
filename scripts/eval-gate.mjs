// Eval regression gate (eval/README.md). Run: pnpm run eval:gate [-- --baseline 5] [--timeout-min n]
import { runBundled } from './eval/bundle.mjs';

const { main } = await runBundled('scripts/eval/gate.ts');
process.exitCode = await main(process.argv.slice(2));
