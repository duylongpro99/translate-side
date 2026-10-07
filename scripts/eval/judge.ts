// LLM-as-judge over a finished run: pnpm run eval:judge -- <run-dir> [--provider apibox|gemini] [--model id] [--docs a,b]
//   [--mock] [--concurrency n] [--price in,cached,out]
// Writes <run-dir>/judge.json after every passage and resumes from it: passages already scored by the same judge model
// are skipped, so a run cut short by a quota is finished by running the command again later. `--docs` scores only those
// passages (a smoke test). Provider `apibox` (default, M2-D13; AIBOX_API_KEY, thinking at effort medium, recorded in judge.json) or `gemini` (GEMINI_API_KEY,
// the old judge); keys from .env. The judge model is pinned in judge-core.ts.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { APIBOX_BASE_URL, APIBOX_JUDGE_QUIRKS, createClient, GEMINI_OPENAI_BASE_URL } from '@/llm';
import type { LLMClient, ResolvedConnection } from '@/llm/types';
import { costUsd, priceFor } from './pricing.ts';
import { askJudge, isComplete, judgeOnce, JUDGE_MODEL, JUDGE_PROMPT_ID, judgeSystemPrompt, judgeUserPrompt, QuotaStop } from './judge-core.ts';
import { loadPassage } from './passages.ts';
import { JUDGE_FILE, loadRun, type JudgeFile } from './runs.ts';
import { DIMENSIONS } from './rubric.ts';

const { values: opt, positionals } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  allowPositionals: true,
  options: { provider: { type: 'string', default: 'apibox' }, model: { type: 'string' }, docs: { type: 'string' }, mock: { type: 'boolean', default: false }, concurrency: { type: 'string', default: '3' }, price: { type: 'string' } },
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
  const gemini = opt.provider === 'gemini';
  if (!gemini && opt.provider !== 'apibox') throw new Error('--provider expects apibox or gemini');
  const keyName = gemini ? 'GEMINI_API_KEY' : 'AIBOX_API_KEY';
  const key = process.env[keyName];
  if (!key) throw new Error(`${keyName} is not set (.env or the environment)`);
  const conn: ResolvedConnection = { id: 'eval-judge', protocol: 'openai-chat', baseUrl: gemini ? GEMINI_OPENAI_BASE_URL : APIBOX_BASE_URL, auth: { style: 'bearer' }, apiKey: key, quirks: gemini ? {} : { ...APIBOX_JUDGE_QUIRKS }, hasHostPermission: async () => true };
  return createClient(conn, model);
}

const llm = client();
/** The thinking setting the scores were made with; scores made with another are not resumed. */
const reasoning: NonNullable<JudgeFile['reasoning']> = opt.mock || opt.provider === 'gemini' ? { effort: 'off', reserveTokens: 0 } : { effort: String(APIBOX_JUDGE_QUIRKS.reasoning?.lowest), reserveTokens: APIBOX_JUDGE_QUIRKS.reasoning?.reserveTokens ?? 0 };
const price = priceFor(model, opt.price);
const usage = { input: 0, cachedInput: 0, output: 0 };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ask = (system: string, user: string): Promise<string> => askJudge(llm, system, user, usage, sleep);

const sameThinking = (r: JudgeFile['reasoning']) => (r?.effort ?? 'off') === reasoning.effort;
const prior = run.judge?.judgeModel === model && run.judge.prompt === JUDGE_PROMPT_ID && sameThinking(run.judge.reasoning) ? run.judge : undefined;
const judged: JudgeFile['scores'] = Object.fromEntries(Object.entries(prior?.scores ?? {}).filter(([id, sc]) => run.outputs[id] && isComplete(sc)));
const only = opt.docs ? new Set(opt.docs.split(',')) : undefined;
const ids = Object.keys(run.outputs).sort().filter((id) => !judged[id] && (only === undefined || only.has(id)));
const failed: string[] = [];
let stopped: string | undefined;
let next = 0;
usage.input += prior?.usage.input ?? 0;
usage.cachedInput += prior?.usage.cachedInput ?? 0;
usage.output += prior?.usage.output ?? 0;
const save = (): void => {
  const file: JudgeFile = {
    judgeModel: model,
    prompt: JUDGE_PROMPT_ID,
    at: new Date().toISOString(),
    scores: Object.fromEntries(Object.entries(judged).sort(([a], [b]) => a.localeCompare(b))),
    failed: [...failed].sort(),
    usage: { input: usage.input, cachedInput: usage.cachedInput, output: usage.output },
    costUsd: price ? costUsd(price, usage) : null,
    reasoning,
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
      const result = await judgeOnce(ask, system, user);
      if (!result) {
        failed.push(id);
        console.log(`${id.padEnd(28)} FAILED the reply lacked a dimension twice`);
        continue;
      }
      judged[id] = result;
      save();
      console.log(`${id.padEnd(28)} ${DIMENSIONS.map((d) => result[d]).join(' ')}`);
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
