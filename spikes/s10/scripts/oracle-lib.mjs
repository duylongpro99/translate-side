// Runs scripts/espeak-oracle.py in the dev-only virtualenvs under .cache/s10/ (see README "Rebuild").
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../../..');
export const cacheDir = resolve(repoRoot, '.cache/s10');
const script = resolve(here, 'espeak-oracle.py');

/** which: 'training' = piper_phonemize 1.1.0 (x86_64 wheel under Rosetta), 'current' = piper-tts (arm64). */
export function espeakPhonemes(voice, texts, which = 'training') {
  const input = JSON.stringify({ voice, texts });
  const [cmd, args] =
    which === 'training'
      ? ['arch', ['-x86_64', resolve(cacheDir, 'old-venv/bin/python'), '-I', script]]
      : [resolve(cacheDir, 'oracle-venv/bin/python'), ['-I', script]];
  return JSON.parse(execFileSync(cmd, args, { input, maxBuffer: 64 << 20 }).toString());
}
