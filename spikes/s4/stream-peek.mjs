// One streaming call on the OpenAI-compatible endpoint: how do content and reasoning arrive? Prints redacted chunk shapes.
import { ollamaKey, redact } from './key.mjs';
const key = ollamaKey();
const model = process.argv[2] ?? 'gpt-oss:20b';
const extra = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const r = await fetch('https://ollama.com/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true }, max_tokens: 400, ...extra,
    messages: [{ role: 'system', content: 'Translate to German. Output each segment as <seg id="N">…</seg>.' }, { role: 'user', content: '<seg id="1">Hello world.</seg>\n<seg id="2">Use `Vec<T>` here.</seg>' }] }),
});
console.log('status', r.status, r.headers.get('content-type'));
const t = await r.text();
const lines = t.split('\n').filter(Boolean);
console.log('lines', lines.length);
for (const l of [...lines.slice(0, 4), '...', ...lines.slice(-4)]) console.log(redact(l, key).slice(0, 400));
let content = '', reasoning = '';
for (const l of lines) { if (!l.startsWith('data: {')) continue; const j = JSON.parse(l.slice(6)); const d = j.choices?.[0]?.delta ?? {}; content += d.content ?? ''; reasoning += d.reasoning ?? d.reasoning_content ?? ''; }
console.log('CONTENT:', JSON.stringify(content)); console.log('REASONING chars:', reasoning.length, JSON.stringify(reasoning.slice(0, 200)));
