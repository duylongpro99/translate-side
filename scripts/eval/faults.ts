// Fault-injection harness (plan M3 §3 #4, #6; M3-E8): the panel's own Jobs over a short page, against
// the live default profile (APIBOX, key from .env), with a fault wrapped round the real client.
// Scenarios:
// - `network`: after the first chunk's text has arrived the network "drops" (every later request fails
//   with a network error). Reports: the job stops, what was translated stays, then the network is back
//   and Retry (resume) sends only the missing segments (compared with what was requested).
// - `ratelimit`: the first request of each chunk gets a 429 with Retry-After 2 s (injected). Reports the
//   backoff entries seen per chunk (JobView.backoff), that they clear, and that the page completes.
// - `segment`: one chunk's requests fail with a plain error (injected), so its segments fail; Retry on one
//   of them (Jobs.retrySegment) sends that one segment only, through the live model.
// - `badkey`: a wrong key (the real 401 from the provider, not injected). Reports a stopped job with
//   an auth error, the connection for "Fix key", and the request count (no other route is tried).
// Run: pnpm run faults -- [--scenarios network,ratelimit,segment,badkey] [--words 700]
// Results go to eval-results/faults-<stamp>.json (gitignored). The key is never printed.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createClient } from '@/llm';
import type { LLMClient, NormalizedEvent, NormalizedRequest } from '@/llm/types';
import type { Segment } from '@/engine/index';
import { Jobs, type JobDoc, type JobView } from '@/entrypoints/sidepanel/jobs';
import { DEFAULT_CONNECTION, DEFAULT_PROFILE, withProfileQuirks } from '@/shared/settings';

const ROOT = path.resolve(process.cwd());
const { values: opt } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    scenarios: { type: 'string', default: 'network,ratelimit,segment,badkey' },
    words: { type: 'string', default: '700' },
    docs: { type: 'string', default: 'goblog-pipelines,docusaurus-code-blocks,mdn-promise-then' },
  },
});

if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));
const key = process.env.AIBOX_API_KEY;
if (!key) throw new Error('AIBOX_API_KEY is not set (.env or the environment)');

const wordsOf = (s: Segment) => (s.translate ? s.text.split(/\s+/).filter(Boolean).length : 0);
function page(): Segment[] {
  const out: Segment[] = [];
  let words = 0;
  for (const slug of (opt.docs as string).split(',')) {
    const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/docs', `${slug}.json`), 'utf8')) as { segments: Segment[] };
    for (const s of doc.segments) {
      if (words >= Number(opt.words)) return out;
      out.push({ ...s, id: `${slug}:${s.id}` });
      words += wordsOf(s);
    }
  }
  return out;
}

const connect = (apiKey: string) => createClient(withProfileQuirks({ id: DEFAULT_CONNECTION.id, protocol: DEFAULT_CONNECTION.protocol, baseUrl: DEFAULT_CONNECTION.baseUrl, auth: DEFAULT_CONNECTION.auth, quirks: DEFAULT_CONNECTION.quirks, apiKey, hasHostPermission: async () => true }, DEFAULT_PROFILE), DEFAULT_PROFILE.model);

/** Every `<seg>` source line of a request, and its chunk; the brief call has none. */
const sourcesOf = (req: NormalizedRequest) => [...(req.messages.find((m) => m.role === 'user')?.content ?? '').matchAll(/^<seg id="\d+"(?: n="[a-z0-9]{4}")?>([\s\S]*?)<\/seg>$/gm)].map((m) => m[1] as string);

interface Fault {
  /** Decide per request: an event to answer with instead of calling the provider, or undefined to pass it through. */
  inject(req: NormalizedRequest, state: { requests: number; finalsSeen: number }): NormalizedEvent | undefined;
}

