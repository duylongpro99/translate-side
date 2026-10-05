// Pre-commit guard: fails if the Ollama key (or its first 12 chars) appears in any tracked-or-untracked file outside
// node_modules. Prints counts only, never the key. Run from the repo root: node spikes/s4/leak-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ollamaKey } from './key.mjs';
const k = ollamaKey();
let n = 0; const hits = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  if (['node_modules', '.git'].includes(e.name)) continue;
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (e.isFile()) { n++; const s = fs.readFileSync(p, 'latin1'); if (s.includes(k) || s.includes(k.slice(0, 12))) hits.push(p); }
} };
walk('.');
console.log(`files scanned ${n}, key hits ${hits.length}`, hits);
process.exitCode = hits.length ? 1 : 0;
