// Reads OLLAMA_API_KEY from the .env file named by OLLAMA_ENV_FILE (the main checkout's .env; never copied, printed or
// committed). Usage: OLLAMA_ENV_FILE=/path/to/.env node <script>
import fs from 'node:fs';
export function ollamaKey() {
  const ENV = process.env.OLLAMA_ENV_FILE;
  if (!ENV) throw new Error('Set OLLAMA_ENV_FILE to the .env file that holds OLLAMA_API_KEY');
  const line = fs.readFileSync(ENV, 'utf8').split('\n').find((l) => l.startsWith('OLLAMA_API_KEY='));
  if (!line) throw new Error('OLLAMA_API_KEY not found');
  return line.slice('OLLAMA_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
}
export const redact = (s, key) => String(s).split(key).join('<redacted>');
