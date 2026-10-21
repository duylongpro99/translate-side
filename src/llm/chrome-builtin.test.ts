import { describe, expect, it, vi } from 'vitest';
import { CHROME_TRANSLATOR_MODEL, CREATE_TIMEOUT_MS, chromeTranslator, needsActivation, unavailableMessage } from './chrome-translator.ts';
import { NANO_MODEL, createChromeBuiltinAdapter } from './chrome-builtin.ts';
import type { MTAvailability, MTResult, NormalizedEvent, NormalizedRequest, ResolvedConnection } from './types.ts';

const named = (name: string, message = name) => Object.assign(new Error(message), { name });

// ---- Chrome's Translator behind the MTClient port (plan M5-E7) ---------------------------------

function translatorScope(opts: { state?: MTAvailability; create?: (o: { monitor?: (m: EventTarget) => void }) => Promise<unknown>; translate?: (text: string) => Promise<string>; detected?: { detectedLanguage: string; confidence: number }[] } = {}) {
  const log: string[] = [];
  const scope = {
    Translator: {
      async availability(o: { sourceLanguage: string; targetLanguage: string }) {
        log.push(`availability ${o.sourceLanguage}>${o.targetLanguage}`);
        return opts.state ?? 'available';
      },
      async create(o: { sourceLanguage: string; targetLanguage: string; monitor?: (m: EventTarget) => void }) {
        log.push(`create ${o.sourceLanguage}>${o.targetLanguage}`);
        if (opts.create) return opts.create(o);
        return { translate: opts.translate ?? (async (t: string) => `vi:${t}`) };
      },
    },
    ...(opts.detected ? { LanguageDetector: { create: async () => ({ detect: async () => opts.detected }) } } : {}),
  };
  return { scope, log };
}

const signal = () => new AbortController().signal;

/** The MTClient of `scope`, which has the API. */
function mtOf(scope: object) {
  const mt = chromeTranslator(scope);
  if (mt === undefined) throw new Error('no Translator in scope');
  return mt;
}

