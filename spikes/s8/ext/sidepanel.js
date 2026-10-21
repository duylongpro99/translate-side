/* global chrome, LanguageModel, Translator, LanguageDetector, S8Engine */
// S8 side panel: probes Chrome's built-in AI (Translator, LanguageDetector, LanguageModel / Gemini
// Nano) for questions Q1–Q6 of the S8 spike (see ../README.md). Every result goes to the log, which
// can be copied as JSON. Plain JS on purpose: no build step besides ../build.mjs, which generates
// engine.js (the product's real prompt and parser) and fixtures.json (blocks of three site fixtures).
'use strict';

const T0 = performance.now();
const LOG = [];
// Read by probe-q7.mjs's smoke test.
globalThis.__s8Log = LOG;
const E = globalThis.S8Engine;
const $ = (id) => document.getElementById(id);
const NANO_LANGS = ['en', 'es', 'ja', 'de', 'fr'];
const SAMPLE = {
  en: 'The quick brown fox jumps over the lazy dog.',
  es: 'El rápido zorro marrón salta sobre el perro perezoso.',
  ja: '素早い茶色の狐が怠け者の犬を飛び越える。',
  de: 'Der schnelle braune Fuchs springt über den faulen Hund.',
  fr: 'Le rapide renard brun saute par-dessus le chien paresseux.',
  vi: 'Con cáo nâu nhanh nhẹn nhảy qua con chó lười.',
};

// ---------- log ----------

function log(kind, data = {}) {
  const entry = { at: new Date().toISOString(), ms: Math.round(performance.now() - T0), kind, ...data };
  LOG.push(entry);
  const line = document.createElement('div');
  if (kind.endsWith('error') || 'error' in data) line.className = 'err';
  line.textContent = `${entry.at.slice(11, 23)} +${entry.ms}ms ${kind} ${JSON.stringify(data)}`;
  const box = $('log');
  box.append(line);
  box.scrollTop = box.scrollHeight;
  console.log('[s8]', entry);
  return entry;
}

function errInfo(e) {
  const info = { name: e?.name ?? typeof e, message: e?.message ?? String(e) };
  // QuotaExceededError carries the numbers on newer builds (requested / quota or contextWindow).
  for (const k of ['requested', 'quota', 'contextWindow']) if (e && e[k] !== undefined) info[k] = e[k];
  return info;
}

const since = (t) => Math.round(performance.now() - t);
const activation = () => ({ isActive: navigator.userActivation?.isActive ?? null, hasBeenActive: navigator.userActivation?.hasBeenActive ?? null });
const status = (text) => ($('status').textContent = text);

/** A `monitor` option that logs every downloadprogress event with its label. */
function monitor(label) {
  return (m) => {
    m.addEventListener('downloadprogress', (e) => log('downloadprogress', { label, loaded: e.loaded, total: e.total }));
  };
}

async function environment() {
  const env = {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory ?? null,
    apis: apiPresence(),
    atLoad: globalThis.__s8AtLoad ?? null,
  };
  try {
    env.uaData = await navigator.userAgentData?.getHighEntropyValues(['fullVersionList', 'platform', 'platformVersion', 'architecture', 'model']);
  } catch (e) {
    env.uaDataError = errInfo(e);
  }
  return env;
}

function apiPresence() {
  return { LanguageModel: typeof globalThis.LanguageModel, Translator: typeof globalThis.Translator, LanguageDetector: typeof globalThis.LanguageDetector };
}

// ---------- availability (Q1, Q6) ----------

const nanoOptions = (target, source = 'en') => ({
  expectedInputs: [{ type: 'text', languages: [...new Set(['en', source, target])] }],
  expectedOutputs: [{ type: 'text', languages: [target] }],
});

function parsePairs(text) {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((p) => p.split(/->|→|-|>/))
    .filter((p) => p.length === 2 && p[0] && p[1])
    .map(([sourceLanguage, targetLanguage]) => ({ sourceLanguage: sourceLanguage.trim(), targetLanguage: targetLanguage.trim() }));
}

