// The storage fixtures carry placeholder keys only: a real key copied from .env must never reach
// the repository (it is public).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const PLACEHOLDER = /^sk-test-fixture-\d+$/;

describe('storage fixtures hold placeholder keys only', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));

  it('has the four shapes', () => {
    expect(files.sort()).toEqual(['m1.json', 'm3.json', 'm4.json', 'm5.json']);
  });

  it.each(files)('%s: every secret:* value is sk-test-fixture-<n>, and nothing else looks like a key', (file) => {
    const text = fs.readFileSync(path.join(DIR, file), 'utf8');
    const shape = JSON.parse(text) as Record<'sync' | 'local' | 'session', Record<string, unknown>>;
    for (const area of ['sync', 'local', 'session'] as const) {
      for (const [key, value] of Object.entries(shape[area])) {
        if (key.startsWith('secret:')) expect(value, `${file} ${area}.${key}`).toMatch(PLACEHOLDER);
      }
    }
    // A key anywhere else (a header, a URL): the shapes of real ones, outside the placeholders.
    const rest = text.replace(/sk-test-fixture-\d+/g, '');
    expect(rest).not.toMatch(/\b(?:sk|pk|rk|ak)-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|\b[A-Za-z0-9_-]{32,}\b/);
  });
});
