// Node eval harness v0 (plan M1-E11, DESIGN.md §10): the same engine the extension runs, over the
// fixture documents in fixtures/docs, with a real model (or `--mock`). Writes one folder per run:
// <slug>.output.json (source + translation per segment), calls.jsonl (every request/response),
// summary.json and summary.md (tokens, wall time and cost per document, segment loss, repairs).
// Run: pnpm run eval -- [--provider gemini|anthropic] [--model id] [--docs a,b] [--mock]
//      [--set fixtures|eval] [--probe-nonce] [--chunk-tokens n] [--concurrency n] [--target vi] [--price in,cached,out]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createClient, GEMINI_OPENAI_BASE_URL } from '@/llm';
import type { LLMClient, ResolvedConnection, StopReason } from '@/llm/types';
import { chunkLimits, chunkSegments, MAX_TAG, MERGE_FACTOR, parseOutput, planRepair, createDefaultPromptRegistry, createEngine, formatWire, nonceFor, singlePass, toWire, renderSystemPrompt, translateRequest, TRANSLATE_PROMPT_ID, CHARS_PER_TOKEN, type EngineEvent, type Segment, type TranslationJob } from '@/engine/index';
import { costUsd, priceFor } from './pricing.ts';
import { EVAL_SLUGS } from './docs.ts';
import { listPassageIds, loadPassage } from './passages.ts';

const ROOT = path.resolve(process.cwd());
const DOCS = path.join(ROOT, 'fixtures/docs');

const { values: opt } = parseArgs({
  // pnpm passes a literal `--` through.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    provider: { type: 'string', default: 'gemini' },
    model: { type: 'string' },
    docs: { type: 'string' },
    // `eval`: the M2-E8 passages in eval/passages instead of fixtures/docs.
    set: { type: 'string', default: 'fixtures' },
    out: { type: 'string' },
    mock: { type: 'boolean', default: false },
    'probe-nonce': { type: 'boolean', default: false },
    'chunk-tokens': { type: 'string', default: '1500' },
    concurrency: { type: 'string', default: '2' },
    target: { type: 'string', default: 'vi' },
    price: { type: 'string' },
  },
});

interface FixtureDoc {
  slug: string;
  url: string;
  title: string;
  lang: string;
  segments: Segment[];
}

interface CallRecord {
  doc: string;
  n: number;
  ms: number;
  system: string;
  maxOutputTokens: number;
  user: string;
  text: string;
  usage?: { input: number; output: number; cachedInput?: number } | undefined;
  stop?: string | undefined;
  error?: string | undefined;
}

if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));

