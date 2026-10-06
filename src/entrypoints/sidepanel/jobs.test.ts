import { describe, expect, it } from 'vitest';
import { BUDGET_MESSAGE, type EngineEvent, type Segment } from '@/engine/index';
import { translatorClient, wireLines, renderLines } from '@/engine/testing';
import type { LLMClient, LLMError, NormalizedRequest } from '@/llm/types';
import { GEMINI_PROFILE } from '@/shared/settings';
import { applySegmentEvent, Gate, Jobs, type ClientResult, type JobDoc, type JobView, type SegState } from './jobs.ts';
import { failureText } from './status.ts';

const by = { strategy: 'single-pass', stage: 'translate', model: 'm' };
const final = (id: string, text: string, revision = 1, attempt?: number): EngineEvent => ({ type: 'segment.final', id, text, revision, producedBy: by, ...(attempt === undefined ? {} : { attempt }) });
const failedEv = (id: string, error: LLMError = { kind: 'unknown', message: 'x' }): EngineEvent => ({ type: 'segment.failed', id, error });
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
    reasoningReserveTokens: 0,
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

describe('Jobs (plan M1-E8)', () => {
  it('translates a page with 2 chunks in flight, shows every final, and prices the usage', async () => {
    const t = instrumented(translatorClient(undefined, { model: GEMINI_PROFILE.model }));
    const jobs = new Jobs({ translateClient: ok(t.client) });
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
    const jobs = new Jobs({ translateClient: ok(t.client) });
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
    const jobs = new Jobs({ translateClient: () => ok(current)() });
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
    const jobs = new Jobs({ translateClient: () => ok(clients[next++] as LLMClient)() });
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
    const jobs = new Jobs({ translateClient: ok(t.client) });
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
      reasoningReserveTokens: 0,
      async *stream() {
        calls++;
        await settle(5);
        yield { type: 'error', error: { kind: 'auth', status: 401, message: 'Key invalid or missing' } };
      },
    };
    const jobs = new Jobs({ translateClient: ok(bad) });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc(30));
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('stopped');
    expect(v.stopError?.kind).toBe('auth');
    expect(calls).toBeLessThanOrEqual(2);
  });

  it('stops before any request when there is no key or no access', async () => {
    const jobs = new Jobs({ translateClient: () => Promise.resolve({ ok: false, error: { kind: 'cors', cause: 'permission', message: 'No access to x' } }) });
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
    const jobs = new Jobs({ translateClient: ok(translatorClient()), engine: engine as never });
    jobs.setActive(1);
    await jobs.start(1, 'd', doc(3));
    const v = jobs.get(1) as JobView;
    expect(v.status).toBe('stopped');
    expect(v.segs.get('s1')).toEqual({ status: 'pending' });
    expect(v.segs.get('s2')).toEqual({ status: 'pending' });
    expect(v.counts).toEqual({ total: 3, final: 0, failed: 1 });
    expect(v.usage).toEqual({ input: 1000, cachedInput: 0, output: 500 });
  });

  it('counts the requests a cancel cut off before their usage arrived; one still waiting at the gate is not one (review E-T2)', async () => {
    const t = instrumented(translatorClient(), { hold: true });
    const jobs = new Jobs({ translateClient: ok(t.client) });
    jobs.setActive(1);
    const run = jobs.start(1, 'd', doc(30));
    await until(() => t.active === 2);
    jobs.cancel(1);
    await run;
    await until(() => (jobs.get(1)?.unmetered ?? 0) === 2);
    // No usage at all yet, but the readout exists, so it can say what it leaves out.
    expect(jobs.get(1)?.cost).toBe(0);

    const bg = new Jobs({ translateClient: ok(instrumented(translatorClient()).client) });
    bg.setActive(5);
    const waiting = bg.start(1, 'd', doc(5));
    await settle(20);
    bg.cancel(1);
    await waiting;
    expect(bg.get(1)?.unmetered).toBe(0);
  });

  it('a restart in other languages keeps the earlier runs in the page cost (review E-R3)', async () => {
    const t = instrumented(translatorClient(), { hold: true });
    const jobs = new Jobs({ translateClient: ok(t.client) });
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
    const jobs = new Jobs({ translateClient: ok(t.client) });
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
