// Which Ollama cloud endpoints accept the key, and is qwen3.5:9b there? Prints status + short bodies only.
import { ollamaKey, redact } from './key.mjs';
const key = ollamaKey();
const tries = [
  ['GET', 'https://ollama.com/api/tags', true],
  ['GET', 'https://ollama.com/v1/models', true],
  ['GET', 'https://ollama.com/api/tags', false],
  ['GET', 'https://ollama.com/v1/models', false],
];
for (const [m, u, auth] of tries) {
  const r = await fetch(u, { method: m, headers: auth ? { Authorization: `Bearer ${key}` } : {} });
  const b = await r.text();
  let names = '';
  try { const j = JSON.parse(b); names = (j.models ?? j.data ?? []).map((x) => x.name ?? x.id).filter((n) => /qwen/i.test(n)).join(', '); } catch {}
  console.log(m, u, 'auth=' + auth, r.status, 'qwen models:', names || '-', '| body:', redact(b.slice(0, 160), key).replace(/\n/g, ' '));
}