async function probe(label, fn) {
  const t = performance.now();
  try {
    const state = await fn();
    log('availability', { label, state, took: since(t) });
    return state;
  } catch (e) {
    log('availability.error', { label, error: errInfo(e), took: since(t) });
    return undefined;
  }
}

async function availabilityAll(reason) {
  log('availability.start', { reason, apis: apiPresence(), activation: activation() });
  if (typeof globalThis.LanguageModel === 'undefined') log('availability', { label: 'LanguageModel', state: 'no API' });
  else {
    await probe('LanguageModel (no options)', () => LanguageModel.availability());
    for (const lang of NANO_LANGS) await probe(`LanguageModel en→${lang}`, () => LanguageModel.availability(nanoOptions(lang)));
    // Not a Nano output language: expected `unavailable` with the API present (the "pair not supported" reason, Q6).
    await probe('LanguageModel en→vi (unsupported output)', () => LanguageModel.availability(nanoOptions('vi')));
    if (typeof LanguageModel.params === 'function') {
      try {
        log('LanguageModel.params', { params: await LanguageModel.params() });
      } catch (e) {
        log('LanguageModel.params.error', { error: errInfo(e) });
      }
    }
  }
  if (typeof globalThis.Translator === 'undefined') log('availability', { label: 'Translator', state: 'no API' });
  else for (const p of parsePairs($('pairs').value)) await probe(`Translator ${p.sourceLanguage}→${p.targetLanguage}`, () => Translator.availability(p));
  if (typeof globalThis.LanguageDetector === 'undefined') log('availability', { label: 'LanguageDetector', state: 'no API' });
  else {
    await probe('LanguageDetector (no options)', () => LanguageDetector.availability());
    await probe('LanguageDetector [en, ja, vi]', () => LanguageDetector.availability({ expectedInputLanguages: ['en', 'ja', 'vi'] }));
  }
  log('availability.done', { reason });
}

// ---------- create Translator (Q1, Q2, Q5) ----------

const translators = new Map();

const currentPair = () => ({ sourceLanguage: $('src').value.trim(), targetLanguage: $('tgt').value.trim() });

/**
 * Calls Translator.create synchronously (no await before it), so a click handler that calls this
 * still holds its transient activation at the call.
 */
function createTranslator(mode) {
  const pair = currentPair();
  const label = `Translator ${pair.sourceLanguage}→${pair.targetLanguage} (${mode})`;
  const act = activation();
  if (typeof globalThis.Translator === 'undefined') {
    log('Translator.create.error', { label, error: { name: 'NoAPI', message: 'Translator is not defined' } });
    return;
  }
  const t = performance.now();
  let pending;
  try {
    pending = Translator.create({ ...pair, monitor: monitor(label) });
  } catch (e) {
    log('Translator.create.error', { label, activation: act, error: errInfo(e), sync: true });
    return;
  }
  log('Translator.create.called', { label, activation: act });
  void settleTranslator(pending, label, pair, t);
}

async function settleTranslator(pending, label, pair, t) {
  let translator;
  try {
    translator = await pending;
  } catch (e) {
    log('Translator.create.error', { label, error: errInfo(e), took: since(t) });
    return;
  }
  log('Translator.create.ok', { label, took: since(t), inputQuota: translator.inputQuota ?? null });
  translators.get(`${pair.sourceLanguage}→${pair.targetLanguage}`)?.destroy?.();
  translators.set(`${pair.sourceLanguage}→${pair.targetLanguage}`, translator);
  const t2 = performance.now();
  try {
    const output = await translator.translate(SAMPLE[pair.sourceLanguage] ?? SAMPLE.en);
    log('Translator.translate', { label, output, took: since(t2) });
  } catch (e) {
    log('Translator.translate.error', { label, error: errInfo(e) });
  }
  await probe(`${label} after create`, () => Translator.availability(pair));
}

// ---------- create Nano (Q2, Q5) ----------

