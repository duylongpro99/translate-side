// Free-plan key vs a non-free cloud model: status and body shape on both endpoints. Writes results/plan-402.json.
import fs from 'node:fs';
import { ollamaKey, redact } from './key.mjs';
const key = ollamaKey();
const rows = [];
for (const [ep, body] of [['/api/chat', { stream: false }], ['/v1/chat/completions', { stream: false }], ['/v1/chat/completions', { stream: true }]]) {
  for (const model of ['kimi-k3', 'glm-5.3', 'deepseek-v4-pro:0813']) {
    const r = await fetch('https://ollama.com' + ep, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: 'ok' }], ...body }) });
    rows.push({ ep, stream: body.stream, model, status: r.status, contentType: r.headers.get('content-type'), body: redact((await r.text()).slice(0, 260), key) });
    console.log(JSON.stringify(rows.at(-1)));
  }
}
fs.writeFileSync('results/plan-402.json', JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
