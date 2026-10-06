// Fixture capture (plan M1-E11): extract each site fixture the way the content script does and
// write its Segment[] to fixtures/docs/<slug>.json. Run: pnpm run eval:capture [slug …]
import { runBundled } from './eval/bundle.mjs';

await runBundled('scripts/eval/capture.ts');
