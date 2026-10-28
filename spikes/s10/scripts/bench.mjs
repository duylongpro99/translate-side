// Speed bench in Chromium (Playwright's Chrome for Testing), inside the extension page (CSP self + wasm-unsafe-eval).
// Writes results/bench.json. Usage: node build.mjs && node scripts/bench.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, voiceHost, BASE, VI, EN } from './browser.mjs';

const RUNS = 5;
// About 200 characters each, two sentences, typical article prose.
const BLOCKS = {
  vi: 'Hà Nội đang bước vào những ngày đẹp nhất của mùa thu, khi gió heo may tràn về trên các con phố cổ. Nhiều người dân tranh thủ buổi sáng sớm để đi dạo quanh hồ Gươm và thưởng thức.',
  en: 'The city council approved the new budget on Tuesday after a long debate about public transport and housing. Officials said the plan would add more buses and repair several bridges by next spring.',
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const server = await voiceHost();
const { ctx, open, browserVersion } = await launch('bench-profile');
const result = {
  date: new Date().toISOString(),
  machine: { cpu: os.cpus()[0].model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30), os: `${os.type()} ${os.release()}` },
  browser: browserVersion,
  blocks: Object.fromEntries(Object.entries(BLOCKS).map(([k, v]) => [k, { chars: v.length, text: v }])),
  configs: {},
};
for (const threads of [1, 4]) {
  const cfg = (result.configs[`threads=${threads}`] = {});
  // Cold: a fresh page, voice from the Cache API (downloaded once into the persistent profile), first block.
  for (const [lang, name] of [['vi', VI], ['en', EN]]) {
    const page = await open(threads);
    const t0 = Date.now();
    const load = await page.evaluate(([n, b]) => s10.loadVoice(n, b), [name, BASE]);
    const first = await page.evaluate(([n, l, t]) => s10.speakBlock(n, l, t), [name, lang, BLOCKS[lang]]);
    const coldFirstAudioMs = Date.now() - t0 - first.totalInferenceMs + first.firstInferenceMs; // up to the first audio only
    const warm = [];
    for (let i = 0; i < RUNS; i++) warm.push(await page.evaluate(([n, l, t]) => s10.speakBlock(n, l, t), [name, lang, BLOCKS[lang]]));
    const warmClauses = [];
    for (let i = 0; i < RUNS; i++) warmClauses.push(await page.evaluate(([n, l, t]) => s10.speakBlock(n, l, t, true, true), [name, lang, BLOCKS[lang]]));
    cfg[lang] = {
      load,
      coldFirstAudioMsApprox: Math.round(coldFirstAudioMs),
      firstRun: first,
      warmMedian: {
        g2pMs: median(warm.map((w) => w.g2pMs)),
        firstAudioMs: median(warm.map((w) => w.firstAudioMs)),
        totalInferenceMs: median(warm.map((w) => w.totalInferenceMs)),
        audioSeconds: median(warm.map((w) => w.audioSeconds)),
        rtf: median(warm.map((w) => w.rtf)),
      },
      warmMedianClauseChunks: {
        firstAudioMs: median(warmClauses.map((w) => w.firstAudioMs)),
        rtf: median(warmClauses.map((w) => w.rtf)),
        chunks: warmClauses[0].sentences,
      },
      sentences: first.sentences,
      firstSentenceChars: first.firstSentenceChars,
    };
    console.log(`threads=${threads} ${lang} cold≈${cfg[lang].coldFirstAudioMsApprox}ms`, JSON.stringify(cfg[lang].warmMedian), JSON.stringify(cfg[lang].warmMedianClauseChunks), 'load', JSON.stringify(load));
    await page.close();
  }
}
await ctx.close();
server.close();
fs.writeFileSync(path.join(import.meta.dirname, '../results/bench.json'), JSON.stringify(result, null, 1) + '\n');
