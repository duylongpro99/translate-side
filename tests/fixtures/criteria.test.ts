// Plan M0 §3 criteria #1–#3 on the ten fixtures (M0-E8). Per-fixture numbers are printed with
// `CRITERIA_REPORT=1 pnpm vitest run tests/fixtures/criteria.test.ts --silent=false`.
// jsdom can't evaluate CSS, so items hidden by site CSS (noise.json kind "hidden") are left to
// checkVisibility in Chrome (S3) and not counted here.
import { describe, expect, it } from 'vitest';
import { measure, type FixtureReport } from './criteria.ts';
import { slugs } from './load.ts';

const reports: FixtureReport[] = slugs.map(measure);

if (process.env.CRITERIA_REPORT) {
  const rows = reports.map(
    (r) =>
      `| ${r.slug} | ${r.via} | ${r.segments} | ${r.noise.length ? r.noise.join('; ') : '0'} | ${r.noiseSubstr.length} | ${r.hiddenNoise.length} | ${r.codeIntact}/${r.codeTruth} | ${r.codeUnmarked} | ${r.idsStable ? 'yes' : 'NO'} |`,
  );
  console.log(
    [
      '| fixture | via | segments | #1 noise segments | #1 substring upper bound | CSS-hidden items (Chrome drops) | #2 code intact | code not marked | #3 ids stable |',
      '|---|---|---|---|---|---|---|---|---|',
      ...rows,
    ].join('\n'),
  );
}

describe('M0 success criteria on the fixtures', () => {
  it('#1: at least 8 of 10 fixtures have no UI noise segments (fixtures/noise.json)', () => {
    const clean = reports.filter((r) => r.noise.length === 0).map((r) => r.slug);
    expect(clean.length).toBeGreaterThanOrEqual(8);
  });

  it.each(slugs)('#2: %s keeps every code block intact and marked do-not-translate', (slug) => {
    const r = reports.find((x) => x.slug === slug);
    expect(r?.codeIntact).toBe(r?.codeTruth);
    expect(r?.codeUnmarked).toBe(0);
  });

  it.each(slugs)('#3: %s has the same segment ids across two extractions', (slug) => {
    expect(reports.find((x) => x.slug === slug)?.idsStable).toBe(true);
  });
});
