// How many concurrent chat requests does Ollama cloud accept for this key? Fires N at once, N = 1..6, with a pause between.
import fs from 'node:fs';
import { ollamaKey, redact } from './key.mjs';
const key = ollamaKey();
const one = async () => {
  const r = await fetch('https://ollama.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-oss:20b', max_tokens: 200, reasoning_effort: 'low', messages: [{ role: 'user', content: 'Count from 1 to 30 in words.' }] }) });
  return { status: r.status, retryAfter: r.headers.get('retry-after'), body: r.status === 200 ? '' : redact((await r.text()).slice(0, 120), key) };
};
const rows = [];
for (const n of (process.argv[2] ?? "1,2,3,4,5,6").split(",").map(Number)) {
  const res = await Promise.all(Array.from({ length: n }, one));
  const row = { n, statuses: res.map((r) => r.status), retryAfter: res.map((r) => r.retryAfter).filter(Boolean), bodies: [...new Set(res.map((r) => r.body).filter(Boolean))] };
  rows.push(row); console.log(JSON.stringify(row));
  await new Promise((s) => setTimeout(s, 3000));
}
fs.writeFileSync(`results/concurrency-${(process.argv[2] ?? '1-6').replaceAll(',', '-')}.json`, JSON.stringify({ at: new Date().toISOString(), model: 'gpt-oss:20b', rows }, null, 1));
