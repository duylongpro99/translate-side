import { describe, expect, it } from 'vitest';
import { BUDGET_MESSAGE, CHECK_MESSAGE, type EngineEvent, type Segment, type TranslationJob } from '@/engine/index';
import { translatorClient, wireLines, renderLines } from '@/engine/testing';
import type { LLMClient, LLMError, NormalizedRequest } from '@/llm/types';
import { GEMINI_PROFILE } from '@/shared/settings';
import { applySegmentEvent, Gate, Jobs, type ClientResult, type JobDoc, type JobView, type SegState } from './jobs.ts';
import { failureText } from './status.ts';

const by = { strategy: 'single-pass', stage: 'translate', model: 'm' };
const final = (id: string, text: string, revision = 1, attempt?: number): EngineEvent => ({ type: 'segment.final', id, text, revision, producedBy: by, ...(attempt === undefined ? {} : { attempt }) });
const failedEv = (id: string, error: LLMError = { kind: 'unknown', message: 'x' }, revision?: number): EngineEvent => ({ type: 'segment.failed', id, error, ...(revision === undefined ? {} : { revision }) });
/** What the check stage sends for a text that failed its checks twice. */
const checkFailed = (id: string, revision: number): EngineEvent => failedEv(id, { kind: 'unknown', message: CHECK_MESSAGE, raw: { reason: 'check', outcome: 'failed-again', checks: [{ kind: 'code', detail: 'missing `poll`' }] } }, revision);
const partial = (id: string, text: string): EngineEvent => ({ type: 'segment.partial', id, text });

function fold(events: EngineEvent[]): SegState | undefined {
  return events.reduce<SegState | undefined>((s, e) => applySegmentEvent(s, e), undefined);
}

describe('applySegmentEvent: the §5.2 panel rule', () => {
  it('previews partials, then settles on the final', () => {
    expect(fold([partial('a', 'Xin'), partial('a', 'Xin chào')])).toEqual({ status: 'streaming', text: 'Xin chào' });
    expect(fold([partial('a', 'Xin'), final('a', 'Xin chào.')])).toMatchObject({ status: 'final', text: 'Xin chào.', revision: 1, attempt: 1 });
  });

  it('a partial never replaces a final or a failure', () => {
    expect(fold([final('a', 'one'), partial('a', 'tw')])).toMatchObject({ status: 'final', text: 'one' });
    expect(fold([failedEv('a'), partial('a', 'tw')])).toMatchObject({ status: 'failed' });
  });

  it('same revision: a higher attempt replaces in place, a lower or equal one does not (review B-N1)', () => {
    expect(fold([final('a', 'first'), final('a', 'repaired', 1, 2)])).toMatchObject({ text: 'repaired', attempt: 2 });
    expect(fold([final('a', 'repaired', 1, 2), final('a', 'stale', 1, 1)])).toMatchObject({ text: 'repaired', attempt: 2 });
    expect(fold([final('a', 'first'), final('a', 'again')])).toMatchObject({ text: 'first' });
  });

  it('a later failure replaces any attempt of the first-pass revision (review B-N1)', () => {
    const s = fold([final('a', 'first'), final('a', 'repaired', 1, 2), failedEv('a')]);
    expect(s).toMatchObject({ status: 'failed' });
    expect(s?.text).toBeUndefined();
  });

  it('a higher revision always wins, and survives a failure of a later pass', () => {
    expect(fold([final('a', 'draft'), final('a', 'refined', 2)])).toMatchObject({ text: 'refined', revision: 2 });
    expect(fold([final('a', 'refined', 2), final('a', 'draft repaired', 1, 3)])).toMatchObject({ text: 'refined' });
    expect(fold([final('a', 'refined', 2), failedEv('a')])).toMatchObject({ status: 'final', text: 'refined' });
    expect(fold([failedEv('a'), final('a', 'refined', 2)])).toMatchObject({ status: 'final', text: 'refined' });
  });
});

describe('applySegmentEvent: check failures (review D-B1)', () => {
  it('a failure naming the shown revision replaces it, revision 2 included: the text is gone', () => {
    const s = fold([final('a', 'draft'), final('a', 'revised, lost a code span', 2), checkFailed('a', 2)]);
    expect(s).toMatchObject({ status: 'failed', revision: 2, error: { message: CHECK_MESSAGE } });
    expect(s?.text).toBeUndefined();
    expect(fold([final('a', 'draft'), checkFailed('a', 1)])).toMatchObject({ status: 'failed', revision: 1 });
  });

  it('a failure naming a lower revision only adds the error to a higher one', () => {
    expect(fold([final('a', 'revised', 2), checkFailed('a', 1)])).toMatchObject({ status: 'final', text: 'revised', revision: 2, error: { message: CHECK_MESSAGE } });
  });

  it('after a check failure of revision 2, a late revision-1 final does not bring a text back', () => {
    expect(fold([final('a', 'revised', 2), checkFailed('a', 2), final('a', 'draft repaired', 1, 2)])).toMatchObject({ status: 'failed' });
  });
});