describe('chromeTranslator (MTClient over Chrome Translator)', () => {
  it('is absent in a browser without the API', () => {
    expect(chromeTranslator({})).toBeUndefined();
  });

  it('translates with one translator per pair, created once', async () => {
    const { scope, log } = translatorScope();
    const mt = mtOf(scope);
    expect(mt.model).toBe(CHROME_TRANSLATOR_MODEL);
    expect(await mt.availability('en', 'vi')).toBe('available');
    expect(await mt.translate('Hello.', 'en', 'vi', signal())).toEqual({ ok: true, text: 'vi:Hello.' });
    expect(await mt.translate('Bye.', 'en', 'vi', signal())).toEqual({ ok: true, text: 'vi:Bye.' });
    expect(log.filter((l) => l.startsWith('create'))).toEqual(['create en>vi']);
  });

  it('a pair Chrome cannot do is a clear failure, without creating anything', async () => {
    const { scope, log } = translatorScope({ state: 'unavailable' });
    const r = await mtOf(scope).translate('Hello.', 'en', 'xx', signal());
    expect(r).toEqual({ ok: false, error: { kind: 'unknown', message: unavailableMessage('en', 'xx', 'unavailable') } });
    expect(log.some((l) => l.startsWith('create'))).toBe(false);
  });

  it('a pair Chrome has not created for us is never created by a block: it waits on the turn-on click (prepare), then translates', async () => {
    const { scope, log } = translatorScope({ state: 'downloadable', create: async () => ({ translate: async (t: string) => `vi:${t}` }) });
    const mt = chromeTranslator(scope);
    if (mt === undefined) throw new Error('no Translator in scope');
    const r = await mt.translate('Hello.', 'en', 'vi', signal());
    expect(r).toMatchObject({ ok: false, error: { message: unavailableMessage('en', 'vi', 'downloadable'), raw: { reason: 'needs-activation', from: 'en', to: 'vi' } } });
    expect(!r.ok && needsActivation(r.error)).toEqual({ reason: 'needs-activation', from: 'en', to: 'vi' });
    expect(log.filter((l) => l.startsWith('create'))).toHaveLength(0);
    // The click creates it; later blocks reuse that translator (Chrome still says `downloadable` here).
    await mt.prepare('en', 'vi');
    expect(await mt.translate('Hello.', 'en', 'vi', signal())).toEqual({ ok: true, text: 'vi:Hello.' });
    expect(log.filter((l) => l.startsWith('create'))).toHaveLength(1);
  });

  it('prepare reports the download and replaces a create that failed', async () => {
    let n = 0;
    const seen: number[] = [];
    const { scope } = translatorScope({
      state: 'downloadable',
      create: async (opts: { monitor?: (m: EventTarget) => void }) => {
        if (n++ === 0) throw named('NetworkError');
        const m = new EventTarget();
        opts.monitor?.(m);
        for (const loaded of [0, 0.5, 1]) m.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded }));
        return { translate: async (t: string) => `vi:${t}` };
      },
    });
    const mt = chromeTranslator(scope);
    if (mt === undefined) throw new Error('no Translator in scope');
    await expect(mt.prepare('en', 'vi')).rejects.toMatchObject({ name: 'NetworkError' });
    await mt.prepare('en', 'vi', { progress: (loaded) => seen.push(loaded) });
    expect(seen).toEqual([0, 0.5, 1]);
    expect(await mt.translate('Hi.', 'en', 'vi', signal())).toEqual({ ok: true, text: 'vi:Hi.' });
  });

  it('a create that never settles (Chrome for Testing: no download) is answered after the timeout; later blocks are answered at once', async () => {
    const { scope, log } = translatorScope({ state: 'available', create: () => new Promise(() => {}) });
    // Fake timers, not the wall clock (a loaded machine made the timing flaky).
    vi.useFakeTimers();
    try {
      const mt = mtOf(scope);
      let first: MTResult | undefined;
      void mt.translate('Hello.', 'en', 'vi', signal()).then((r) => (first = r));
      await vi.advanceTimersByTimeAsync(CREATE_TIMEOUT_MS - 1);
      expect(first).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(first).toMatchObject({ ok: false, error: { message: unavailableMessage('en', 'vi', 'downloadable') } });
      // While that create is still pending, the next block is answered without waiting (no timer runs).
      expect(await mt.translate('Bye.', 'en', 'vi', signal())).toMatchObject({ ok: false });
      expect(log.filter((l) => l.startsWith('create'))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a translate that throws is a failure that names the error', async () => {
    const { scope } = translatorScope({ translate: () => Promise.reject(named('UnknownError', 'boom')) });
    expect(await mtOf(scope).translate('Hello.', 'en', 'vi', signal())).toMatchObject({ ok: false, error: { kind: 'unknown', message: "Chrome's built-in translator failed (UnknownError: boom)." } });
  });

  it('an unknown page language is detected per text; undetectable is a failure; already in the target language passes through', async () => {
    const { scope, log } = translatorScope({ detected: [{ detectedLanguage: 'de', confidence: 0.9 }] });
    expect(await mtOf(scope).translate('Hallo.', '', 'vi', signal())).toEqual({ ok: true, text: 'vi:Hallo.' });
    expect(log).toContain('create de>vi');
    const unsure = translatorScope({ detected: [{ detectedLanguage: 'de', confidence: 0.2 }] });
    expect(await mtOf(unsure.scope).translate('Hallo.', '', 'vi', signal())).toMatchObject({ ok: false });
    const same = translatorScope();
    expect(await mtOf(same.scope).translate('Xin chào.', 'vi', 'vi', signal())).toEqual({ ok: true, text: 'Xin chào.' });
    expect(same.log).toEqual([]);
  });

  it('a cancel throws the reason instead of answering', async () => {
    const c = new AbortController();
    const { scope } = translatorScope({
      translate: async () => {
        c.abort(new DOMException('cancelled', 'AbortError'));
        throw named('AbortError');
      },
    });
    await expect(mtOf(scope).translate('Hello.', 'en', 'vi', c.signal)).rejects.toThrow('cancelled');
  });
});

// ---- The chrome-builtin adapter for Gemini Nano (flagged, plan M5-E7) --------------------------