function createNano(mode) {
  const target = $('nano-tgt').value;
  const label = `Nano en→${target} (${mode})`;
  const act = activation();
  if (typeof globalThis.LanguageModel === 'undefined') {
    log('LanguageModel.create.error', { label, error: { name: 'NoAPI', message: 'LanguageModel is not defined' } });
    return;
  }
  const t = performance.now();
  let pending;
  try {
    pending = LanguageModel.create({ ...nanoOptions(target), monitor: monitor(label) });
  } catch (e) {
    log('LanguageModel.create.error', { label, activation: act, error: errInfo(e), sync: true });
    return;
  }
  log('LanguageModel.create.called', { label, activation: act });
  pending.then(
    async (session) => {
      log('LanguageModel.create.ok', { label, took: since(t), ...limits(session) });
      session.destroy();
      await probe(`${label} after create`, () => LanguageModel.availability(nanoOptions(target)));
    },
    (e) => log('LanguageModel.create.error', { label, error: errInfo(e), took: since(t) }),
  );
}

// ---------- background (Q1, information only) ----------

function askBackground() {
  const pair = currentPair();
  log('background.ask', { ...pair });
  chrome.runtime.sendMessage({ type: 's8-create-translator', ...pair }).then(
    (result) => log('background.result', { result }),
    (e) => log('background.error', { error: errInfo(e) }),
  );
}

// A copy of this page opened with window.open from another extension page gets no chrome.runtime
// (seen in Chrome for Testing 156): log it rather than fail.
if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 's8-bg-log') log(`bg.${msg.entry.kind}`, msg.entry.data ?? {});
    return false;
  });
} else log('panel.error', { error: { name: 'NoRuntime', message: 'chrome.runtime is not defined in this page: open it as the side panel or with chrome.tabs.create' } });

// ---------- Nano harness (Q3, Q4) ----------

let stopRequested = false;
let busy = false;
let fixtures = null;
/** Block id → accepted Spanish text from the last `es` format run: the source of the `es→en` run (the fixtures are English). */
const spanish = new Map();

const windowOf = (s) => s.contextWindow ?? s.inputQuota;
const usageOf = (s) => s.contextUsage ?? s.inputUsage;
const limits = (s) => ({ contextWindow: s.contextWindow ?? null, inputQuota: s.inputQuota ?? null, contextUsage: s.contextUsage ?? null, inputUsage: s.inputUsage ?? null });

function measure(session, text) {
  if (typeof session.measureContextUsage === 'function') return session.measureContextUsage(text);
  return session.measureInputUsage(text);
}

async function loadFixtures() {
  if (fixtures) return fixtures;
  const res = await fetch(chrome.runtime.getURL('fixtures.json'));
  if (!res.ok) throw new Error(`fixtures.json: HTTP ${res.status} (run node spikes/s8/build.mjs)`);
  fixtures = await res.json();
  return fixtures;
}

/** Consecutive groups of blocks of at most `maxTokens` estimated tokens (a larger block alone). */
function chunksOf(blocks, maxTokens) {
  const out = [];
  let group = [];
  let size = 0;
  for (const b of blocks) {
    const t = E.estimateTokens(b.inlineMarkup);
    if (group.length > 0 && size + t > maxTokens) {
      out.push(group);
      group = [];
      size = 0;
    }
    group.push(b);
    size += t;
  }
  if (group.length > 0) out.push(group);
  return out;
}

async function nanoSession(system, sourceLang, target) {
  let sampling = {};
  if (typeof LanguageModel.params === 'function') {
    try {
      const params = await LanguageModel.params();
      // The product's translate temperature; topK must come with it.
      if (params) sampling = { temperature: E.TRANSLATE_TEMPERATURE, topK: params.defaultTopK };
    } catch {
      sampling = {};
    }
  }
  return LanguageModel.create({
    initialPrompts: [{ role: 'system', content: system }],
    ...nanoOptions(target, sourceLang),
    ...sampling,
    monitor: monitor(`Nano harness ${sourceLang}→${target}`),
  });
}

/**
 * One prompt on a clone of `base` (so the base keeps only the system prompt). Measures time to
 * first token and output tokens per second. `stopAfterFirst` aborts once the first piece arrives
 * (a quota probe, not a translation).
 */