describe('Gate', () => {
  it('holds waiters while closed and releases them when opened; an abort rejects', async () => {
    const g = new Gate();
    g.set(false);
    let passed = false;
    const p = g.wait(new AbortController().signal).then(() => (passed = true));
    await Promise.resolve();
    expect(passed).toBe(false);
    g.set(true);
    await p;
    expect(passed).toBe(true);
    g.set(false);
    const ac = new AbortController();
    const q = g.wait(ac.signal);
    ac.abort(new Error('gone'));
    await expect(q).rejects.toThrow('gone');
  });
});

// ---- Jobs over the real engine (single-pass) and a scripted client ----------------------------

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
/** `n` paragraphs of ~`w` words each, plus a code block the engine must skip. */
function doc(n: number, w = 120): JobDoc {
  const segments: Segment[] = Array.from({ length: n }, (_, i) => {
    const text = `P${i} ${words(w)}`;
    return { id: `s${i}`, kind: 'p', text, inlineMarkup: text, domPath: `/p[${i + 1}]`, translate: true };
  });
  segments.splice(1, 0, { id: 'code', kind: 'code', text: 'fn main() {}', inlineMarkup: 'fn main() {}', domPath: '/pre[1]', translate: false });
  return { url: 'https://example.com/', title: 'T', sourceLang: 'en', targetLang: 'vi', segments };
}

/** Counts streams in flight; `hold` makes each stream wait for `release()` before it answers. */
function instrumented(inner: LLMClient, { hold = false } = {}) {
  let active = 0;
  let peak = 0;
  const releases: (() => void)[] = [];
  const signals: AbortSignal[] = [];
  const client: LLMClient = {
    model: inner.model,
    reasoningReserveTokens: () => 0,
    async *stream(req: NormalizedRequest) {
      signals.push(req.signal);
      active++;
      peak = Math.max(peak, active);
      try {
        if (hold) {
          yield { type: 'text', delta: '<seg id="1"' };
          await new Promise<void>((resolve, reject) => {
            releases.push(resolve);
            req.signal.addEventListener('abort', () => reject(req.signal.reason), { once: true });
          });
        }
        yield* inner.stream(req);
      } finally {
        active--;
      }
    },
  };
  return {
    client,
    get active() {
      return active;
    },
    get peak() {
      return peak;
    },
    signals,
    releaseAll: () => releases.splice(0).forEach((r) => r()),
  };
}

const ok = (client: LLMClient): (() => Promise<ClientResult>) => () => Promise.resolve({ ok: true, client, profile: GEMINI_PROFILE });
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await settle(2);
  }
}