const conn = { id: 'nano', protocol: 'chrome-builtin', baseUrl: '', auth: { style: 'none' }, quirks: {}, hasHostPermission: async () => true } satisfies ResolvedConnection;
const req = (extra: Partial<NormalizedRequest> = {}): NormalizedRequest => ({ model: NANO_MODEL, system: 'You translate.', messages: [{ role: 'user', content: 'Hello' }], maxOutputTokens: 100, signal: signal(), ...extra });

async function collect(stream: AsyncIterable<NormalizedEvent>): Promise<NormalizedEvent[]> {
  const out: NormalizedEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

function nanoScope(opts: { state?: MTAvailability; chunks?: string[]; fail?: Error; readable?: boolean } = {}) {
  const created: unknown[] = [];
  let destroyed = 0;
  const scope = {
    LanguageModel: {
      availability: async () => opts.state ?? 'available',
      params: async () => ({ defaultTopK: 3 }),
      async create(o: unknown) {
        created.push(o);
        return {
          promptStreaming(input: unknown) {
            created.push(input);
            const chunks = opts.chunks ?? ['Xin ', 'chào'];
            if (opts.readable) return new ReadableStream<string>({ start: (c) => (chunks.forEach((x) => c.enqueue(x)), c.close()) });
            return (async function* () {
              for (const ch of chunks) yield ch;
              if (opts.fail) throw opts.fail;
            })();
          },
          destroy: () => void destroyed++,
        };
      },
    },
  };
  return { scope, created, destroyed: () => destroyed };
}

describe('createChromeBuiltinAdapter (Gemini Nano, DESIGN §4.2.2)', () => {
  it.each([false, true])('streams deltas; system goes in initialPrompts (ReadableStream: %s)', async (readable) => {
    const { scope, created, destroyed } = nanoScope({ readable });
    const events = await collect(createChromeBuiltinAdapter(scope).stream(conn, req({ temperature: 0.3 })));
    expect(events).toEqual([
      { type: 'text', delta: 'Xin ' },
      { type: 'text', delta: 'chào' },
      { type: 'done', stopReason: 'end' },
    ]);
    expect(created[0]).toMatchObject({ initialPrompts: [{ role: 'system', content: 'You translate.' }], temperature: 0.3, topK: 3 });
    expect(created[1]).toEqual([{ role: 'user', content: 'Hello' }]);
    expect(destroyed()).toBe(1);
  });

  it('a model that is not on the device, or no API at all, is model_not_found', async () => {
    for (const scope of [nanoScope({ state: 'unavailable' }).scope, nanoScope({ state: 'downloadable' }).scope, {}]) {
      const events = await collect(createChromeBuiltinAdapter(scope).stream(conn, req()));
      expect(events).toEqual([{ type: 'error', error: expect.objectContaining({ kind: 'model_not_found' }) }]);
    }
  });

  it('a prompt over the quota is context_length; other errors unknown', async () => {
    const quota = await collect(createChromeBuiltinAdapter(nanoScope({ chunks: [], fail: named('QuotaExceededError') }).scope).stream(conn, req()));
    expect(quota).toEqual([{ type: 'error', error: expect.objectContaining({ kind: 'context_length' }) }]);
    const other = await collect(createChromeBuiltinAdapter(nanoScope({ chunks: ['x'], fail: named('UnknownError') }).scope).stream(conn, req()));
    expect(other.map((e) => e.type)).toEqual(['text', 'error']);
  });

  it('probe and listModels follow availability', async () => {
    const on = createChromeBuiltinAdapter(nanoScope().scope);
    expect(await on.probe(conn)).toEqual({ ok: true, models: [{ id: NANO_MODEL, displayName: 'Gemini Nano' }] });
    expect(await on.listModels?.(conn)).toEqual([{ id: NANO_MODEL, displayName: 'Gemini Nano' }]);
    const off = createChromeBuiltinAdapter(nanoScope({ state: 'unavailable' }).scope);
    expect(await off.probe(conn)).toMatchObject({ ok: false, error: { kind: 'model_not_found' } });
    expect(await off.listModels?.(conn)).toEqual([]);
  });

  it('a cancel throws the reason', async () => {
    const c = new AbortController();
    c.abort(new DOMException('cancelled', 'AbortError'));
    await expect(collect(createChromeBuiltinAdapter(nanoScope({ fail: named('AbortError') }).scope).stream(conn, req({ signal: c.signal })))).rejects.toThrow('cancelled');
  });
});
