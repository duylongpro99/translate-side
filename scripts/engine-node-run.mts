// Criterion 6 (plan M1 §3): the engine runs in plain Node, outside vitest, with only injected
// ports (a real setTimeout sleep, Date.now) and a scripted LLMClient. One rate limit is retried.
// Then the Phase B parser and the Phase C `single-pass` strategy run end to end the same way.
// Run: pnpm run engine:node   (Node type stripping; Node >= 22.18)
import { callBudget, chunkSegments, createDefaultPromptRegistry, createEngine, createPromptRegistry, defineStage, defineStrategy, singlePass, toWire, translateChunk, type ChunkCall, type EngineEvent, type TranslationJob } from '../src/engine/index.ts';
import { fakeClient, rateLimited, renderLines, success, translatorClient } from '../src/engine/testing.ts';

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

// Phase C: the real `single-pass` strategy (translate@1 + chunker + one repair round + check) end to
// end through createEngine, on a scripted translator that answers the `<seg>` lines it receives.
// The first answer is cut by max_tokens so the repair path runs; the third segment holds a literal
// tag, so the chunk goes out with a nonce that the fake echoes. No SDK, no network.
const translator = translatorClient((lines, call) => {
  if (call === 1) return { text: renderLines(lines.slice(0, 1), (s) => `vi:${s}`) + `\n<seg id="2" n="${lines[1]?.nonce ?? ''}">vi:Tw`, stopReason: 'max_tokens' };
  return renderLines(lines, (s) => `vi:${s}`);
});
const spEngine = createEngine({ llm: () => translator, now: Date.now, sleep, strategies: [singlePass], prompts: createDefaultPromptRegistry() });
const spSegs = ['One.', 'Two.', 'Three <seg id="1"> literal.'].map((t, i) => ({ id: `s${i}`, kind: 'p' as const, text: t, inlineMarkup: t, domPath: `p[${i + 1}]`, translate: true }));
const spJob: TranslationJob = { ...job, doc: { ...job.doc, segments: spSegs } };
const spEvents: EngineEvent[] = [];
for await (const e of spEngine.translate(spJob, new AbortController().signal)) spEvents.push(e);
const spFinals = spEvents.flatMap((e) => (e.type === 'segment.final' ? [`${e.id}=${e.text}#${e.attempt ?? 1}`] : []));
const spStart = spEvents.find((e) => e.type === 'stage' && e.stage === 'translate' && e.status === 'start');
const spReq = translator.requests[0];
const spOk =
  translator.requests.length === 2 &&
  spReq?.system.includes('native writer of Vietnamese') === true &&
  spReq.cacheHint === 'system' &&
  spReq.temperature === 0.2 &&
  spReq.maxOutputTokens === callBudget(toWire(spSegs), 0) &&
  /<seg id="1" n="[a-z0-9]{4}">One\.<\/seg>/.test(spReq.messages[0]?.content ?? '') &&
  spFinals.join('|') === 's0=vi:One.#1|s1=vi:Two.#2|s2=vi:Three <seg id="1"> literal.#2' &&
  spEvents.filter((e) => e.type === 'segment.failed').length === 0 &&
  spStart?.type === 'stage' && JSON.stringify(spStart.info) === JSON.stringify({ promptId: 'translate@1' }) &&
  spEvents.at(-1)?.type === 'done';
console.log(`single-pass node run: ${spOk ? 'OK' : 'FAILED'} (calls ${translator.requests.length}, maxOutputTokens ${spReq?.maxOutputTokens}, ${spFinals.join(' | ')})`);
process.exit(ok && segOk && spOk ? 0 : 1);