function connection(): { client: LLMClient; label: string } {
  if (opt.mock) {
    // Echoes every <seg> with "vi:" in front. Multi-line segments are legal on the wire, so this
    // does not go through the line-based test helper.
    const c: LLMClient = {
      model: 'mock',
      reasoningReserveTokens: 0,
      async *stream(req) {
        const user = req.messages.map((m) => m.content).join('\n');
        const out = user.replace(/<seg id="(\d+)"( n="[^"]*")?>([\s\S]*?)<\/seg>(?=\n<seg id=|$)/g, (_m, id: string, n: string | undefined, body: string) => `<seg id="${id}"${n ?? ''}>vi:${body}</seg>`);
        yield { type: 'text', delta: out };
        yield { type: 'usage', input: Math.ceil(user.length / 3.5), output: Math.ceil(out.length / 3.5) };
        yield { type: 'done', stopReason: 'end' };
      },
    };
    return { client: c, label: 'mock' };
  }
  const gemini = opt.provider === 'gemini';
  const key = process.env[gemini ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'];
  if (!key) throw new Error(`${gemini ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'} is not set (.env or the environment)`);
  const conn: ResolvedConnection = gemini
    ? { id: 'eval-gemini', protocol: 'openai-chat', baseUrl: GEMINI_OPENAI_BASE_URL, auth: { style: 'bearer' }, apiKey: key, quirks: {}, hasHostPermission: async () => true }
    : { id: 'eval-anthropic', protocol: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', auth: { style: 'x-api-key' }, apiKey: key, quirks: {}, hasHostPermission: async () => true };
  const model = opt.model ?? (gemini ? 'gemini-3.5-flash-lite' : 'claude-haiku-4-5-20251001');
  return { client: createClient(conn, model), label: `${opt.provider}/${model}` };
}

/** Records every call of the wrapped client, so the nonce rate and the repairs can be read back. */
function recording(inner: LLMClient, calls: CallRecord[], doc: () => string): LLMClient {
  return {
    model: inner.model,
    reasoningReserveTokens: inner.reasoningReserveTokens,
    async *stream(req) {
      const rec: CallRecord = { doc: doc(), n: calls.length + 1, ms: 0, system: req.system, maxOutputTokens: req.maxOutputTokens, user: req.messages.map((m) => m.content).join('\n'), text: '' };
      calls.push(rec);
      const t0 = Date.now();
      try {
        for await (const e of inner.stream(req)) {
          if (e.type === 'text') rec.text += e.delta;
          else if (e.type === 'usage') rec.usage = { input: e.input, output: e.output, ...(e.cachedInput === undefined ? {} : { cachedInput: e.cachedInput }) };
          else if (e.type === 'done') rec.stop = e.stopReason;
          else rec.error = `${e.error.kind}: ${e.error.message}`;
          yield e;
        }
      } finally {
        rec.ms = Date.now() - t0;
      }
    },
  };
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });

const STRATEGY = 'single-pass';
const evalSet = opt.set === 'eval';
if (!evalSet && opt.set !== 'fixtures') throw new Error('--set expects fixtures or eval');
const slugs = opt.docs ? opt.docs.split(',') : evalSet ? listPassageIds(ROOT) : [...EVAL_SLUGS];
function loadDoc(slug: string): FixtureDoc {
  if (!evalSet) return JSON.parse(fs.readFileSync(path.join(DOCS, `${slug}.json`), 'utf8')) as FixtureDoc;
  const p = loadPassage(ROOT, slug);
  return { slug, url: p.meta.url, title: p.meta.title, lang: p.lang, segments: p.segments };
}
const { client: baseClient, label } = connection();
const price = priceFor(baseClient.model, opt.price);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(opt.out ?? path.join(ROOT, 'eval-results', `${stamp}_${label.replace(/\W+/g, '-')}`));
fs.mkdirSync(outDir, { recursive: true });

const calls: CallRecord[] = [];
let current = '';
const engine = createEngine({ llm: () => recording(baseClient, calls, () => current), now: Date.now, sleep, strategies: [singlePass], prompts: createDefaultPromptRegistry() });
const chunkTokens = Number(opt['chunk-tokens']);

interface DocResult {
  slug: string;
  segments: number;
  translatable: number;
  final: number;
  failed: number;
  /** Translatable segments with no final text at the end: the criterion-3 number. */
  lost: number;
  repaired: number;
  calls: number;
  input: number;
  cachedInput: number;
  output: number;
  wallMs: number;
  firstFinalMs: number | null;
  costUsd: number | null;
  errors: string[];
}

async function runDoc(slug: string): Promise<DocResult> {
  const doc = loadDoc(slug);
  current = slug;
  const callsBefore = calls.length;
  const job: TranslationJob = {
    doc: { url: doc.url, title: doc.title, sourceLang: doc.lang, targetLang: opt.target as string, outline: [], segments: doc.segments },
    priority: [],
    strategy: STRATEGY,
    options: { style: 'natural', glossary: [], maxConcurrency: Number(opt.concurrency), chunkTokens },
  };
  const finals = new Map<string, { text: string; attempt: number }>();
  const failed = new Map<string, string>();
  const usage = { input: 0, cachedInput: 0, output: 0 };
  let firstFinalMs: number | null = null;
  const t0 = Date.now();
  for await (const e of engine.translate(job, new AbortController().signal) as AsyncIterable<EngineEvent>) {
    if (e.type === 'segment.final') {
      finals.set(e.id, { text: e.text, attempt: e.attempt ?? 1 });
      failed.delete(e.id);
      firstFinalMs ??= Date.now() - t0;
    } else if (e.type === 'segment.failed') {
      failed.set(e.id, `${e.error.kind}: ${e.error.message}`);
      finals.delete(e.id);
    } else if (e.type === 'usage') {
      usage.input += e.input;
      usage.cachedInput += e.cachedInput ?? 0;
      usage.output += e.output;
    }
  }
  const wallMs = Date.now() - t0;
  const want = doc.segments.filter((s) => s.translate);
  fs.writeFileSync(
    path.join(outDir, `${slug}.output.json`),
    `${JSON.stringify(
      doc.segments.map((s) => ({ id: s.id, kind: s.kind, translate: s.translate, source: s.inlineMarkup, text: finals.get(s.id)?.text ?? null, attempt: finals.get(s.id)?.attempt ?? null, error: failed.get(s.id) ?? null })),
      null,
      1,
    )}\n`,
  );
  return {
    slug,
    segments: doc.segments.length,
    translatable: want.length,
    final: want.filter((s) => finals.has(s.id)).length,
    failed: failed.size,
    lost: want.filter((s) => !finals.has(s.id)).length,
    repaired: [...finals.values()].filter((f) => f.attempt > 1).length,
    calls: calls.length - callsBefore,
    ...usage,
    wallMs,
    firstFinalMs,
    costUsd: price ? costUsd(price, usage) : null,
    errors: [...new Set(failed.values())],
  };
}

interface NonceProbe {
  slug: string;
  chunks: number;
  opens: number;
  /** Opening tags that carry the chunk's nonce, as asked. */
  echoed: number;
}

/** The nonce-copy rate (M1-D11): every chunk is sent as a v2 chunk with a nonce; count the echoes. */
async function probeNonce(slug: string): Promise<NonceProbe> {
  const doc = loadDoc(slug);
  current = `${slug}#nonce`;
  const prompt = createDefaultPromptRegistry().get(TRANSLATE_PROMPT_ID);
  const system = renderSystemPrompt((vars) => prompt.render(vars), { sourceLang: doc.lang, targetLang: opt.target as string, style: 'natural' });
  const probe: NonceProbe = { slug, chunks: 0, opens: 0, echoed: 0 };
  for (const chunk of chunkSegments(doc.segments, chunkLimits(chunkTokens))) {
    const wire = toWire(chunk.segments);
    const v2 = { ...wire, grammar: 'v2' as const, nonce: nonceFor(wire.segments.map((e) => e.segment.inlineMarkup)) };
    let text = '';
    const rec = recording(baseClient, calls, () => current);
    for await (const e of rec.stream(translateRequest(rec, system, v2, new AbortController().signal))) {
      if (e.type === 'text') text += e.delta;
    }
    probe.chunks++;
    for (const m of text.matchAll(/<seg\s+id="\d+"([^>]*)>/g)) {
      probe.opens++;
      if (m[1]?.includes(`n="${v2.nonce}"`)) probe.echoed++;
    }
  }
  return probe;
}

const results: DocResult[] = [];
for (const slug of slugs) {
  const r = await runDoc(slug);
  results.push(r);
  console.log(`${slug.padEnd(34)} final ${r.final}/${r.translatable} lost ${r.lost} repaired ${r.repaired} calls ${r.calls} in ${r.input} out ${r.output} ${(r.wallMs / 1000).toFixed(1)}s ${r.costUsd === null ? 'cost n/a' : `$${r.costUsd.toFixed(5)}`}${price && !price.verified ? ' (UNVERIFIED price)' : ''}`);
}
const probes: NonceProbe[] = [];
if (opt['probe-nonce']) {
  for (const slug of slugs) {
    const p = await probeNonce(slug);
    probes.push(p);
    console.log(`${slug.padEnd(34)} nonce echoed ${p.echoed}/${p.opens} (${p.chunks} chunks)`);
  }
}

fs.writeFileSync(path.join(outDir, 'calls.jsonl'), calls.map((c) => JSON.stringify(c)).join('\n') + '\n');
const sum = (f: (r: DocResult) => number): number => results.reduce((n, r) => n + f(r), 0);
const total = { translatable: sum((r) => r.translatable), lost: sum((r) => r.lost), failed: sum((r) => r.failed), repaired: sum((r) => r.repaired), calls: sum((r) => r.calls), input: sum((r) => r.input), cachedInput: sum((r) => r.cachedInput), output: sum((r) => r.output), wallMs: sum((r) => r.wallMs), costUsd: price ? sum((r) => r.costUsd ?? 0) : null };
// chars/3.5 check (tokens.ts): characters per token as the provider counted them, over the
// translation calls (system + user text in, answer text out). Nonce probes are left out.
const counted = calls.filter((c) => !c.doc.endsWith('#nonce') && c.usage !== undefined);
const charsIn = counted.reduce((n, c) => n + c.system.length + c.user.length, 0);
const tokensIn = counted.reduce((n, c) => n + (c.usage?.input ?? 0), 0);
const charsOut = counted.reduce((n, c) => n + c.text.length, 0);
const tokensOut = counted.reduce((n, c) => n + (c.usage?.output ?? 0), 0);
const charsPerToken = { calls: counted.length, input: tokensIn ? charsIn / tokensIn : null, output: tokensOut ? charsOut / tokensOut : null, assumed: CHARS_PER_TOKEN };
// S2 threshold replay (S2 record, M1-E3 "before freezing any threshold"): the model's first answers
// to the real chunks, parsed and planned as the engine does. Healthy answers should show no fixes
// and no re-request; the length ratios say how far the merge factor is from real answers.
interface ThresholdStats {
  chunks: number;
  segments: number;
  chunksWithFixes: number;
  fixKinds: Record<string, number>;
  rerequested: number;
  merged: number;
  /** Highest (output ÷ source characters) ÷ chunk median, and how many segments exceed 1.2 / 1.4 / MERGE_FACTOR of it. */
  maxRatio: number;
  over: { '1.2': number; '1.4': number; [k: string]: number };
  /** Highest answer tokens ÷ the call's max_tokens (§5.7 formula). */
  maxBudgetUse: number;
  /** Segments of MAX_TAG characters or more that end inside an open tag (the hold-back): fixes `partial-tag`. */
  partialTag: number;
}
const thresholds: ThresholdStats = { chunks: 0, segments: 0, chunksWithFixes: 0, fixKinds: {}, rerequested: 0, merged: 0, maxRatio: 0, over: { '1.2': 0, '1.4': 0, [String(MERGE_FACTOR)]: 0 }, maxBudgetUse: 0, partialTag: 0 };
for (const slug of slugs) {
  const doc = loadDoc(slug);
  for (const chunk of chunkSegments(doc.segments, chunkLimits(chunkTokens))) {
    const wire = toWire(chunk.segments);
    const call = calls.find((c) => c.doc === slug && c.user === formatWire(wire));
    if (call === undefined) continue;
    const res = parseOutput(call.text, wire.segments.map((e) => e.n), (call.stop as StopReason | undefined) ?? 'other', { grammar: wire.grammar, ...(wire.nonce === undefined ? {} : { nonce: wire.nonce }) });
    const source = new Map(wire.segments.map((e) => [e.n, e.segment.inlineMarkup]));
    const plan = planRepair(res, source);
    thresholds.chunks++;
    thresholds.segments += wire.segments.length;
    if (res.fixes.length) thresholds.chunksWithFixes++;
    for (const f of res.fixes) thresholds.fixKinds[f.kind] = (thresholds.fixKinds[f.kind] ?? 0) + 1;
    thresholds.partialTag += res.fixes.filter((f) => f.detail === 'partial-tag').length;
    thresholds.rerequested += plan.rerequest.length;
    thresholds.merged += plan.merged.length;
    const ratios = [...res.segs].map(([id, text]) => text.length / Math.max(1, (source.get(id) ?? '').length));
    const sorted = [...ratios].sort((a, b) => a - b);
    const median = sorted[Math.floor((sorted.length - 1) / 2)] ?? 1;
    for (const r of ratios) {
      const rel = r / median;
      thresholds.maxRatio = Math.max(thresholds.maxRatio, rel);
      for (const k of Object.keys(thresholds.over)) if (rel > Number(k)) thresholds.over[k] = (thresholds.over[k] ?? 0) + 1;
    }
    if (call.usage) thresholds.maxBudgetUse = Math.max(thresholds.maxBudgetUse, call.usage.output / call.maxOutputTokens);
  }
}
const nonce = probes.length ? { echoed: probes.reduce((n, p) => n + p.echoed, 0), opens: probes.reduce((n, p) => n + p.opens, 0), perDoc: probes } : null;
const summary = { run: stamp, set: opt.set, strategy: STRATEGY, prompt: TRANSLATE_PROMPT_ID, label, model: baseClient.model, target: opt.target, chunkTokens, concurrency: Number(opt.concurrency), price: price ?? null, docs: results, total, nonce, charsPerToken, thresholds };
fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
const money = (n: number | null): string => (n === null ? 'n/a' : `$${n.toFixed(5)}`);
const md = [
  `# Eval run ${stamp}`,
  '',
  `Model \`${label}\`, target \`${opt.target}\`, chunk ${chunkTokens} tokens, ${opt.concurrency} in flight. ${price && !price.verified ? 'Price is an UNVERIFIED placeholder (scripts/eval/pricing.ts).' : ''}`,
  '',
  '| doc | segments | lost | repaired | calls | input | cached | output | wall s | first final s | cost |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...results.map((r) => `| ${r.slug} | ${r.translatable} | ${r.lost} | ${r.repaired} | ${r.calls} | ${r.input} | ${r.cachedInput} | ${r.output} | ${(r.wallMs / 1000).toFixed(1)} | ${r.firstFinalMs === null ? '–' : (r.firstFinalMs / 1000).toFixed(1)} | ${money(r.costUsd)} |`),
  `| **total** | ${total.translatable} | ${total.lost} | ${total.repaired} | ${total.calls} | ${total.input} | ${total.cachedInput} | ${total.output} | ${(total.wallMs / 1000).toFixed(1)} | | ${money(total.costUsd)} |`,
  '',
  `Characters per token (provider-counted; the engine assumes ${CHARS_PER_TOKEN}): input ${charsPerToken.input?.toFixed(2) ?? '–'}, output ${charsPerToken.output?.toFixed(2) ?? '–'} over ${charsPerToken.calls} calls.`,
  `S2 thresholds on ${thresholds.chunks} chunks / ${thresholds.segments} segments: ${thresholds.chunksWithFixes} chunks with parser fixes ${JSON.stringify(thresholds.fixKinds)}, ${thresholds.rerequested} re-requested, ${thresholds.merged} flagged merged; length ratio vs chunk median: max ${thresholds.maxRatio.toFixed(2)}, over 1.2/1.4/${MERGE_FACTOR}: ${Object.values(thresholds.over).join('/')}; ${MAX_TAG}-char tag hold-back: ${thresholds.partialTag} partial tags; highest answer/max_tokens ${thresholds.maxBudgetUse.toFixed(2)}.`,
  nonce ? `Nonce copy: ${nonce.echoed}/${nonce.opens} opening tags carried the nonce (${nonce.opens ? ((100 * nonce.echoed) / nonce.opens).toFixed(1) : '–'}%).` : 'Nonce probe not run (--probe-nonce).',
  ...results.filter((r) => r.errors.length).map((r) => `\n${r.slug} errors: ${r.errors.join('; ')}`),
  '',
].join('\n');
fs.writeFileSync(path.join(outDir, 'summary.md'), md);
console.log(`\nresults: ${path.relative(ROOT, outDir)}  total lost ${total.lost}/${total.translatable}  cost ${money(total.costUsd)}${price && !price.verified ? ' (UNVERIFIED price)' : ''}`);
process.exitCode = total.lost === 0 ? 0 : 1;