// The M1 lifecycle tests count requests: they run single-pass (no brief call). Contextual is below.
describe('Jobs (plan M1-E8)', () => {
  it('translates a page with 2 chunks in flight, shows every final, and prices the usage', async () => {
    const t = instrumented(translatorClient(undefined, { model: GEMINI_PROFILE.model }));
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: ok(t.client) });
    jobs.setActive(1);
    let previews = 0;
    jobs.subscribe((_, v) => (previews += [...(v?.segs.values() ?? [])].filter((s) => s.status === 'streaming').length));
    // 12 × ~125 tokens over 1,200-token chunks: several chunks.
    await jobs.start(1, 'd', doc(30));
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('done');
    expect(v.counts).toEqual({ total: 30, final: 30, failed: 0 });
    expect(t.signals.length).toBeGreaterThan(2);
    expect(t.peak).toBe(2);
    expect([...v.segs.values()].every((s) => s.status === 'final' && s.text?.startsWith('vi:P'))).toBe(true);
    expect(v.segs.has('code')).toBe(false);
    expect(v.usage.input).toBeGreaterThan(0);
    expect(v.cost).toBeCloseTo((v.usage.input * 0.3 + v.usage.output * 2.5) / 1e6, 12);
    expect(v.firstVisibleAt).toBeDefined();
    // Previews were shown before the finals.
    expect(previews).toBeGreaterThan(0);
  });

  it('cancel stops the requests, keeps the finals, and drops the previews', async () => {
    const t = instrumented(translatorClient(), { hold: true });
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: ok(t.client) });
    jobs.setActive(1);
    const run = jobs.start(1, 'd', doc(30));
    await until(() => t.active === 2);
    // Let the first chunk finish, so some segments are final.
    const first = t.signals.length;
    t.releaseAll();
    await until(() => (jobs.get(1)?.counts.final ?? 0) > 0 && t.signals.length > first && t.active === 2);
    const finals = jobs.get(1)?.counts.final ?? 0;
    jobs.cancel(1);
    await run;
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('cancelled');
    expect(t.signals.every((s) => s.aborted || t.signals.indexOf(s) < first)).toBe(true);
    expect(t.active).toBe(0);
    expect(v.counts.final).toBe(finals);
    expect([...v.segs.values()].some((s) => s.status === 'streaming')).toBe(false);
    const requests = t.signals.length;
    await settle(50);
    expect(t.signals.length).toBe(requests);
  });

  it('resume translates only what is left, and the cost adds up across runs', async () => {
    const t = instrumented(translatorClient(), { hold: true });
    let current = t.client;
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: () => ok(current)() });
    jobs.setActive(1);
    const run = jobs.start(1, 'd', doc(30));
    await until(() => t.active === 2);
    t.releaseAll();
    await until(() => (jobs.get(1)?.counts.final ?? 0) > 0 && t.active === 2);
    jobs.cancel(1);
    await run;
    const before = jobs.get(1) as JobView;
    const done = [...before.segs].filter(([, s]) => s.status === 'final').map(([id]) => id);

    const sent: string[] = [];
    const again = translatorClient((lines, _call, req) => {
      sent.push(...wireLines(req.messages[0]?.content ?? '').map((l) => l.source.split(' ')[0] ?? ''));
      return renderLines(lines, (s) => `vi:${s}`);
    });
    current = again;
    await jobs.resume(1);
    const after = jobs.get(1) as JobView;
    expect(after.status).toBe('done');
    expect(after.counts.final).toBe(30);
    // No final was sent again.
    expect(sent.some((p) => done.includes(`s${p.slice(1)}`))).toBe(false);
    expect(after.usage.input).toBeGreaterThan(before.usage.input);
    expect(after.cost ?? 0).toBeGreaterThan(before.cost ?? 0);
  });

  it('D14: a background tab sends no new request until it is active; streams already running finish', async () => {
    const a = instrumented(translatorClient(), { hold: true });
    const b = instrumented(translatorClient(), { hold: true });
    const clients: Record<number, LLMClient> = { 1: a.client, 2: b.client };
    let next = 1;
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: () => ok(clients[next++] as LLMClient)() });
    jobs.setActive(1);
    const runA = jobs.start(1, 'a', doc(30));
    await until(() => a.active === 2);
    // Tab 2's job starts while tab 1 is active: it is paused and sends nothing.
    const runB = jobs.start(2, 'b', doc(30));
    await settle(30);
    expect(jobs.get(2)?.paused).toBe(true);
    expect(b.signals.length).toBe(0);

    // Switch to tab 2: tab 1 pauses. Its 2 running streams finish, and no new one starts.
    jobs.setActive(2);
    expect(jobs.get(1)?.paused).toBe(true);
    expect(jobs.get(2)?.paused).toBe(false);
    await until(() => b.active === 2);
    const sentA = a.signals.length;
    a.releaseAll();
    await until(() => a.active === 0);
    await settle(30);
    expect(a.signals.length).toBe(sentA);
    expect(jobs.get(1)?.counts.final).toBeGreaterThan(0);

    // Back to tab 1: it resumes.
    jobs.setActive(1);
    await until(() => a.signals.length > sentA);
    for (const t of [a, b]) {
      const timer = setInterval(t.releaseAll, 2);
      await (t === a ? runA : (jobs.setActive(2), runB));
      clearInterval(timer);
    }
    expect(jobs.get(1)?.status).toBe('done');
    expect(jobs.get(2)?.status).toBe('done');
  });

  it('a cancelled background job stops waiting at the gate', async () => {
    const t = instrumented(translatorClient());
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: ok(t.client) });
    jobs.setActive(5);
    const run = jobs.start(1, 'd', doc(5));
    await settle(20);
    jobs.cancel(1);
    await run;
    expect(jobs.get(1)?.status).toBe('cancelled');
    expect(t.signals.length).toBe(0);
  });

  it('stops the job at the first auth failure instead of failing every chunk', async () => {
    let calls = 0;
    const bad: LLMClient = {
      model: 'm',
      reasoningReserveTokens: () => 0,
      async *stream() {
        calls++;
        await settle(5);
        yield { type: 'error', error: { kind: 'auth', status: 401, message: 'Key invalid or missing' } };
      },
    };
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: ok(bad) });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc(30));
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('stopped');
    expect(v.stopError?.kind).toBe('auth');
    expect(calls).toBeLessThanOrEqual(2);
  });

  it('stops before any request when there is no key or no access', async () => {
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: () => Promise.resolve({ ok: false, error: { kind: 'cors', cause: 'permission', message: 'No access to x' } }) });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc(3));
    expect(jobs.get(1)).toMatchObject({ status: 'stopped', stopError: { kind: 'cors', cause: 'permission' } });
    expect(jobs.get(1)?.counts).toEqual({ total: 3, final: 0, failed: 0 });
  });

  it('a stopped job ignores late segment events of the other chunk in flight, but still counts their usage (review E-R2)', async () => {
    const auth: LLMError = { kind: 'auth', status: 401, message: 'Key invalid or missing' };
    const engine = () => ({
      async *translate() {
        yield partial('s1', 'vi:P1 wo');
        yield failedEv('s0', auth);
        // The other chunk had not noticed the abort yet.
        yield partial('s1', 'vi:P1 word0 word1');
        yield final('s2', 'vi:P2');
        yield { type: 'usage', input: 1000, output: 500 } as EngineEvent;
      },
    });
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: ok(translatorClient()), engine: engine as never });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc(3));
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('stopped');
    expect(v.segs.get('s1')).toEqual({ status: 'pending' });
    expect(v.segs.get('s2')).toEqual({ status: 'pending' });
    expect(v.counts).toEqual({ total: 3, final: 0, failed: 1 });
    expect(v.usage).toEqual({ input: 1000, cachedInput: 0, output: 500 });
  });

  it('a revision 2 that failed its checks is counted failed and shows no text (review D-B1)', async () => {
    const engine = () => ({
      async *translate() {
        yield final('s0', 'vi:P0');
        yield final('s1', 'vi:P1');
        yield final('s2', 'vi:P2');
        yield final('s0', 'vi:P0 revised', 2);
        yield checkFailed('s0', 2);
        yield { type: 'done' } as EngineEvent;
      },
    });
    const jobs = new Jobs({ strategy: 'contextual', translateClient: ok(translatorClient()), engine: engine as never });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc(3));
    const v = jobs.get(1) as JobView;
    expect(v.segs.get('s0')).toMatchObject({ status: 'failed', revision: 2 });
    expect(v.segs.get('s0')?.text).toBeUndefined();
    expect(v.counts).toEqual({ total: 3, final: 2, failed: 1 });
  });

  it('resume sends a segment that failed its checks again, and only that one (review D-N9)', async () => {
    const sent: string[][] = [];
    let run = 0;
    const engine = () => ({
      async *translate(job: TranslationJob) {
        run++;
        const ids = job.doc.segments.filter((s) => s.translate).map((s) => s.id);
        sent.push(ids);
        for (const id of ids) yield final(id, `vi:${id}`);
        // The first run's check fails s1 for good; the resumed run's passes.
        if (run === 1) yield checkFailed('s1', 1);
        yield { type: 'done' } as EngineEvent;
      },
    });
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: ok(translatorClient()), engine: engine as never });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc(3));
    expect(jobs.get(1)?.counts).toEqual({ total: 3, final: 2, failed: 1 });
    await jobs.resume(1);
    expect(sent).toEqual([['s0', 's1', 's2'], ['s1']]);
    const v = jobs.get(1) as JobView;
    expect(v.counts).toEqual({ total: 3, final: 3, failed: 0 });
    expect(v.segs.get('s1')).toMatchObject({ status: 'final', text: 'vi:s1' });
  });

  it('counts the requests a cancel cut off before their usage arrived; one still waiting at the gate is not one (review E-T2)', async () => {
    const t = instrumented(translatorClient(), { hold: true });
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: ok(t.client) });
    jobs.setActive(1);
    const run = jobs.start(1, 'd', doc(30));
    await until(() => t.active === 2);
    jobs.cancel(1);
    await run;
    await until(() => (jobs.get(1)?.unmetered ?? 0) === 2);
    // No usage at all yet, but the readout exists, so it can say what it leaves out.
    expect(jobs.get(1)?.cost).toBe(0);

    const bg = new Jobs({ strategy: 'single-pass', translateClient: ok(instrumented(translatorClient()).client) });
    bg.setActive(5);
    const waiting = bg.start(1, 'd', doc(5));
    await settle(20);
    bg.cancel(1);
    await waiting;
    expect(bg.get(1)?.unmetered).toBe(0);
  });

  it('a restart in other languages keeps the earlier runs in the page cost (review E-R3)', async () => {
    const t = instrumented(translatorClient(), { hold: true });
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: ok(t.client) });
    jobs.setActive(1);
    const first = jobs.start(1, 'd', doc(30));
    await until(() => t.active === 2);
    t.releaseAll();
    await until(() => (jobs.get(1)?.usage.input ?? 0) > 0 && t.active === 2);
    const spent = jobs.get(1) as JobView;
    const restart = jobs.start(1, 'd', { ...doc(30), targetLang: 'ja' }, { keepCost: true });
    const v = jobs.get(1) as JobView;
    expect(v.targetLang).toBe('ja');
    expect(v.counts.final).toBe(0);
    expect(v.usage).toEqual(spent.usage);
    expect(v.cost).toBe(spent.cost);
    // The 2 requests the restart cut off are flagged, not estimated.
    expect(v.unmetered).toBe(2);
    const timer = setInterval(t.releaseAll, 2);
    await Promise.all([first, restart]);
    expect(jobs.get(1)?.cost ?? 0).toBeGreaterThan(spent.cost ?? 0);
    // Another document starts from zero.
    const other = jobs.start(1, 'd2', doc(1), { keepCost: true });
    expect(jobs.get(1)?.usage).toEqual({ input: 0, cachedInput: 0, output: 0 });
    expect(jobs.get(1)?.unmetered).toBe(0);
    await other;
    clearInterval(timer);
  });

  it('a new document in the tab replaces its job; drop forgets it', async () => {
    const t = instrumented(translatorClient(), { hold: true });
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: ok(t.client) });
    jobs.setActive(1);
    const first = jobs.start(1, 'd1', doc(30));
    await until(() => t.active === 2);
    const second = jobs.start(1, 'd2', doc(2));
    await until(() => t.signals.length === 3);
    expect(t.signals.slice(0, 2).every((s) => s.aborted)).toBe(true);
    expect(jobs.docOf(1)).toBe('d2');
    jobs.drop(1);
    await Promise.all([first, second]);
    expect(jobs.get(1)).toBeUndefined();
    expect(t.signals.every((s) => s.aborted)).toBe(true);
  });
});

