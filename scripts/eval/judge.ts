// LLM-as-judge over a finished run: pnpm run eval:judge -- <run-dir> [--model id] [--mock] [--concurrency n] [--price in,cached,out]
// Writes <run-dir>/judge.json after every passage and resumes from it: passages already scored by the same judge model
// are skipped, so a run cut short by a daily quota (the free Gemini tier allows ~20 requests a day per model) is finished
// by running the command again later. Gemini only (M2-D2); key from .env (GEMINI_API_KEY). The judge model is pinned in judge-core.ts.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createClient, GEMINI_OPENAI_BASE_URL } from '@/llm';
import type { LLMClient, LLMError, ResolvedConnection } from '@/llm/types';
import { costUsd, priceFor } from './pricing.ts';
import { JUDGE_MODEL, JUDGE_PROMPT_ID, judgeSystemPrompt, judgeUserPrompt } from './judge-core.ts';
import { loadPassage } from './passages.ts';
import { JUDGE_FILE, loadRun, type JudgeFile } from './runs.ts';
import { DIMENSIONS } from './rubric.ts';
import { parseJudgeReply } from './scores.ts';

const { values: opt, positionals } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  allowPositionals: true,
  options: { model: { type: 'string' }, mock: { type: 'boolean', default: false }, concurrency: { type: 'string', default: '3' }, price: { type: 'string' } },
});
const root = path.resolve(process.cwd());
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const dir = positionals[0];
if (!dir) throw new Error('usage: pnpm run eval:judge -- <run-dir> [--model id] [--mock]');
const run = loadRun(path.resolve(dir));
const model = opt.mock ? 'mock-judge' : (opt.model ?? JUDGE_MODEL);

function client(): LLMClient {
  if (opt.mock) {
    return {
      model: model,
      reasoningReserveTokens: 0,
      async *stream() {
        yield { type: 'text', delta: '```json\n{"fidelity": 4, "naturalness": 3, "tone": 4, "terminology": 5, "comment": "mock"}\n```' };
        yield { type: 'usage', input: 100, output: 20 };
        yield { type: 'done', stopReason: 'end' };
      },
    };
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set (.env or the environment)');
  const conn: ResolvedConnection = { id: 'eval-judge', protocol: 'openai-chat', baseUrl: GEMINI_OPENAI_BASE_URL, auth: { style: 'bearer' }, apiKey: key, quirks: {}, hasHostPermission: async () => true };
  return createClient(conn, model);
}

const llm = client();
const price = priceFor(model, opt.price);
const usage = { input: 0, cachedInput: 0, output: 0 };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set(['rate_limit', 'overloaded', 'network', 'unknown']);
/** A wait longer than this is a daily quota, not a burst: stop instead of sleeping on it. */
const MAX_WAIT_MS = 90_000;
class QuotaStop extends Error {}

async function ask(system: string, user: string): Promise<string> {
  let last: LLMError | undefined;
  for (let attempt = 0; attempt < 6; attempt++) {
    let text = '';
    last = undefined;
    for await (const e of llm.stream({ model: llm.model, system, messages: [{ role: 'user', content: user }], maxOutputTokens: 1200 + llm.reasoningReserveTokens, temperature: 0, signal: new AbortController().signal })) {
      if (e.type === 'text') text += e.delta;
      else if (e.type === 'usage') {
        usage.input += e.input;
        usage.cachedInput += e.cachedInput ?? 0;
        usage.output += e.output;
      } else if (e.type === 'error') last = e.error;
    }
    if (!last) return text;
    if (last.kind === 'quota' || (last.retryAfterMs ?? 0) > MAX_WAIT_MS || /PerDay|retry in \d+h/i.test(`${last.message} ${JSON.stringify(last.raw ?? '')}`)) throw new QuotaStop(`${last.kind}: ${last.message.slice(0, 300)}`);
    if (!RETRYABLE.has(last.kind)) break;
    await sleep(last.retryAfterMs ?? Math.min(30_000, 2000 * 2 ** attempt));
  }
  throw new Error(`${last?.kind}: ${last?.message}`);
}

const complete = (sc: JudgeFile['scores'][string] | undefined): boolean => sc !== undefined && DIMENSIONS.every((d) => sc[d] !== undefined);
const prior = run.judge?.judgeModel === model && run.judge.prompt === JUDGE_PROMPT_ID ? run.judge : undefined;
const judged: JudgeFile['scores'] = Object.fromEntries(Object.entries(prior?.scores ?? {}).filter(([id, sc]) => run.outputs[id] && complete(sc)));
const ids = Object.keys(run.outputs).sort().filter((id) => !judged[id]);
const failed: string[] = [];
let stopped: string | undefined;
let next = 0;
usage.input += prior?.usage.input ?? 0;
usage.output += prior?.usage.output ?? 0;
const save = (): void => {
  const file: JudgeFile = {
    judgeModel: model,
    prompt: JUDGE_PROMPT_ID,
    at: new Date().toISOString(),
    scores: Object.fromEntries(Object.entries(judged).sort(([a], [b]) => a.localeCompare(b))),
    failed: [...failed].sort(),
    usage: { input: usage.input, output: usage.output },
    costUsd: price ? costUsd(price, usage) : null,
  };
  fs.writeFileSync(path.join(run.dir, JUDGE_FILE), `${JSON.stringify(file, null, 1)}\n`);
};
async function worker(): Promise<void> {
  while (next < ids.length && !stopped) {
    const id = ids[next++] as string;
    const items = run.outputs[id] ?? [];
    const system = judgeSystemPrompt(run.summary.target);
    const user = judgeUserPrompt(loadPassage(root, id).meta.title, items);
    try {
      let reply = parseJudgeReply(await ask(system, user));
      if (DIMENSIONS.some((d) => reply.scores[d] === undefined)) reply = parseJudgeReply(await ask(system, user));
      if (DIMENSIONS.some((d) => reply.scores[d] === undefined)) failed.push(id);
      judged[id] = { ...reply.scores, ...(reply.comment === undefined ? {} : { comment: reply.comment }) };
      save();
      console.log(`${id.padEnd(28)} ${DIMENSIONS.map((d) => reply.scores[d] ?? '–').join(' ')}`);
    } catch (e) {
      if (e instanceof QuotaStop) stopped = e.message;
      else failed.push(id);
      console.log(`${id.padEnd(28)} FAILED ${(e as Error).message}`);
    }
  }
}
await Promise.all(Array.from({ length: Number(opt.concurrency) }, worker));

save();
const done = Object.keys(judged).length;
const total = Object.keys(run.outputs).length;
console.log(`judge ${model}: ${done}/${total} passages scored, ${usage.input} in / ${usage.output} out, cost ${price ? `$${costUsd(price, usage).toFixed(4)}` : 'n/a (no price for this model; pass --price)'}`);
if (stopped) console.log(`stopped on a quota (${stopped}). Run the same command later to finish the remaining ${total - done}.`);
process.exitCode = stopped ? 2 : failed.length ? 1 : 0;