async function runPrompt(base, userText, opts = {}) {
  const session = await base.clone();
  const overflow = [];
  for (const ev of ['contextoverflow', 'quotaoverflow']) session.addEventListener?.(ev, () => overflow.push(ev));
  const ac = new AbortController();
  const t0 = performance.now();
  let first = null;
  let text = '';
  let pieces = 0;
  const options = { signal: ac.signal };
  if (opts.responseConstraint) Object.assign(options, { responseConstraint: opts.responseConstraint, omitResponseConstraintInput: true });
  try {
    for await (const piece of session.promptStreaming(userText, options)) {
      if (first === null) first = performance.now();
      text += piece;
      pieces++;
      if (opts.stopAfterFirst || stopRequested) {
        ac.abort();
        break;
      }
    }
  } catch (e) {
    if (!(ac.signal.aborted && e?.name === 'AbortError')) {
      session.destroy();
      return { error: errInfo(e), ttftMs: first === null ? null : Math.round(first - t0), totalMs: since(t0), text };
    }
  }
  const t1 = performance.now();
  let outputTokens = null;
  try {
    outputTokens = text ? await measure(session, text) : 0;
  } catch {
    outputTokens = E.estimateTokens(text);
  }
  const usage = usageOf(session) ?? null;
  session.destroy();
  const genSeconds = first === null ? 0 : (t1 - first) / 1000;
  return {
    text,
    pieces,
    ttftMs: first === null ? null : Math.round(first - t0),
    totalMs: Math.round(t1 - t0),
    outputTokens,
    tokensPerSec: genSeconds > 0 && outputTokens ? Math.round((outputTokens / genSeconds) * 10) / 10 : null,
    usageAfter: usage,
    overflow,
  };
}

/** Checks Nano is ready without a download (the harness may run long after the click that started it). */
async function nanoReady(sourceLang, target) {
  if (typeof globalThis.LanguageModel === 'undefined') {
    log('harness.error', { error: { name: 'NoAPI', message: 'LanguageModel is not defined' } });
    return false;
  }
  const state = await probe(`LanguageModel ${sourceLang}→${target} (harness)`, () => LanguageModel.availability(nanoOptions(target, sourceLang)));
  if (state === 'available') return true;
  log('harness.error', { error: { name: 'NotReady', message: `Nano is "${state}" for ${sourceLang}→${target}: press "create Nano" first and wait for the download` } });
  return false;
}

function harness(name, fn) {
  return async () => {
    if (busy) return;
    busy = true;
    stopRequested = false;
    status(`${name} running…`);
    const t = performance.now();
    try {
      await fn();
    } catch (e) {
      log(`${name}.error`, { error: errInfo(e) });
    } finally {
      busy = false;
      status(`${name} done in ${Math.round(since(t) / 1000)} s`);
    }
  };
}

// Q4: the context window as the session reports it.
async function q4Limits() {
  const target = $('nano-tgt').value;
  if (!(await nanoReady('en', target))) return;
  const base = await nanoSession(E.systemPrompt('en', target), 'en', target);
  log('q4.limits', { target, ...limits(base), systemPromptTokens: usageOf(base) ?? null, systemPromptTokensEstimated: E.estimateTokens(E.systemPrompt('en', target)) });
  base.destroy();
}

/** The first blocks of `blocks` whose estimated tokens reach `tokens`. */
function blocksUpTo(blocks, tokens) {
  const out = [];
  let n = 0;
  for (const b of blocks) {
    if (n >= tokens) break;
    out.push(b);
    n += E.estimateTokens(b.inlineMarkup);
  }
  return out;
}

function wireOf(blocks) {
  const wire = E.toWire(blocks.map(E.asSegment));
  return { wire, text: E.formatWire(wire) };
}

