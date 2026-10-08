// Migration harness (plan M4 §3 #7, M4-E2): storage shaped as M1 (Gemini key) and M2/M3 (APIBOX key)
// left it, in an in-memory chrome.storage; the M4 migration; then the panel's own route
// (src/entrypoints/sidepanel/route.ts) and Jobs translate a short page through the live provider the
// migrated routing names. Keys from .env (AIBOX_API_KEY, GEMINI_API_KEY); never printed.
// Run: pnpm run migration -- [--scenarios m3,m1] [--words 80]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { Segment } from '@/engine/index';
import { Jobs, type JobView } from '@/entrypoints/sidepanel/jobs';
import { translateClient } from '@/entrypoints/sidepanel/route';
import { migrateProviders } from '@/shared/providers';

const ROOT = path.resolve(process.cwd());
const { values: opt } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { scenarios: { type: 'string', default: 'm3,m1' }, words: { type: 'string', default: '80' }, doc: { type: 'string', default: 'goblog-pipelines' } },
});
if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));

function area(initial: Record<string, unknown>) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: async (keys: string | string[] | null) =>
      keys === null ? Object.fromEntries(data) : Object.fromEntries((typeof keys === 'string' ? [keys] : keys).filter((k) => data.has(k)).map((k) => [k, data.get(k)])),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([k, v]) => data.set(k, structuredClone(v))),
    remove: async (keys: string | string[]) => void (typeof keys === 'string' ? [keys] : keys).forEach((k) => data.delete(k)),
  };
}

function page(): Segment[] {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/docs', `${opt.doc as string}.json`), 'utf8')) as { segments: Segment[] };
  const out: Segment[] = [];
  let words = 0;
  for (const s of doc.segments) {
    if (words >= Number(opt.words)) break;
    out.push(s);
    if (s.translate) words += s.text.split(/\s+/).filter(Boolean).length;
  }
  return out;
}

const SCENARIOS: Record<string, { env: string; sync: Record<string, unknown>; local: (key: string) => Record<string, unknown>; expect: { connection: string; model: string } }> = {
  // M2/M3: prefs with style/budget in sync, the APIBOX key in local (M2-D11).
  m3: {
    env: 'AIBOX_API_KEY',
    sync: { prefs: { targetLang: 'vi', sourceLang: 'auto', style: 'natural', gloss: 'first', budgetTokens: 400000 }, glossary: [] },
    local: (key) => ({ 'secret:apibox': key, privacyNotice: { version: 1, at: 1 } }),
    expect: { connection: 'apibox', model: 'qwen3.8-flash' },
  },
  // M1: prefs in sync, the Gemini key in local (M1-D13).
  m1: {
    env: 'GEMINI_API_KEY',
    sync: { prefs: { targetLang: 'vi', sourceLang: 'auto' } },
    local: (key) => ({ 'secret:gemini': key }),
    expect: { connection: 'gemini', model: 'gemini-3.5-flash-lite' },
  },
};

const segments = page();
const translatable = segments.filter((s) => s.translate).length;
let failed = false;
for (const name of (opt.scenarios as string).split(',')) {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error(`unknown scenario ${name}`);
  const key = process.env[sc.env];
  if (!key) {
    console.log(`SKIP ${name}: ${sc.env} is not set`);
    continue;
  }
  const sync = area(structuredClone(sc.sync));
  const local = area(sc.local(key));
  const api = { storage: { sync, local, session: area({}) }, permissions: { contains: async () => true } } as unknown as Parameters<typeof migrateProviders>[0];
  const before = [...sync.data.keys()].sort();
  const migrated = await migrateProviders(api);
  const after = [...sync.data.keys()].sort();
  const keyKept = local.data.get(`secret:${sc.expect.connection}`) === key && !JSON.stringify(Object.fromEntries(sync.data)).includes(key);
  const jobs = new Jobs({ translateClient: (t) => translateClient(api, t) });
  jobs.setActive(1);
  const t0 = Date.now();
  await jobs.start(1, 'doc', { url: 'https://example.com/migration', title: 'Migration', sourceLang: 'en', targetLang: 'vi', segments });
  const v = jobs.get(1) as JobView;
  const sample = [...v.segs.values()].find((s) => s.status === 'final' && (s.text?.length ?? 0) > 60)?.text?.slice(0, 100);
  const ok = keyKept && v.status === 'done' && v.counts.final === translatable && v.connection?.id === sc.expect.connection && v.model === sc.expect.model && migrated.routing.translate !== '';
  failed ||= !ok;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${name}`,
    JSON.stringify({ syncBefore: before, syncAfter: after, routing: migrated.routing, connection: v.connection, model: v.model, status: v.status, final: v.counts.final, translatable, keyKeptInLocalOnly: keyKept, ms: Date.now() - t0, stopError: v.stopError?.message, sample }),
  );
}
if (failed) process.exitCode = 1;
