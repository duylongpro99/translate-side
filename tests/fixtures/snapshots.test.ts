// Segmentation snapshots of the ten fixtures (plan M0-E8). One readable file per fixture under
// fixtures/snapshots/ (fixture-derived text stays under fixtures/, which the LICENSE excludes).
// After an intended extraction change, review the diff and run `pnpm vitest run -u tests/fixtures`.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Segment } from '@/engine/types';
import { extractPage } from '@/extract';
import { FIXTURES, loadFixture, slugs } from './load.ts';

function format(segments: Segment[], via: string): string {
  const lines = [`# via ${via} · ${segments.length} segments`];
  for (const s of segments) {
    const flags = [
      s.level ? `h${s.level}` : '',
      s.translate ? '' : 'no-translate',
      s.hidden ? 'hidden' : '',
      s.groupId ? `group=${s.groupId}` : '',
      s.codeLang ? `lang=${s.codeLang}` : '',
    ].filter(Boolean);
    lines.push(`${s.id} ${s.kind}${flags.length ? ` [${flags.join(' ')}]` : ''} ${s.domPath}`);
    lines.push(...s.inlineMarkup.split('\n').map((l) => `  ${l}`));
  }
  return `${lines.join('\n')}\n`;
}

describe('fixture segmentation snapshots', () => {
  it.each(slugs)('%s', async (slug) => {
    const r = extractPage(loadFixture(slug));
    if (!r.ok) throw new Error(`${slug}: ${r.reason}`);
    await expect(format(r.segments, r.via)).toMatchFileSnapshot(path.join(FIXTURES, 'snapshots', `${slug}.segments.txt`));
  });
});