function faulty(inner: LLMClient, fault: Fault, log: { chunk?: number; sources: string[]; injected: boolean }[], state: { requests: number; finalsSeen: number }): LLMClient {
  return {
    model: inner.model,
    reasoningReserveTokens: (req) => inner.reasoningReserveTokens(req),
    async *stream(req: NormalizedRequest) {
      state.requests++;
      const injected = fault.inject(req, state);
      log.push({ ...(req.chunkIndex === undefined ? {} : { chunk: req.chunkIndex }), sources: sourcesOf(req), injected: injected !== undefined });
      if (injected) {
        await new Promise((r) => setTimeout(r, 20));
        yield injected;
        return;
      }
      yield* inner.stream(req);
    },
  };
}

const doc = (segments: Segment[]): JobDoc => ({ url: 'https://example.com/faults', title: 'Faults', sourceLang: 'en', targetLang: 'vi', segments });
const view = (jobs: Jobs) => jobs.get(1) as JobView;
const connection = { id: DEFAULT_CONNECTION.id, label: DEFAULT_CONNECTION.label };

function newJobs(client: LLMClient, sleep?: (ms: number, signal: AbortSignal) => Promise<void>) {
  const jobs = new Jobs({ translateClient: async () => ({ ok: true, client, profile: DEFAULT_PROFILE, connection }), ...(sleep ? { sleep } : {}) });
  jobs.setActive(1);
  return jobs;
}

