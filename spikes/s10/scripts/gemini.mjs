// Tiny Gemini REST helper for the spike (dev-time only). Reads GEMINI_API_KEY from the repo's .env.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
function key() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const line = readFileSync(resolve(root, '.env'), 'utf8').split('\n').find((l) => l.startsWith('GEMINI_API_KEY='));
  if (!line) throw new Error('GEMINI_API_KEY missing');
  return line.slice('GEMINI_API_KEY='.length).trim().replace(/^['"]|['"]$/g, '');
}

export async function generate(model, parts, { json = false, temperature = 0, thinking } = {}) {
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
      ...(json ? { responseMimeType: 'application/json' } : {}),
      ...(thinking ? { thinkingConfig: thinking } : {}),
    },
  };
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key() },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(600_000),
      });
    } catch (err) {
      if (attempt < 4) continue;
      throw err;
    }
    if (res.ok) {
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    }
    if (attempt < 6 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, (res.status === 429 ? 20000 : 3000) * (attempt + 1)));
      continue;
    }
    throw new Error(`Gemini ${model} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
