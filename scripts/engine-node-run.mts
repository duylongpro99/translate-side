// Criterion 6 (plan M1 §3): the engine runs in plain Node, outside vitest, with only injected
// ports (a real setTimeout sleep, Date.now) and a scripted LLMClient. One rate limit is retried.
// Run: pnpm run engine:node   (Node type stripping; Node >= 22.18)
import { createEngine, createPromptRegistry, defineStrategy, type StageContext, type TranslationJob } from '../src/engine/index.ts';
import { fakeClient, rateLimited, success } from '../src/engine/testing.ts';

const client = fakeClient([[rateLimited(5)], success('xin chào')]);
const strategy = defineStrategy({
  id: 'single-pass',
  version: 1,
  stages: [
    {
      id: 'translate',
      scope: 'document',
      async *run(job: TranslationJob, ctx: StageContext) {
        const c = ctx.llm('translate');
        let text = '';
        for await (const e of c.stream({ model: c.model, system: '', messages: [], maxOutputTokens: 10, signal: ctx.signal })) {
          if (e.type === 'text') text += e.delta;
        }
        for (const s of job.doc.segments) {
          yield { type: 'segment.final', id: s.id, text, revision: 1, producedBy: { strategy: 'single-pass', stage: 'translate', model: c.model } };
        }
      },
    } as never,
  ],
});
const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });
const engine = createEngine({ llm: () => client, now: Date.now, sleep, strategies: [strategy], prompts: createPromptRegistry([]) });
const job: TranslationJob = {
  doc: { url: 'https://example.com', title: 't', sourceLang: 'en', targetLang: 'vi', outline: [], segments: [{ id: '1', kind: 'p', text: 'hello', inlineMarkup: 'hello', domPath: 'p[1]', translate: true }] },
  priority: [],
  strategy: 'single-pass',
  options: { style: 'natural', glossary: [], maxConcurrency: 2, chunkTokens: 1200 },
};
const events = [];
for await (const e of engine.translate(job, new AbortController().signal)) events.push(e);
for (const e of events) console.log(JSON.stringify(e));
const final = events.find((e) => e.type === 'segment.final');
const ok = final?.type === 'segment.final' && final.text === 'xin chào' && client.requests.length === 2 && events.at(-1)?.type === 'done';
console.log(`engine node run: ${ok ? 'OK' : 'FAILED'} (attempts ${client.requests.length}, node ${process.versions.node})`);
process.exit(ok ? 0 : 1);
