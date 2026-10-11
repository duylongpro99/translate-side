import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from './shortcuts.ts';

describe('the shortcut list', () => {
  it('lists Alt+T, and no key twice', () => {
    expect(SHORTCUTS[0]?.keys).toBe('Alt+T');
    const keys = SHORTCUTS.map((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is the list the README shows', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    const section = readme.slice(readme.indexOf('### Keyboard shortcuts'), readme.indexOf('### Useful scripts'));
    const rows = section.split('\n').filter((l) => l.startsWith('| <kbd>'));
    expect(rows).toHaveLength(SHORTCUTS.length);
    // Same description, same order (the keys are marked up there, so compare the text).
    rows.forEach((row, i) => expect(row.replace(/<\/?kbd>/g, '').replace(/\s+/g, ' ')).toContain(SHORTCUTS[i]?.what.replace(/\(rebind.*\)/, '').trim() ?? ''));
  });
});
