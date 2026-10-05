// Shared by the panel page and the worker. The driver injects the key in memory (never on disk) and calls runProbes.
self.runProbes = async function (key, ctx) {
  const B = 'https://ollama.com';
  const chat = (model, stream) => JSON.stringify({ model, stream, max_tokens: 64, messages: [{ role: 'user', content: 'Say ok.' }], ...(stream ? {} : {}) });
  const auth = { valid: { Authorization: `Bearer ${key}` }, invalid: { Authorization: 'Bearer invalid0000000000000000000000000000.AAAAAAAAAAAAAAAAAAAAAAAA' }, missing: {}, malformed: { Authorization: 'Basic Zm9vOmJhcg==' } };
  const cases = [
    ['GET /api/tags, no key', 'GET', '/api/tags', 'missing'],
    ['GET /v1/models, no key', 'GET', '/v1/models', 'missing'],
    ['GET /v1/models, invalid key', 'GET', '/v1/models', 'invalid'],
    ['POST /v1/chat/completions stream, valid key', 'POST', '/v1/chat/completions', 'valid', chat('gpt-oss:20b', true)],
    ['POST /v1/chat/completions, invalid key', 'POST', '/v1/chat/completions', 'invalid', chat('gpt-oss:20b', false)],
    ['POST /v1/chat/completions, missing key', 'POST', '/v1/chat/completions', 'missing', chat('gpt-oss:20b', false)],
    ['POST /v1/chat/completions, Basic auth', 'POST', '/v1/chat/completions', 'malformed', chat('gpt-oss:20b', false)],
    ['POST /v1/chat/completions, unknown model', 'POST', '/v1/chat/completions', 'valid', chat('no-such-model:1b', false)],
    ['POST /v1/chat/completions, qwen3.5:9b', 'POST', '/v1/chat/completions', 'valid', chat('qwen3.5:9b', false)],
    ['POST /v1/chat/completions, unknown model, invalid key', 'POST', '/v1/chat/completions', 'invalid', chat('no-such-model:1b', false)],
    ['POST /v1/chat/completions, bad JSON', 'POST', '/v1/chat/completions', 'valid', '{not json'],
    ['POST /v1/chat/completions, no messages', 'POST', '/v1/chat/completions', 'valid', JSON.stringify({ model: 'gpt-oss:20b' })],
    ['POST /api/chat, valid key', 'POST', '/api/chat', 'valid', chat('gpt-oss:20b', false)],
    ['POST /api/chat, invalid key', 'POST', '/api/chat', 'invalid', chat('gpt-oss:20b', false)],
    ['POST /api/chat, missing key', 'POST', '/api/chat', 'missing', chat('gpt-oss:20b', false)],
    ['POST /api/chat, unknown model', 'POST', '/api/chat', 'valid', chat('no-such-model:1b', false)],
    ['POST /v1/chat/completions, wrong base path', 'POST', '/api/v1/chat/completions', 'valid', chat('gpt-oss:20b', false)],
  ];
  const H = ['content-type', 'www-authenticate', 'retry-after', 'access-control-allow-origin', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'ratelimit-limit', 'ratelimit-remaining'];
  const out = [];
  for (const [name, method, path, a, body] of cases) {
    const t0 = performance.now();
    try {
      const r = await fetch(B + path, { method, headers: { ...auth[a], ...(body ? { 'Content-Type': 'application/json' } : {}) }, body });
      const text = await r.text();
      const headers = Object.fromEntries(H.map((h) => [h, r.headers.get(h)]).filter(([, v]) => v != null));
      out.push({ ctx, name, ok: true, status: r.status, type: r.type, headers, body: text.slice(0, 240).split(key).join('<redacted>'), ms: Math.round(performance.now() - t0) });
    } catch (e) {
      out.push({ ctx, name, ok: false, errorName: e.name, errorMessage: e.message, ms: Math.round(performance.now() - t0) });
    }
  }
  return out;
};