// Q4: time to first token and tokens/s on a ~1,200-token chunk (the product's marker prompt).
async function q4Speed() {
  const target = $('nano-tgt').value;
  if (!(await nanoReady('en', target))) return;
  const fx = await loadFixtures();
  const blocks = blocksUpTo(fx.blocks['goblog-pipelines'], 1200);
  const { wire, text } = wireOf(blocks);
  const base = await nanoSession(E.systemPrompt('en', target), 'en', target);
  const inputTokens = await measure(base, text);
  const r = await runPrompt(base, text);
  base.destroy();
  const parsed = r.error ? null : parseMarkers(wire, r.text);
  log('q4.speed', {
    target,
    segments: blocks.length,
    inputTokens,
    inputTokensEstimated: E.estimateTokens(text),
    ...omitText(r),
    outputInputRatio: r.outputTokens && inputTokens ? Math.round((r.outputTokens / inputTokens) * 100) / 100 : null,
    failedSegments: parsed?.failed.length ?? null,
    output: r.text?.slice(0, 1500),
  });
}

const omitText = ({ text, ...rest }) => rest;

// Q4: the largest chunk the session accepts with the system prompt, then one full translation at
// the size that leaves room for the output.
async function q4Max() {
  const target = $('nano-tgt').value;
  if (!(await nanoReady('en', target))) return;
  const fx = await loadFixtures();
  const base = await nanoSession(E.systemPrompt('en', target), 'en', target);
  const ctxWindow = windowOf(base);
  const system = usageOf(base) ?? 0;
  const all = fx.slugs.flatMap((s) => fx.blocks[s]);
  // Enough blocks to overflow the window, repeating the fixtures if they are short.
  const pool = [];
  for (let est = 0; est < ctxWindow * 1.5 && pool.length < all.length * 8; ) {
    const b = all[pool.length % all.length];
    pool.push({ ...b, id: `${b.id}#${pool.length}` });
    est += E.estimateTokens(b.inlineMarkup);
  }
  const tokensFor = async (k) => measure(base, wireOf(pool.slice(0, k)).text);
  // Largest k with system + input <= window (binary search on the measured count).
  let lo = 0;
  let hi = pool.length;
  while (lo < hi) {
    if (stopRequested) return base.destroy();
    const mid = Math.ceil((lo + hi) / 2);
    if (system + (await tokensFor(mid)) <= ctxWindow) lo = mid;
    else hi = mid - 1;
  }
  const maxInput = lo > 0 ? await tokensFor(lo) : 0;
  log('q4.max.measured', { target, contextWindow: ctxWindow, systemPromptTokens: system, maxSegments: lo, maxInputTokens: maxInput, maxInputTokensEstimated: E.estimateTokens(wireOf(pool.slice(0, lo)).text) });
  // Confirm with real prompts: k accepted, k + 1 rejected (QuotaExceededError expected).
  for (const k of [lo, lo + 1]) {
    if (k < 1 || k > pool.length) continue;
    const r = await runPrompt(base, wireOf(pool.slice(0, k)).text, { stopAfterFirst: true });
    log('q4.max.confirm', { segments: k, inputTokens: await tokensFor(k), ok: !r.error, ...(r.error ? { error: r.error } : { ttftMs: r.ttftMs }) });
  }
  // The output shares the window: a translation is about as long as its source. Try half the room.
  const room = ctxWindow - system;
  let k = lo;
  while (k > 1 && (await tokensFor(k)) > room / 2) k--;
  const { wire, text } = wireOf(pool.slice(0, k));
  const inputTokens = k > 0 ? await tokensFor(k) : 0;
  const r = await runPrompt(base, text);
  base.destroy();
  const parsed = r.error ? null : parseMarkers(wire, r.text);
  log('q4.max.roundtrip', {
    segments: k,
    inputTokens,
    inputTokensEstimated: E.estimateTokens(text),
    ...omitText(r),
    failedSegments: parsed?.failed.length ?? null,
    failures: parsed?.kinds ?? null,
  });
}

// ---------- Q3: markers vs JSON ----------

