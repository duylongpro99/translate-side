import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { featureAvailable, type FeatureId } from './features';

describe('featureAvailable', () => {
  it('answers true for both feature ids, without a network call', async () => {
    const fetched: unknown[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => (fetched.push(args), Promise.reject(new Error('no network')))) as typeof fetch;
    try {
      for (const id of ['best-mode', 'translation-memory'] satisfies FeatureId[]) expect(await featureAvailable(id)).toBe(true);
    } finally {
      globalThis.fetch = real;
    }
    expect(fetched).toEqual([]);
  });
});

describe('the best-mode check', () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

  it('is asked in one place that enforces it (the job start) and one that only displays it (the header)', () => {
    const root = join(process.cwd(), 'src');
    const sites = walk(root)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /featureAvailable\??\.?\(\s*'best-mode'/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f).split('\\').join('/'))
      .sort();
    expect(sites).toEqual(['entrypoints/sidepanel/HeaderControls.tsx', 'entrypoints/sidepanel/jobs.ts']);
  });
});
