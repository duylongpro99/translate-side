// K8: is a 1-token chat call a usable key check on gpt-oss (a reasoning model)? Status, finish reason, content and
// reasoning sizes for each endpoint and key. Writes results/max-tokens-1.json.
import fs from 'node:fs';
import { ollamaKey, redact } from './key.mjs';
const key = ollamaKey();
const rows = [];
const call = async (name, ep, body, k) => {
  const r = await fetch('https://ollama.com' + ep, { method: 'POST', headers: { ...(k ? { Authorization: `Bearer ${k}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text();
  let finish = null, content = '', reasoning = '';
  if (body.stream) for (const l of t.split('\n')) { if (!l.startsWith('data: {')) continue; const j = JSON.parse(l.slice(6)); const c = j.choices?.[0]; if (!c) continue; content += c.delta?.content ?? ''; reasoning += c.delta?.reasoning ?? ''; finish = c.finish_reason ?? finish; }
  else { try { const j = JSON.parse(t); finish = j.choices?.[0]?.finish_reason ?? j.done_reason ?? null; content = j.choices?.[0]?.message?.content ?? j.message?.content ?? ''; reasoning = j.choices?.[0]?.message?.reasoning ?? j.message?.thinking ?? ''; } catch {} }
  rows.push({ name, status: r.status, finish, contentChars: content.length, reasoningChars: reasoning.length, body: r.status === 200 ? undefined : redact(t.slice(0, 160), key) });
  console.log(JSON.stringify(rows.at(-1)));
};
const msg = [{ role: 'user', content: 'ok' }];
await call('/v1 non-stream, max_tokens 1, valid key', '/v1/chat/completions', { model: 'gpt-oss:20b', max_tokens: 1, messages: msg }, key);
await call('/v1 stream, max_tokens 1, valid key', '/v1/chat/completions', { model: 'gpt-oss:20b', max_tokens: 1, stream: true, messages: msg }, key);
await call('/v1 non-stream, max_tokens 1, reasoning_effort low', '/v1/chat/completions', { model: 'gpt-oss:20b', max_tokens: 1, reasoning_effort: 'low', messages: msg }, key);
await call('/v1 non-stream, max_tokens 1, invalid key', '/v1/chat/completions', { model: 'gpt-oss:20b', max_tokens: 1, messages: msg }, 'invalid000');
await call('/v1 non-stream, max_tokens 1, unknown model', '/v1/chat/completions', { model: 'no-such-model:1b', max_tokens: 1, messages: msg }, key);
await call('/api/chat, num_predict 1, valid key', '/api/chat', { model: 'gpt-oss:20b', stream: false, options: { num_predict: 1 }, messages: msg }, key);
fs.writeFileSync('results/max-tokens-1.json', JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
