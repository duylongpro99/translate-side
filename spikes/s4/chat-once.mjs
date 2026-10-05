// One chat call to a named model on Ollama cloud (default qwen3.5:9b, which returned 404). Prints status + redacted short body only.
import { ollamaKey, redact } from './key.mjs';
const key = ollamaKey();
const model = process.argv[2] ?? 'qwen3.5:9b';
const r = await fetch('https://ollama.com/api/chat', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, stream: false, messages: [{ role: 'user', content: 'Reply with the single word: ok' }] }),
});
const b = await r.text();
console.log(model, r.status, r.headers.get('content-type'), '| body:', redact(b.slice(0, 300), key).replace(/\n/g, ' '));
