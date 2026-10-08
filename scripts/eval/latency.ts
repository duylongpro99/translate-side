// Latency harness (plan M3 §3 #1, #2, §8 risk): runs the panel's own Jobs (src/entrypoints/sidepanel/
// jobs.ts) over a ~3,000-word page made of fixtures, against the live default profile, with one
// screen of segments reported as on screen, the way the content script does (M3-E1). It reports:
// - screen: when every segment on screen at the start was final (JobView.screenDoneAt), §3 #1;
// - whole: when the whole page was done (endedAt), §3 #2;
// - brief: the analyze call's start and end, and when the first translate call started and gave its
//   first text, so the §8 risk (the brief delaying the first viewport chunk) is measured, not guessed.
// Scenarios: `top` (the screen is the start of the page), `middle` (half way down), and
// `middle-old` (the same screen not reported: the job runs in page order, as before M3).
// Scenario `revisit` (plan M3-E2, §3 #3): the page is translated once into the translation cache
// (fake-indexeddb here), then opened again in a new Jobs; it reports the second open's request count
// (must be 0) and its screen / whole-page render time.
// Run: pnpm run latency -- [--runs 2] [--scenarios top,middle,middle-old] [--words 3000] [--screen-words 250]
// Key: AIBOX_API_KEY from .env (the default profile's connection, M2-D11/D16). Results go to
// eval-results/latency-<stamp>.json (gitignored).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { IDBFactory } from 'fake-indexeddb';
import { createClient } from '@/llm';
import type { LLMClient, NormalizedRequest } from '@/llm/types';
import type { Segment } from '@/engine/index';
import { openTranslationCache, type TranslationCache } from '@/shared/cache';
import { Jobs, type JobDoc, type JobView } from '@/entrypoints/sidepanel/jobs';
import { DEFAULT_CONNECTION, DEFAULT_PROFILE, withProfileQuirks } from '@/shared/settings';

const ROOT = path.resolve(process.cwd());
const { values: opt } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    runs: { type: 'string', default: '2' },
    scenarios: { type: 'string', default: 'top,middle,middle-old' },
    words: { type: 'string', default: '3000' },
    'screen-words': { type: 'string', default: '250' },
    docs: { type: 'string', default: 'goblog-pipelines,docusaurus-code-blocks,mdn-promise-then' },
  },
});

if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));
const key = process.env.AIBOX_API_KEY;
if (!key) throw new Error('AIBOX_API_KEY is not set (.env or the environment)');

const wordsOf = (s: Segment) => (s.translate ? s.text.split(/\s+/).filter(Boolean).length : 0);

/** The fixtures joined into one page of about `--words` translatable words. */
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

/** One screen: the segments from `from` on, up to `--screen-words` words. */
function screenAt(segments: Segment[], from: number): string[] {
  const ids: string[] = [];
  let words = 0;
  for (let i = from; i < segments.length && words < Number(opt['screen-words']); i++) {
    const s = segments[i] as Segment;
    ids.push(s.id);
    words += wordsOf(s);
  }
  return ids;
}

interface Call {
  kind: 'brief' | 'translate';
  chunkIndex?: number;
  start: number;
  firstText?: number;
  end?: number;
  error?: string;
}

/** Records each call's timing; the brief call is the one whose user message is the `<document>`. */
function timed(inner: LLMClient, calls: Call[], t0: () => number): LLMClient {
  return {
    model: inner.model,
    reasoningReserveTokens: (req) => inner.reasoningReserveTokens(req),
    async *stream(req: NormalizedRequest) {
      const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
      const call: Call = { kind: user.startsWith('<document>') ? 'brief' : 'translate', ...(req.chunkIndex === undefined ? {} : { chunkIndex: req.chunkIndex }), start: t0() };
      calls.push(call);
      try {
        for await (const e of inner.stream(req)) {
          if (e.type === 'text' && call.firstText === undefined) call.firstText = t0();
          if (e.type === 'error') call.error = e.error.message;
          yield e;
        }
      } finally {
        call.end = t0();
      }
    },
  };
}

