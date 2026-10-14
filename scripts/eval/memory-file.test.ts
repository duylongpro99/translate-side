import { describe, expect, it } from 'vitest';
import { parseMemoryFile } from './memory-file.ts';

const file = (entries: unknown[], format = 'translate-side-memory') => JSON.stringify({ format, formatVersion: 1, entries });

describe('parseMemoryFile', () => {
  it('keeps the entries of the target language, with a hashed id and no other field', () => {
    const out = parseMemoryFile(file([{ source: 'Save it', target: 'Lưu nó', targetLang: 'vi', origin: 'x' }, { source: 'Save it', target: 'Enregistrer', targetLang: 'fr' }, { source: ' ', target: 'x', targetLang: 'vi' }, { source: 'No target', targetLang: 'vi' }, 7]), 'VI');
    expect(out).toEqual([{ id: expect.stringMatching(/^m\.[0-9a-z]{11}$/), source: 'Save it', target: 'Lưu nó' }]);
  });
  it('rejects text that is not a memory file', () => {
    expect(() => parseMemoryFile('nope', 'vi')).toThrow('not JSON');
    expect(() => parseMemoryFile(file([], 'other'), 'vi')).toThrow('not a translate-side-memory file');
    expect(() => parseMemoryFile('null', 'vi')).toThrow('not a translate-side-memory file');
  });
});