describe('failureText (basic status, §4.3.5)', () => {
  it('says a budget skip plainly (review C-N8), and names the error class otherwise', () => {
    expect(failureText({ kind: 'unknown', message: BUDGET_MESSAGE })).toMatch(/budget/);
    expect(failureText({ kind: 'unknown', message: BUDGET_MESSAGE })).not.toBe(BUDGET_MESSAGE);
    expect(failureText({ kind: 'rate_limit', message: '429' })).toMatch(/busy/);
    expect(failureText({ kind: 'quota', message: 'credits' })).toMatch(/allowance.*credits/);
  });
});

describe('Jobs: contextual (plan M2-E1) and same-language skip (M2-E5)', () => {
  const BRIEF = { language: 'de', genre: 'blog post', audience: 'developers', purpose: 'explain', tone: 'dry', glossary: [{ term: 'future', rendering: 'future' }] };
  const isAnalyze = (req: NormalizedRequest) => req.system.startsWith('You prepare a translator');
  /** Answers the brief call with `brief` and every translate call with `vi:<source>`. */
  const both = (brief: string) => translatorClient((lines, _n, req) => (isAnalyze(req) ? brief : renderLines(lines, (src) => `vi:${src}`)), { model: GEMINI_PROFILE.model });

  it('runs contextual by default: the brief lands in the view, its usage in the cost, its language when the job had none', async () => {
    const client = both(JSON.stringify(BRIEF));
    const jobs = new Jobs({ translateClient: ok(client) });
    jobs.setActive(1);
    await jobs.start(1, 'd', { ...doc(3, 700), sourceLang: '' });
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('done');
    expect(v.brief).toEqual(BRIEF);
    expect(v.sourceLang).toBe('de');
    expect(v.counts).toEqual({ total: 3, final: 3, failed: 0 });
    expect(client.requests.filter(isAnalyze)).toHaveLength(1);
    // Every request is metered: the brief call's usage is in the page total.
    const expected = client.requests.reduce((n, r) => n + 10 * Math.max(1, wireLines(r.messages[0]?.content ?? '').length), 0);
    expect(v.usage.input).toBe(expected);
    expect(expected).toBeGreaterThan(10 * 3);
  });

  it('§4.3.1/§5.1: an analyze role routed to its own profile runs the brief on that client, priced with that profile', async () => {
    const translate = both('{"not":"asked"}');
    const analyze = translatorClient((lines, _n, req) => (isAnalyze(req) ? JSON.stringify(BRIEF) : renderLines(lines, (src) => `WRONG:${src}`)), { model: 'brief-model' });
    const analyzeProfile = { ...GEMINI_PROFILE, id: 'brief', model: 'brief-model', pricing: { inPerM: 100, cachedInPerM: 100, outPerM: 100 } };
    const targets: unknown[] = [];
    const deltas: { usd?: number | undefined }[] = [];
    const jobs = new Jobs({
      translateClient: (target) => (targets.push(target), Promise.resolve({ ok: true, client: translate, profile: GEMINI_PROFILE, analyze: () => Promise.resolve({ ok: true as const, client: analyze, profile: analyzeProfile }) })),
      onSpend: (d) => deltas.push(d),
    });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc(3, 700));
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('done');
    expect(targets).toEqual([{ tabId: 1, url: expect.any(String), analyze: true }]);
    expect(v.brief).toEqual(BRIEF);
    expect(analyze.requests.length).toBeGreaterThan(0);
    expect(analyze.requests.every(isAnalyze)).toBe(true);
    expect(translate.requests.filter(isAnalyze)).toHaveLength(0);
    expect([...v.segs.values()].every((s) => s.text?.startsWith('vi:'))).toBe(true);
    // The page cost is each call priced with its own profile: the per-call deltas add up to it, and
    // it is more than the whole usage at the translate price (the brief model costs more).
    const sum = deltas.reduce((a, d) => a + (d.usd ?? 0), 0);
    expect(v.cost).toBeCloseTo(sum, 12);
    expect(v.cost ?? 0).toBeGreaterThan(((v.usage.input - v.usage.cachedInput) * 0.3 + v.usage.cachedInput * 0.03 + v.usage.output * 2.5) / 1e6);
  });

  it('the analyze route is resolved only when a brief is asked for: a kept brief needs none, a missing one stops on its connection (review B-2 a)', async () => {
    let asked = 0;
    let analyzeOk = true;
    const client = both(JSON.stringify(BRIEF));
    const gemini = { id: 'gemini', label: 'Google Gemini' };
    const jobs = new Jobs({
      translateClient: () =>
        Promise.resolve({
          ok: true,
          client,
          profile: GEMINI_PROFILE,
          analyze: () => {
            asked++;
            return Promise.resolve(analyzeOk ? undefined : { ok: false as const, error: { kind: 'auth' as const, message: 'Add your Google Gemini API key in settings' }, connection: gemini });
          },
        }),
    });
    jobs.setActive(1);
    // Routed to the translate profile: the translate client asks for the brief.
    await jobs.start(1, 'd', doc(3, 700));
    expect(asked).toBe(1);
    expect(jobs.get(1)?.brief).toEqual(BRIEF);
    expect(client.requests.filter(isAnalyze)).toHaveLength(1);
    // The analyze route breaks; a restart that keeps the brief makes no analyze call and never asks.
    analyzeOk = false;
    await jobs.start(1, 'd', doc(3, 700), { keepBrief: true });
    expect(asked).toBe(1);
    expect(jobs.get(1)?.status).toBe('done');
    expect(client.requests.filter(isAnalyze)).toHaveLength(1);
    // Without a brief it is asked, and the job stops naming the analyze connection.
    await jobs.start(1, 'd', doc(3, 700));
    expect(asked).toBe(2);
    expect(jobs.get(1)).toMatchObject({ status: 'stopped', stopError: { kind: 'auth' }, connection: gemini });
    expect(client.requests.filter(isAnalyze)).toHaveLength(1);
  });

  it('single-pass jobs do not ask for the analyze role', async () => {
    const targets: { analyze?: boolean }[] = [];
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: (target) => (targets.push(target), ok(both('{}'))()) });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc(3));
    expect(targets[0]?.analyze).toBe(false);
  });

  it('replaces the first chunk in place with its second, briefed pass (revision 2, M2-D17); counts stay per segment', async () => {
    let briefed = 0;
    const client = translatorClient((lines, _n, req) => {
      if (isAnalyze(req)) return JSON.stringify(BRIEF);
      const withBrief = req.system.includes('Genre: blog post');
      if (withBrief) briefed++;
      return renderLines(lines, (src) => `${withBrief ? 'vi2' : 'vi'}:${src}`);
    }, { model: GEMINI_PROFILE.model });
    const jobs = new Jobs({ translateClient: ok(client) });
    jobs.setActive(1);
    const d = doc(3, 700);
    await jobs.start(1, 'd', d);
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('done');
    expect(v.counts).toEqual({ total: 3, final: 3, failed: 0 });
    // Every segment ends briefed: chunk 0 through its second pass, the others the first time.
    expect([...v.segs.values()].map((s) => [s.text?.split(':')[0], s.revision])).toEqual([['vi2', 2], ['vi2', 1], ['vi2', 1]]);
    expect(briefed).toBe(3);
  });

  it('a one-chunk page makes no brief call: no brief, so no About card (M2-D9)', async () => {
    const client = both(JSON.stringify(BRIEF));
    const jobs = new Jobs({ translateClient: ok(client) });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc(3));
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('done');
    expect(client.requests.filter(isAnalyze)).toHaveLength(0);
    expect(v.brief).toBeUndefined();
    expect(v.counts).toEqual({ total: 3, final: 3, failed: 0 });
  });

  it('keeps a known source language, and goes on without a brief when the answer is unusable', async () => {
    const jobs = new Jobs({ translateClient: ok(both('Sorry, no JSON today.')) });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc(2));
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('done');
    expect(v.brief).toBeUndefined();
    expect(v.sourceLang).toBe('en');
    expect(v.counts).toEqual({ total: 2, final: 2, failed: 0 });
  });

  it('resume keeps the brief and makes no second brief call', async () => {
    const first = both(JSON.stringify(BRIEF));
    // The first run gets its brief, then every translate call fails (not retried): segments are left to resume.
    const broken: LLMClient = {
      model: first.model,
      reasoningReserveTokens: () => 0,
      async *stream(req) {
        if (isAnalyze(req)) yield* first.stream(req);
        else yield { type: 'error', error: { kind: 'bad_request', status: 400, message: 'down' } };
      },
    };
    let current: LLMClient = broken;
    const jobs = new Jobs({ translateClient: () => ok(current)() });
    jobs.setActive(1);
    await jobs.start(1, 'd', { ...doc(3, 700), sourceLang: '' });
    expect(jobs.get(1)?.brief).toEqual(BRIEF);
    expect(jobs.get(1)?.counts.failed).toBe(3);

    const again = both('{"genre": "a different brief"}');
    current = again;
    await jobs.resume(1);
    const v = jobs.get(1) as JobView;
    expect(again.requests.filter(isAnalyze)).toHaveLength(0);
    expect(v.brief).toEqual(BRIEF);
    expect(v.sourceLang).toBe('de');
    expect(again.requests[0]?.system).toContain('from German into Vietnamese');
    expect(v.counts).toEqual({ total: 3, final: 3, failed: 0 });
  });

  it('skip: no client is resolved and nothing is sent; resume translates anyway', async () => {
    const client = both(JSON.stringify(BRIEF));
    let resolved = 0;
    const jobs = new Jobs({ translateClient: () => (resolved++, ok(client)()) });
    jobs.setActive(1);
    const d = { ...doc(2), sourceLang: 'vi', detection: { lang: 'vi', via: 'detector' as const, confidence: 0.97 } };
    jobs.skip(1, 'd', d);
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('skipped');
    expect(v.detection).toEqual(d.detection);
    expect(resolved).toBe(0);
    expect(client.requests).toHaveLength(0);
    await jobs.resume(1);
    expect(jobs.get(1)?.status).toBe('done');
    expect(jobs.get(1)?.counts).toEqual({ total: 2, final: 2, failed: 0 });
  });

  it('skip replaces a running job of the tab', async () => {
    const t = instrumented(both(JSON.stringify(BRIEF)), { hold: true });
    const jobs = new Jobs({ translateClient: ok(t.client) });
    jobs.setActive(1);
    const running = jobs.start(1, 'd', doc(4));
    await until(() => t.active > 0);
    jobs.skip(1, 'e', doc(1));
    t.releaseAll();
    await running;
    expect(jobs.get(1)?.status).toBe('skipped');
    expect(jobs.docOf(1)).toBe('e');
    expect(t.signals.every((s) => s.aborted)).toBe(true);
  });

  it('per-segment detection: kept segments are not sent and are shown as is', async () => {
    const client = both(JSON.stringify(BRIEF));
    const jobs = new Jobs({ translateClient: ok(client) });
    jobs.setActive(1);
    const d = { ...doc(3), keep: new Set(['s1']) };
    await jobs.start(1, 'd', d);
    const v = jobs.get(1) as JobView;
    expect(v.counts).toEqual({ total: 2, final: 2, failed: 0 });
    expect(v.segments.find((s) => s.id === 's1')?.translate).toBe(false);
    const sent = client.requests.filter((r) => !isAnalyze(r)).flatMap((r) => wireLines(r.messages[0]?.content ?? '').map((l) => l.source));
    expect(sent.some((src) => src.startsWith('P1 '))).toBe(false);
    expect(sent.some((src) => src.startsWith('P0 '))).toBe(true);
  });
});