/** The product's parse of a marker answer: failed = the ids the repair plan would re-request. */
function parseMarkers(wire, text) {
  const ids = wire.segments.map((e) => e.n);
  const result = E.parseOutput(text, ids, 'end', { grammar: wire.grammar, ...(wire.nonce === undefined ? {} : { nonce: wire.nonce }) });
  const plan = E.planRepair(result, new Map(wire.segments.map((e) => [e.n, e.segment.inlineMarkup])));
  const kinds = {};
  const add = (k, list) => list.length && (kinds[k] = list.length);
  add('missing', result.missing);
  add('merged', plan.merged);
  add('empty', plan.empty);
  add('truncated', plan.truncated);
  add('tagMismatch', plan.tagMismatch);
  if (plan.ambiguous) kinds.ambiguous = 1;
  if (result.stray.trim()) kinds.stray = 1;
  const failed = new Set(plan.rerequest);
  const accepted = new Map();
  for (const e of wire.segments) if (!failed.has(e.n) && result.segs.has(e.n)) accepted.set(e.segment.id, result.segs.get(e.n).trim());
  return { failed: [...failed], kinds, strict: result.strict, fixes: result.fixes.map((f) => f.kind), accepted };
}

/** A JSON-array answer: whole-chunk failure on a parse error or a wrong count; empty or marker-carrying items fail alone. */
function parseJson(wire, text) {
  const n = wire.segments.length;
  let arr;
  try {
    arr = JSON.parse(text.trim());
  } catch {
    return { failed: wire.segments.map((e) => e.n), kinds: { invalidJson: 1 }, accepted: new Map() };
  }
  if (!Array.isArray(arr) || arr.some((x) => typeof x !== 'string')) return { failed: wire.segments.map((e) => e.n), kinds: { notStringArray: 1 }, accepted: new Map() };
  if (arr.length !== n) return { failed: wire.segments.map((e) => e.n), kinds: { wrongCount: 1, got: arr.length, expected: n }, accepted: new Map() };
  const failed = [];
  const kinds = {};
  const accepted = new Map();
  wire.segments.forEach((e, i) => {
    const t = arr[i].trim();
    const bad = t === '' ? 'empty' : /<\s*\/?\s*seg\b/i.test(t) && !/<\s*\/?\s*seg\b/i.test(e.segment.inlineMarkup) ? 'markerLeak' : null;
    if (bad) {
      failed.push(e.n);
      kinds[bad] = (kinds[bad] ?? 0) + 1;
    } else accepted.set(e.segment.id, t);
  });
  return { failed, kinds, accepted };
}

const jsonSchema = (n) => ({ type: 'array', items: { type: 'string' }, minItems: n, maxItems: n });

async function q3Format() {
  const target = $('nano-tgt').value;
  const fx = await loadFixtures();
  // The fixtures are English: the `en` target translates back the Spanish an earlier `es` run produced.
  const sourceLang = target === 'en' ? 'es' : 'en';
  if (target === 'en' && spanish.size === 0) {
    log('q3.error', { error: { name: 'NoSource', message: 'the fixtures are English: run Q3 with target es first, then en (es→en uses its output)' } });
    return;
  }
  if (!(await nanoReady(sourceLang, target))) return;
  const chunkTokens = Number($('chunk-tokens').value) || 1000;
  const perFixture = Number($('chunks').value) || 3;
  const bases = {
    markers: await nanoSession(E.systemPrompt(sourceLang, target), sourceLang, target),
    json: await nanoSession(E.systemPromptJson(sourceLang, target), sourceLang, target),
  };
  const totals = { markers: { chunks: 0, chunksFailed: 0, segments: 0, segmentsFailed: 0, errors: 0 }, json: { chunks: 0, chunksFailed: 0, segments: 0, segmentsFailed: 0, errors: 0 } };
  try {
    for (const slug of fx.slugs) {
      let blocks = fx.blocks[slug];
      if (target === 'en') blocks = blocks.filter((b) => spanish.has(b.id)).map((b) => ({ ...b, inlineMarkup: spanish.get(b.id) }));
      for (const [ci, chunk] of chunksOf(blocks, chunkTokens).slice(0, perFixture).entries()) {
        const { wire, text } = wireOf(chunk);
        for (const format of ['markers', 'json']) {
          if (stopRequested) return;
          const r = await runPrompt(bases[format], text, format === 'json' ? { responseConstraint: jsonSchema(chunk.length) } : {});
          const t = totals[format];
          t.chunks++;
          t.segments += chunk.length;
          if (r.error) {
            t.errors++;
            t.chunksFailed++;
            t.segmentsFailed += chunk.length;
            log('q3.chunk', { format, slug, chunk: ci, target, segments: chunk.length, error: r.error });
            continue;
          }
          const parsed = format === 'markers' ? parseMarkers(wire, r.text) : parseJson(wire, r.text);
          if (parsed.failed.length) t.chunksFailed++;
          t.segmentsFailed += parsed.failed.length;
          if (target === 'es') for (const [id, s] of parsed.accepted) if (format === 'markers' || !spanish.has(id)) spanish.set(id, s);
          log('q3.chunk', {
            format,
            slug,
            chunk: ci,
            target,
            segments: chunk.length,
            inputTokensEstimated: E.estimateTokens(text),
            ...omitText(r),
            failedSegments: parsed.failed.length,
            failures: parsed.kinds,
            ...(parsed.fixes?.length ? { parserFixes: parsed.fixes } : {}),
            output: r.text.slice(0, 2000),
          });
        }
      }
    }
  } finally {
    bases.markers.destroy();
    bases.json.destroy();
    for (const [format, t] of Object.entries(totals)) {
      log('q3.summary', { format, sourceLang, target, chunkTokens, ...t, segmentFailureRate: t.segments ? Math.round((t.segmentsFailed / t.segments) * 1000) / 1000 : null });
    }
  }
}