async function runOnce(scenario: string, segments: Segment[], cache?: TranslationCache) {
  const conn = withProfileQuirks({ id: DEFAULT_CONNECTION.id, protocol: DEFAULT_CONNECTION.protocol, baseUrl: DEFAULT_CONNECTION.baseUrl, auth: DEFAULT_CONNECTION.auth, quirks: DEFAULT_CONNECTION.quirks, apiKey: key as string, hasHostPermission: async () => true }, DEFAULT_PROFILE);
  const calls: Call[] = [];
  let started = 0;
  const t0 = () => Date.now() - started;
  const client = timed(createClient(conn, DEFAULT_PROFILE.model), calls, t0);
  const jobs = new Jobs({ translateClient: async () => ({ ok: true, client, profile: DEFAULT_PROFILE }), cache });
  jobs.setActive(1);
  const translatable = segments.filter((s) => s.translate);
  const middle = segments.indexOf(translatable[Math.floor(translatable.length / 2)] as Segment);
  const screen = screenAt(segments, scenario === 'top' || scenario === 'revisit' ? 0 : middle);
  // `middle-old`: nothing reported, page order (pre-M3); its screen is still timed below.
  if (scenario !== 'middle-old') jobs.setViewport(1, 'doc', screen);
  const todo = new Set(screen.filter((id) => segments.find((s) => s.id === id)?.translate));
  let screenDone: number | undefined;
  let firstScreenText: number | undefined;
  jobs.subscribe((_, v) => {
    if (!v) return;
    if (firstScreenText === undefined && [...todo].some((id) => v.segs.get(id)?.text)) firstScreenText = t0();
    if (screenDone === undefined && [...todo].every((id) => ['final', 'failed'].includes(v.segs.get(id)?.status ?? ''))) screenDone = t0();
  });
  const doc: JobDoc = { url: 'https://example.com/latency', title: 'Latency', sourceLang: 'en', targetLang: 'vi', segments };
  started = Date.now();
  await jobs.start(1, 'doc', doc);
  const v = jobs.get(1) as JobView;
  const brief = calls.find((c) => c.kind === 'brief');
  const firstTranslate = calls.find((c) => c.kind === 'translate');
  return {
    scenario,
    status: v.status,
    counts: v.counts,
    screenSegments: todo.size,
    firstVisibleMs: v.firstVisibleAt === undefined ? null : v.firstVisibleAt - v.startedAt,
    firstScreenTextMs: firstScreenText ?? null,
    screenDoneMs: screenDone ?? null,
    wholeMs: v.endedAt === undefined ? null : v.endedAt - v.startedAt,
    brief: brief ? { startMs: brief.start, endMs: brief.end ?? null } : null,
    firstTranslate: firstTranslate ? { startMs: firstTranslate.start, firstTextMs: firstTranslate.firstText ?? null, endMs: firstTranslate.end ?? null, chunkIndex: firstTranslate.chunkIndex ?? null } : null,
    calls: calls.map((c) => ({ ...c })),
    cached: v.cached ?? 0,
    requests: calls.length,
    usd: v.cost ?? null,
  };
}

const segments = page();
const words = segments.reduce((n, s) => n + wordsOf(s), 0);
console.log(`page: ${segments.length} segments, ${words} words; profile ${DEFAULT_PROFILE.id} (c${DEFAULT_PROFILE.chunkTokens}, ×${DEFAULT_PROFILE.maxConcurrency})`);
const results = [];
for (let r = 0; r < Number(opt.runs); r++) {
  for (const scenario of (opt.scenarios as string).split(',')) {
    let res;
    if (scenario === 'revisit') {
      // Cold open fills the cache; the revisit is a new Jobs (a new panel) over the same cache.
      const cache = openTranslationCache({ factory: new IDBFactory() });
      const cold = await runOnce('top', segments, cache);
      await new Promise((r) => setTimeout(r, 200));
      res = { ...(await runOnce('revisit', segments, cache)), coldWholeMs: cold.wholeMs, coldRequests: cold.requests };
      console.log(`revisit    cold: ${cold.requests} requests, whole ${((cold.wholeMs ?? 0) / 1000).toFixed(1)}s, $${cold.usd?.toFixed(4)}`);
    } else res = await runOnce(scenario, segments);
    results.push(res);
    const s = (ms: number | null | undefined) => (ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)}s`);
    console.log(
      `${scenario.padEnd(10)} run ${r + 1}: screen ${s(res.screenDoneMs)} (first text ${s(res.firstScreenTextMs)}, ${res.screenSegments} segs) · whole ${s(res.wholeMs)} · ` +
        `brief ${s(res.brief?.startMs)}→${s(res.brief?.endMs)} · first translate call chunk ${res.firstTranslate?.chunkIndex ?? '?'} at ${s(res.firstTranslate?.startMs)}, first text ${s(res.firstTranslate?.firstTextMs)}, end ${s(res.firstTranslate?.endMs)} · ${res.status} ${res.counts.final}/${res.counts.total}`,
    );
  }
}
const out = path.join(ROOT, 'eval-results', `latency-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ words, segments: segments.length, profile: DEFAULT_PROFILE.id, results }, null, 2));
console.log(`written ${path.relative(ROOT, out)}`);
