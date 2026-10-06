// Criterion 6 (plan M1 §3): the engine runs in plain Node, outside vitest, with only injected
// ports (a real setTimeout sleep, Date.now) and a scripted LLMClient. One rate limit is retried.
// Run: pnpm run engine:node   (Node type stripping; Node >= 22.18)
import { chunkSegments, createEngine, createPromptRegistry, defineStage, defineStrategy, toWire, translateChunk, type ChunkCall, type TranslationJob } from '../src/engine/index.ts';
import { fakeClient, rateLimited, success } from '../src/engine/testing.ts';

const client = fakeClient([[rateLimited(5)], success('xin chào')]);
const strategy = defineStrategy({
  id: 'single-pass',
  version: 1,
  stages: [
    defineStage<TranslationJob, never>({
      id: 'translate',
      scope: 'document',
      async *run(job, ctx) {
        const c = ctx.llm('translate');
        let text = '';
        for await (const e of c.stream({ model: c.model, system: '', messages: [], maxOutputTokens: 10, signal: ctx.signal })) {
          if (e.type === 'text') text += e.delta;
        }
        for (const s of job.doc.segments) {
          yield { type: 'segment.final', id: s.id, text, revision: 1, producedBy: { strategy: 'single-pass', stage: 'translate', model: c.model } };
        }
      },
    }),
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

// Phase B: chunker + <seg> parser + one repair round, in plain Node. The first answer is cut by
// max_tokens; the repair answers the rest.
const segs = ['One.', 'Two <seg id="9"> literal.', 'Three.'].map((t, i) => ({ id: `p${i}`, kind: 'p' as const, text: t, inlineMarkup: t, domPath: `p[${i + 1}]`, translate: true }));
const [chunk] = chunkSegments(segs);
const wire = toWire(chunk?.segments ?? []);
const n = wire.nonce ?? '';
const segClient = fakeClient([
  [{ type: 'text', delta: `<seg id="1" n="${n}">Một.</seg><seg id="2" n="${n}">Hai <seg id="9"> li` }, { type: 'done', stopReason: 'max_tokens' }],
  [{ type: 'text', delta: `<seg id="2" n="${n}">Hai <seg id="9"> nguyên văn.</seg><seg id="3" n="${n}">Ba.</seg>` }, { type: 'done', stopReason: 'end' }],
]);
const call: ChunkCall = () => segClient.stream({ model: segClient.model, system: '', messages: [], maxOutputTokens: 100, signal: new AbortController().signal });
const finals: string[] = [];
for await (const e of translateChunk(wire, call, { producedBy: { strategy: 'node', stage: 'translate', model: segClient.model }, revision: 1, role: 'translate' })) {
  if (e.type === 'segment.final') finals.push(`${e.id}=${e.text}#${e.attempt ?? 1}`);
}
const segOk = wire.grammar === 'v2' && finals.join('|') === 'p0=Một.#1|p1=Hai <seg id="9"> nguyên văn.#2|p2=Ba.#2';
console.log(`seg parser node run: ${segOk ? 'OK' : 'FAILED'} (${finals.join(' | ')})`);
process.exit(ok && segOk ? 0 : 1);