const segments = page();
const translatable = segments.filter((s) => s.translate);
const results: Record<string, unknown>[] = [];
const report = (name: string, ok: boolean, detail: Record<string, unknown>) => {
  results.push({ scenario: name, ok, ...detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(10)} ${JSON.stringify(detail)}`);
};

async function network() {
  const log: { chunk?: number; sources: string[]; injected: boolean }[] = [];
  const state = { requests: 0, finalsSeen: 0 };
  let online = true;
  const client = faulty(connect(key as string), { inject: () => (online ? undefined : { type: 'error', error: { kind: 'network', message: 'Failed to fetch (injected)' } }) }, log, state);
  const jobs = newJobs(client, () => Promise.resolve());
  const cut = jobs.subscribe((_, v) => {
    if (v && v.counts.final > 0 && v.status === 'running') online = false;
  });
  await jobs.start(1, 'doc', doc(segments));
  cut();
  const stopped = view(jobs);
  const finals = new Map([...stopped.segs].filter(([, s]) => s.status === 'final').map(([id, s]) => [id, s.text]));
  online = true;
  const before = log.length;
  await jobs.resume(1);
  const done = view(jobs);
  const resent = new Set(log.slice(before).flatMap((l) => l.sources));
  const finalSources = translatable.filter((s) => finals.has(s.id)).map((s) => s.inlineMarkup);
  const unchanged = [...finals].every(([id, text]) => done.segs.get(id)?.text === text);
  report('network', stopped.status === 'stopped' && stopped.stopError?.kind === 'network' && finals.size > 0 && finals.size < translatable.length && done.status === 'done' && done.counts.final === translatable.length && unchanged && finalSources.every((t) => !resent.has(t)), {
    translatable: translatable.length,
    afterDrop: { status: stopped.status, error: stopped.stopError?.kind, final: finals.size },
    afterRetry: { status: done.status, final: done.counts.final, failed: done.counts.failed },
    retryRequestedSegments: resent.size,
    finalsResent: finalSources.filter((t) => resent.has(t)).length,
    finalsUnchanged: unchanged,
  });
}

async function ratelimit() {
  const log: { chunk?: number; sources: string[]; injected: boolean }[] = [];
  const state = { requests: 0, finalsSeen: 0 };
  const limited = new Set<number>();
  const client = faulty(connect(key as string), { inject: (req) => (req.chunkIndex !== undefined && !limited.has(req.chunkIndex) && limited.add(req.chunkIndex) ? { type: 'error', error: { kind: 'rate_limit', status: 429, message: 'slow down (injected)', retryAfterMs: 2000 } } : undefined) }, log, state);
  // The engine's real timers: Retry-After 2 s is really waited.
  const jobs = newJobs(client);
  const seen = new Map<number, { kind: string; until?: number; attempt: number }>();
  let clearedWhileRunning = false;
  jobs.subscribe((_, v) => {
    for (const b of v?.backoff ?? []) seen.set(b.chunk, { kind: b.kind, ...(b.until === undefined ? {} : { until: b.until }), attempt: b.attempt });
    if (seen.size > 0 && v?.status === 'running' && (v.backoff?.length ?? 0) === 0) clearedWhileRunning = true;
  });
  const t0 = Date.now();
  await jobs.start(1, 'doc', doc(segments));
  const v = view(jobs);
  report('ratelimit', v.status === 'done' && v.counts.final === translatable.length && seen.size >= 1 && (v.backoff ?? []).length === 0, {
    status: v.status,
    final: v.counts.final,
    chunksSeenBackingOff: [...seen.keys()],
    withRetryAfter: [...seen.values()].filter((b) => b.until !== undefined).length,
    clearedWhileRunning,
    ms: Date.now() - t0,
  });
}

async function segment() {
  const log: { chunk?: number; sources: string[]; injected: boolean }[] = [];
  const state = { requests: 0, finalsSeen: 0 };
  let broken = true;
  // Chunk 0's requests fail with a plain error (neither retried nor stopping the job); the rest are real.
  const client = faulty(connect(key as string), { inject: (req) => (broken && req.chunkIndex === 0 ? { type: 'error', error: { kind: 'unknown', message: 'injected failure' } } : undefined) }, log, state);
  const jobs = newJobs(client, () => Promise.resolve());
  await jobs.start(1, 'doc', doc(segments));
  const failedIds = [...view(jobs).segs].filter(([, s]) => s.status === 'failed').map(([id]) => id);
  broken = false;
  const target = failedIds[0];
  const before = log.length;
  if (target) await jobs.retrySegment(1, target);
  const v = view(jobs);
  const asked = log.slice(before).flatMap((l) => l.sources);
  const targetText = translatable.find((s) => s.id === target)?.inlineMarkup;
  report('segment', failedIds.length > 0 && v.segs.get(target as string)?.status === 'final' && asked.length === 1 && asked[0] === targetText && v.counts.failed === failedIds.length - 1, {
    failedAfterRun: failedIds.length,
    retried: target,
    requestedForRetry: asked.length,
    retried_status: v.segs.get(target as string)?.status,
    failedNow: v.counts.failed,
    jobStatus: v.status,
  });
}

async function badkey() {
  const log: { chunk?: number; sources: string[]; injected: boolean }[] = [];
  const state = { requests: 0, finalsSeen: 0 };
  let resolved = 0;
  const client = faulty(connect('sk-not-a-real-key'), { inject: () => undefined }, log, state);
  const jobs = new Jobs({ translateClient: async () => (resolved++, { ok: true as const, client, profile: DEFAULT_PROFILE, connection }) });
  jobs.setActive(1);
  await jobs.start(1, 'doc', doc(segments));
  const v = view(jobs);
  report('badkey', v.status === 'stopped' && v.stopError?.kind === 'auth' && v.connection?.id === connection.id && resolved === 1 && state.requests <= DEFAULT_PROFILE.maxConcurrency + 1, {
    status: v.status,
    error: v.stopError?.kind,
    connection: v.connection?.label,
    requests: state.requests,
    clientResolutions: resolved,
  });
}

const scenarios: Record<string, () => Promise<void>> = { network, ratelimit, segment, badkey };
console.log(`page: ${segments.length} segments, ${translatable.length} translatable; profile ${DEFAULT_PROFILE.id} (c${DEFAULT_PROFILE.chunkTokens}, ×${DEFAULT_PROFILE.maxConcurrency})`);
for (const name of (opt.scenarios as string).split(',')) {
  const run = scenarios[name];
  if (!run) throw new Error(`unknown scenario ${name}`);
  await run();
}
const out = path.join(ROOT, 'eval-results', `faults-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ segments: segments.length, profile: DEFAULT_PROFILE.id, results }, null, 2));
console.log(`written ${path.relative(ROOT, out)}`);
if (results.some((r) => !r.ok)) process.exitCode = 1;
