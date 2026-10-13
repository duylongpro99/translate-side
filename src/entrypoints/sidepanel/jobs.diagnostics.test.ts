// The jobs' diagnostics records (onJobRecord) written through the real log into a fake storage.local:
// what a run reports, and what never reaches the log even when a provider error echoes the page.
import { describe, expect, it } from 'vitest';
import { translatorClient } from '@/engine/testing';
import type { Segment } from '@/engine/index';
import type { LLMClient, LLMError } from '@/llm/types';
import { classifyHttpError } from '@/llm/errors';
import { createDiagnosticsLog, readDiagnostics, type JobRecord } from '@/shared/diagnostics';
import { GEMINI_PROFILE } from '@/shared/settings';
import { fakeDevice } from '@/shared/testing';
import { Jobs, type JobDoc } from './jobs.ts';

const SECRET_TEXT = 'The quarterly figures for Project Nightingale';
const URL_PATH = 'https://intranet.example.com/reports/q3?id=42';

function doc(n: number): JobDoc {
  const segments: Segment[] = Array.from({ length: n }, (_, i) => {
    const text = `${SECRET_TEXT} part ${i} ${'word '.repeat(40)}`;
    return { id: `s${i}`, kind: 'p', text, inlineMarkup: text, domPath: `/p[${i + 1}]`, translate: true };
  });
  return { url: URL_PATH, title: 'Q3 report', sourceLang: 'en', targetLang: 'vi', segments };
}

const connection = { id: 'gw', label: 'Company gateway', presetId: 'custom-openai', origin: 'https://gateway.example.com/*' };

/** A client whose every request fails with `error`. */
function failing(error: LLMError): LLMClient {
  return {
    model: 'gw-model',
    reasoningReserveTokens: () => 0,
    async *stream() {
      await Promise.resolve();
      yield { type: 'error', error };
    },
  };
}

async function run(client: LLMClient, opts: { strategy?: 'single-pass' | 'contextual' } = {}) {
  const device = fakeDevice();
  const log = createDiagnosticsLog(device.api);
  const records: JobRecord[] = [];
  const writes: Promise<void>[] = [];
  const jobs = new Jobs({
    ...(opts.strategy ? { strategy: opts.strategy } : {}),
    translateClient: () => Promise.resolve({ ok: true, client, profile: GEMINI_PROFILE, connection }),
    onJobRecord: (r) => {
      records.push(r);
      writes.push(log.record(r));
    },
  });
  jobs.setActive(1);
  await jobs.start(1, 'd', doc(6));
  await Promise.all(writes);
  return { device, records, view: jobs.get(1) };
}

describe('the diagnostics record of a page run', () => {
  it('reports the run when it starts and again when it ends, with app-owned facts', async () => {
    const { device, records, view } = await run(translatorClient(), { strategy: 'single-pass' });
    expect(view?.status).toBe('done');
    expect(records.map((r) => r.outcome)).toEqual(['started', 'done']);
    expect(records[0]?.id).toBe(records[1]?.id);
    const [entry] = await readDiagnostics(device.api);
    expect(entry).toMatchObject({ type: 'page-job', outcome: 'done', strategy: 'single-pass', presetId: 'custom-openai', segments: 6, failed: 0, errors: [] });
    if (entry?.type !== 'page-job') throw new Error('no entry');
    expect(entry.promptIds.length).toBeGreaterThan(0);
    expect(entry.chunks + entry.calls).toBeGreaterThan(0);
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps no page text, address or provider message when the provider error echoes the request', async () => {
    // What a gateway answering 400 with the prompt quoted back looks like after classification.
    const error = classifyHttpError({ status: 400, body: JSON.stringify({ error: { message: `Invalid request near "${SECRET_TEXT}" from ${URL_PATH}` } }), baseUrl: 'https://gateway.example.com/v1', auth: 'bearer' });
    expect(error.message).toContain(SECRET_TEXT);
    const { device, view } = await run(failing(error), { strategy: 'single-pass' });
    expect(view?.counts.failed).toBeGreaterThan(0);
    const stored = JSON.stringify(Object.fromEntries(device.local.data));
    expect(stored).toContain('"kind":"bad_request"');
    expect(stored).toContain('"status":400');
    for (const leak of [SECRET_TEXT, 'Nightingale', 'intranet.example.com', 'gateway.example.com', '/reports/q3', 'Invalid request']) expect(stored).not.toContain(leak);
  });

  it('a stopped run names the error that stopped it, and a run replaced while running says so', async () => {
    const auth: LLMError = { kind: 'auth', status: 401, message: 'Key invalid or missing', raw: `{"error":"bad key for ${SECRET_TEXT}"}` };
    const { records } = await run(failing(auth), { strategy: 'single-pass' });
    expect(records.at(-1)).toMatchObject({ outcome: 'stopped', errors: [{ kind: 'auth', status: 401 }] });

    const seen: JobRecord[] = [];
    const waiting: (() => void)[] = [];
    const release = () => waiting.splice(0).forEach((go) => go());
    const jobs = new Jobs({
      strategy: 'single-pass',
      translateClient: () => new Promise((resolve) => waiting.push(() => resolve({ ok: true, client: translatorClient(), profile: GEMINI_PROFILE, connection }))),
      onJobRecord: (r) => seen.push(r),
    });
    jobs.setActive(1);
    const first = jobs.start(1, 'd', doc(2));
    const firstId = seen[0]?.id;
    const second = jobs.start(1, 'd', doc(2));
    release();
    await Promise.all([first, second]);
    expect(seen.filter((r) => r.id === firstId).map((r) => r.outcome)).toEqual(['started', 'replaced']);
  });

  it('a Best run reports the strategy it ran and its review counts; a refused Best reports contextual', async () => {
    const isReview = (req: { messages: { content: string }[] }) => (req.messages[0]?.content ?? '').startsWith('<review>');
    // The reviewer leaves every draft as it is.
    const client = translatorClient((lines, _n, req) => (isReview(req) ? '<none/>' : lines.map((l) => `<seg id="${l.n}"${l.nonce ? ` n="${l.nonce}"` : ''}>vi:${l.source}</seg>`).join('\n')));
    for (const [available, strategy] of [[true, 'refine'], [false, 'contextual']] as const) {
      const device = fakeDevice();
      const log = createDiagnosticsLog(device.api);
      const writes: Promise<void>[] = [];
      const jobs = new Jobs({ translateClient: () => Promise.resolve({ ok: true, client, profile: GEMINI_PROFILE, connection }), featureAvailable: () => Promise.resolve(available), onJobRecord: (r) => void writes.push(log.record(r)) });
      jobs.setActive(1);
      await jobs.start(1, 'd', { ...doc(2), strategy: 'refine' });
      await Promise.all(writes);
      const [entry] = await readDiagnostics(device.api);
      expect(entry).toMatchObject({ outcome: 'done', strategy });
      if (entry?.type !== 'page-job') throw new Error('no entry');
      if (available) expect(entry.review).toEqual({ accepted: 0, unchanged: 2, rejected: 0, skipped: 0 });
      else expect(entry.review).toBeUndefined();
    }
  });
});
