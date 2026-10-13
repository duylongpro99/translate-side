// The two local servers the e2e suite talks to, Node `http` only:
// - the fixture pages, served from fixtures/ on 127.0.0.1:4173;
// - an OpenAI-chat mock on 127.0.0.1:4174 that streams deterministic answers in the segment grammar.
// The mock answers every <seg> with "vi:" in front of its text and the analyze call (whose user
// message starts with <document>) with a fixed brief, like the eval harness's mock client
// (scripts/eval/run.ts). A review call (Best; its user message starts with <review>) gets "rv:" in front
// of the draft of each even item, the odd ones left as they are, and <none/> for a one-item call or when
// nothing changed. It can be told to answer the next translate calls with a 429 or a malformed
// stream, or a 400 whose message quotes the segments sent (as some gateways do), and it logs every call
// (with its model and usage) so specs can see what was sent and to which model.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export const FIXTURE_PORT = 4173;
export const MOCK_PORT = 4174;
export const FIXTURE_ORIGIN = `http://127.0.0.1:${FIXTURE_PORT}`;
export const MOCK_BASE_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

export function fixtureServer(): http.Server {
  return http.createServer((req, res) => {
    const file = path.join(FIXTURES, decodeURIComponent(new URL(req.url ?? '/', FIXTURE_ORIGIN).pathname));
    if (!file.startsWith(FIXTURES + path.sep)) {
      res.writeHead(404).end();
      return;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      // Images the captured pages reference by relative path were not stored (fixtures/sites/README.md):
      // answer them empty, like the external ones (fixtures.ts). A missing page is still a 404.
      res.writeHead(path.extname(file) === '.html' ? 404 : 200).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    if (path.extname(file) !== '.html') {
      fs.createReadStream(file).pipe(res);
      return;
    }
    // A captured page's web app manifest link is cut: Chromium parses an intercepted cross-origin manifest
    // as empty (a syntax error on the console) whatever the answer, and the manifest plays no part in
    // what the extension reads.
    res.end(fs.readFileSync(file, 'utf8').replace(/<link\b[^>]*\brel="manifest"[^>]*>/g, ''));
  });
}

/** One translate, analyze or review call as the mock saw it. */
export interface MockCall {
  kind: 'analyze' | 'translate' | 'review';
  /** The <seg> texts sent, in order (translate calls); the items' sources (review calls). */
  segments: string[];
  /** The model the request named. */
  model: string;
  /** The usage the mock reported (absent for a call it failed). */
  usage?: { input: number; output: number };
  status: number;
  /** Every message of the request, system included (the glossary and brief the panel sent). */
  prompt: string;
  /** Answered with a malformed stream (`MockControl.malformed`). */
  malformed?: true;
}

export interface MockControl {
  /** Answer the next `n` translate calls with a 429 (`Retry-After: 1`). */
  rateLimit(n: number): void;
  /** Answer the next `n` translate calls with a stream holding a chunk that is not JSON. */
  malformed(n: number): void;
  /** Answer the next `n` translate calls with a 400 whose error message quotes the segments sent. */
  echoError(n: number): void;
  /** Answers a translate call's segments with `fn(text)` instead of `vi:` + text (the store screenshots show real Vietnamese). */
  answerWith(fn: ((text: string) => string) | undefined): void;
  /** Holds each translate answer for `ms` before it starts (the store screenshots show a plausible duration, not the mock's instant one). */
  delayAnswers(ms: number): void;
  /**
   * Answers a review call's items with `fn(draft, id)` (undefined: left as it is) instead of the
   * even/odd rule, e.g. candidates that fail a post-check. `undefined` restores the rule.
   */
  reviewWith(fn: ((draft: string, id: number) => string | undefined) | undefined): void;
  calls: MockCall[];
  reset(): void;
}

const BRIEF = JSON.stringify({ language: 'en', genre: 'mock genre', audience: 'mock audience', purpose: 'mock purpose', tone: 'mock tone', glossary: [] });
const SEG = /<seg id="(\d+)"( n="[^"]*")?>([\s\S]*?)<\/seg>(?=\n<seg id=|$)/g;
const ITEM = /<item id="(\d+)">\n<source>([\s\S]*?)<\/source>\n<translation>([\s\S]*?)<\/translation>\n<\/item>/g;

/** The default review: "rv:" before the draft of each even item; a one-item call is left as it is. */
const evenItems = (draft: string, id: number, items: number): string | undefined => (items > 1 && id % 2 === 0 ? `rv:${draft}` : undefined);

const chunk = (content: string, finish: string | null = null) => `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'mock', choices: [{ index: 0, delta: { content }, finish_reason: finish }] })}\n\n`;

export function mockServer(): { server: http.Server; control: MockControl } {
  const pending = { rateLimit: 0, malformed: 0, echoError: 0 };
  let answer: ((text: string) => string) | undefined;
  let review: ((draft: string, id: number) => string | undefined) | undefined;
  let delay = 0;
  const control: MockControl = {
    rateLimit: (n) => void (pending.rateLimit = n),
    malformed: (n) => void (pending.malformed = n),
    echoError: (n) => void (pending.echoError = n),
    answerWith: (fn) => void (answer = fn),
    delayAnswers: (ms) => void (delay = ms),
    reviewWith: (fn) => void (review = fn),
    calls: [],
    reset() {
      pending.rateLimit = 0;
      pending.malformed = 0;
      pending.echoError = 0;
      answer = undefined;
      review = undefined;
      delay = 0;
      control.calls.length = 0;
    },
  };
  const server = http.createServer((req, res) => {
    // Extension pages with a host permission skip CORS; these headers only keep a stray preflight harmless.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: `no route ${req.method} ${req.url}` } }));
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (d: string) => (body += d));
    req.on('end', () => {
      const { model, messages } = JSON.parse(body) as { model: string; messages: { role: string; content: string }[] };
      const user = messages
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
        .join('\n');
      const analyze = user.startsWith('<document>');
      const reviewing = user.startsWith('<review>');
      const items = reviewing ? [...user.matchAll(ITEM)].map((m) => ({ id: Number(m[1]), source: m[2] ?? '', draft: m[3] ?? '' })) : [];
      const segs = analyze || reviewing ? '' : user.slice(user.indexOf('<seg id='));
      const call: MockCall = { kind: analyze ? 'analyze' : reviewing ? 'review' : 'translate', segments: reviewing ? items.map((i) => i.source) : [...segs.matchAll(SEG)].map((m) => m[3] ?? ''), model, status: 200, prompt: messages.map((m) => m.content).join('\n') };
      control.calls.push(call);
      if (reviewing) {
        const revised = items.flatMap(({ id, draft }) => {
          const text = review ? review(draft, id) : evenItems(draft, id, items.length);
          return text === undefined ? [] : [`<seg id="${id}">${text}</seg>`];
        });
        respond(res, call, user, revised.length > 0 ? revised.join('\n') : '<none/>');
        return;
      }
      if (!analyze && pending.rateLimit > 0) {
        pending.rateLimit--;
        call.status = 429;
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' }).end(JSON.stringify({ error: { message: 'Rate limit reached (mock)', type: 'rate_limit_error' } }));
        return;
      }
      if (!analyze && pending.echoError > 0) {
        pending.echoError--;
        call.status = 400;
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: `Invalid request: ${call.segments.join(' ')}`, type: 'invalid_request_error' } }));
        return;
      }
      const start = () => {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        if (!analyze && pending.malformed > 0) {
          pending.malformed--;
          call.malformed = true;
          res.end(`${chunk('<seg id="')}data: {not json\n\n`);
          return;
        }
        const out = analyze ? BRIEF : segs.replace(SEG, (_m, id: string, n: string | undefined, text: string) => `<seg id="${id}"${n ?? ''}>${answer ? answer(text) : `vi:${text}`}</seg>`);
        respond(res, call, user, out);
      };
      if (!analyze && delay > 0) setTimeout(start, delay);
      else start();
    });
  });
  return { server, control };
}

/** Streams `out` as the answer: two content chunks (the panel sees a stream rather than one block), then a deterministic usage. */
function respond(res: http.ServerResponse, call: MockCall, user: string, out: string): void {
  if (!res.headersSent) res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const half = Math.ceil(out.length / 2);
  res.write(chunk(out.slice(0, half)));
  res.write(chunk(out.slice(half), 'stop'));
  call.usage = { input: Math.ceil(user.length / 3.5), output: Math.ceil(out.length / 3.5) };
  res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'mock', choices: [], usage: { prompt_tokens: call.usage.input, completion_tokens: call.usage.output } })}\n\n`);
  res.end('data: [DONE]\n\n');
}

/** Listens on a fixed port; a port already in use is reported with how to find its owner. */
export function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) => reject(e.code === 'EADDRINUSE' ? new Error(`port ${port} is in use: find the stale owner with \`lsof -i :${port}\``) : e));
    server.listen(port, '127.0.0.1', resolve);
  });
}