describe('Jobs: viewport first (plan M3-E1)', () => {
  const paragraphOf = (req: NormalizedRequest) => /^P(\d+)/.exec(wireLines(req.messages.find((m) => m.role === 'user')?.content ?? '')[0]?.source ?? '')?.[1];

  it('starts with the chunks on screen, then reads on (real engine, one paragraph per chunk)', async () => {
    const client = translatorClient();
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: ok(client) });
    jobs.setActive(1);
    jobs.setViewport(1, 'd', ['s5']);
    await jobs.start(1, 'd', doc(8, 600));
    expect(client.requests.map(paragraphOf)).toEqual(['5', '6', '7', '0', '1', '2', '3', '4']);
    expect(jobs.get(1)?.status).toBe('done');
  });

  it('gives the engine the viewport now, a live port that follows setViewport, for this document only', async () => {
    let seen: TranslationJob | undefined;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const engine = () => ({
      async *translate(job: TranslationJob) {
        seen = job;
        await held;
        yield final('s0', 'vi:P0');
      },
    });
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: ok(translatorClient()), engine: engine as never });
    jobs.setActive(1);
    jobs.setViewport(1, 'd', ['s1', 's2']);
    const running = jobs.start(1, 'd', doc(3));
    await new Promise((r) => setTimeout(r, 0));
    expect(seen?.priority).toEqual(['s1', 's2']);
    jobs.setViewport(1, 'd', ['s0']);
    expect(seen?.livePriority?.()).toEqual(['s0']);
    // Scrolled past the article: the last viewport stays.
    jobs.setViewport(1, 'd', []);
    expect(seen?.livePriority?.()).toEqual(['s0']);
    // A viewport of another document (the page navigated) is not this job's.
    jobs.setViewport(1, 'other', ['s2']);
    expect(seen?.livePriority?.()).toEqual([]);
    release();
    await running;
  });

  // Engine yielding `steps` 100 ms apart; a step may also scroll (setViewport) before its event.
  const timedRun = (steps: ((jobs: Jobs) => EngineEvent)[]) => {
    const clock = { t: 1000 };
    const views: JobView[] = [];
    const ref: { jobs?: Jobs } = {};
    const engine = () => ({
      async *translate() {
        for (const step of steps) {
          clock.t += 100;
          yield step(ref.jobs as Jobs);
        }
      },
    });
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: ok(translatorClient()), engine: engine as never, now: () => clock.t });
    ref.jobs = jobs;
    jobs.subscribe((_, v) => v && views.push(v));
    jobs.setActive(1);
    return { jobs, views };
  };

  it('records when the segments on screen are all final (§3 #1), not before', async () => {
    const { jobs, views } = timedRun([() => final('s2', 'vi:P2'), () => final('s1', 'vi:P1'), () => final('s0', 'vi:P0')]);
    jobs.setViewport(1, 'd', ['s1', 's2', 'code']);
    await jobs.start(1, 'd', doc(3));
    const v = jobs.get(1) as JobView;
    expect(v.firstVisibleAt).toBe(1100);
    // s2 final at 1100, s1 at 1200: the screen is done at 1200, before s0.
    expect(v.screenDoneAt).toBe(1200);
    expect(views.some((x) => x.counts.final === 1 && x.screenDoneAt === undefined)).toBe(true);
  });

  it('a failed block on screen is not done: no screenDoneAt (round 6)', async () => {
    const { jobs } = timedRun([() => final('s2', 'vi:P2'), () => failedEv('s1'), () => final('s0', 'vi:P0')]);
    jobs.setViewport(1, 'd', ['s1', 's2']);
    await jobs.start(1, 'd', doc(3));
    const v = jobs.get(1) as JobView;
    expect(v.counts.failed).toBe(1);
    expect(v.screenDoneAt).toBeUndefined();
  });

  it('follows the screen the reader scrolled to, not the one at the start (round 6)', async () => {
    const { jobs } = timedRun([
      (j) => {
        // The reader scrolls down before the first block comes back.
        j.setViewport(1, 'd', ['s2']);
        return final('s0', 'vi:P0');
      },
      () => final('s1', 'vi:P1'),
      () => final('s2', 'vi:P2'),
    ]);
    jobs.setViewport(1, 'd', ['s0', 's1']);
    await jobs.start(1, 'd', doc(3));
    // The start screen (s0, s1) was final at 1200; the screen on view (s2) only at 1300.
    expect(jobs.get(1)?.screenDoneAt).toBe(1300);
  });

  it('scrolling onto blocks already final stamps the screen at the scroll (round 6)', async () => {
    const { jobs } = timedRun([
      () => final('s0', 'vi:P0'),
      (j) => {
        j.setViewport(1, 'd', ['s0']);
        return final('s1', 'vi:P1');
      },
      () => final('s2', 'vi:P2'),
    ]);
    jobs.setViewport(1, 'd', ['s2']);
    await jobs.start(1, 'd', doc(3));
    // At 1200 the reader is on s0, final since 1100; s2 (the start screen) only ends at 1300.
    expect(jobs.get(1)?.screenDoneAt).toBe(1200);
  });

  it('no screen, no screenDoneAt', async () => {
    const jobs = new Jobs({ strategy: 'single-pass', translateClient: ok(translatorClient()) });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc(2));
    expect(jobs.get(1)?.status).toBe('done');
    expect(jobs.get(1)?.screenDoneAt).toBeUndefined();
  });
});