// ---------- wiring ----------

$('avail').addEventListener('click', () => void availabilityAll('button'));
$('tr-click').addEventListener('click', () => createTranslator('in click'));
$('tr-deferred').addEventListener('click', () => {
  log('Translator.create.scheduled', { delayMs: 10_000 });
  setTimeout(() => createTranslator('deferred 10 s'), 10_000);
});
$('bg').addEventListener('click', askBackground);
$('nano-click').addEventListener('click', () => createNano('in click'));
$('nano-deferred').addEventListener('click', () => {
  log('LanguageModel.create.scheduled', { delayMs: 10_000 });
  setTimeout(() => createNano('deferred 10 s'), 10_000);
});
$('q4-limits').addEventListener('click', harness('q4.limits', q4Limits));
$('q4-speed').addEventListener('click', harness('q4.speed', q4Speed));
$('q4-max').addEventListener('click', harness('q4.max', q4Max));
$('q3-format').addEventListener('click', harness('q3', q3Format));
$('stop').addEventListener('click', () => {
  stopRequested = true;
  log('harness.stop');
});
$('clear').addEventListener('click', () => {
  LOG.length = 0;
  $('log').textContent = '';
});
$('copy').addEventListener('click', async () => {
  const json = JSON.stringify({ spike: 'S8', env: await environment(), log: LOG }, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    status(`copied ${LOG.length} entries`);
  } catch (e) {
    // Clipboard denied (panel not focused): show the JSON for a manual copy.
    const area = document.createElement('textarea');
    area.value = json;
    area.rows = 10;
    area.style.width = '100%';
    $('log').before(area);
    area.select();
    status(`clipboard failed (${errInfo(e).message}): JSON selected below`);
  }
});

for (const id of ['auto-avail', 'auto-create']) {
  $(id).addEventListener('change', () => void chrome.storage.local.set({ [id]: $(id).checked }));
}

async function start() {
  const env = await environment();
  log('panel.load', env);
  if (!E) log('panel.error', { error: { name: 'NoEngine', message: 'engine.js missing: run node spikes/s8/build.mjs' } });
  const saved = await chrome.storage.local.get(['auto-avail', 'auto-create']);
  if (saved['auto-avail'] !== undefined) $('auto-avail').checked = saved['auto-avail'];
  $('auto-create').checked = saved['auto-create'] === true;
  // Q2: creation with no click at all (the panel just opened).
  if ($('auto-create').checked) {
    createTranslator('at panel load, no click');
    createNano('at panel load, no click');
  }
  if ($('auto-avail').checked) await availabilityAll('panel load');
}

void start().catch((e) => log('panel.error', { error: errInfo(e) }));
