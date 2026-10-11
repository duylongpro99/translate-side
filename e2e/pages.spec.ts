// Every fixture page translated against the mock provider, each with an explicit expectation:
// - whole pages: every block the panel extracted shows a translation;
// - lazy pages (over LAZY_SEGMENTS translatable segments: long-100-screens, and large-table's 609
//   cells): the blocks around the viewport are translated first, then "Translate the rest"
//   translates every block.
// Every page also passes with zero console errors from the worker, the panel and the page (fixtures.ts).
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { blockStatuses, expect, jobSettled, test } from './fixtures.ts';

const sites = Object.keys(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../fixtures/sites/manifest.json'), 'utf8')) as Record<string, unknown>).map((slug) => `sites/${slug}.html`);
const PAGES: { fixture: string; mode: 'whole' | 'lazy' }[] = [
  ...sites.map((fixture) => ({ fixture, mode: 'whole' as const })),
  ...['spa/docusaurus.html', 'spa/mkdocs.html', 'spa/gitbook.html'].map((fixture) => ({ fixture, mode: 'whole' as const })),
  { fixture: 'long/large-table.html', mode: 'lazy' },
  { fixture: 'long/long-100-screens.html', mode: 'lazy' },
];

test('the suite covers 20 fixture pages', () => {
  expect(PAGES).toHaveLength(20);
});

/** Every block translated: none left in any state but final, or kept by design (code, numbers). */
async function expectAllTranslated(panel: Page) {
  await expect.poll(async () => Object.keys(await blockStatuses(panel)).filter((s) => s !== 'final' && s !== 'kept'), { timeout: 90_000 }).toEqual([]);
  expect((await blockStatuses(panel)).final ?? 0).toBeGreaterThan(0);
  await expect(panel.locator('.seg[data-status=final]').first()).toContainText('vi:');
}

for (const { fixture, mode } of PAGES) {
  test(`${fixture} (${mode})`, async ({ extension }) => {
    await extension.seed();
    const page = await extension.open(fixture);
    const panel = await extension.panel();
    await extension.translate(page);
    const job = panel.locator('[data-testid=job]');
    expect(await jobSettled(panel)).toBe('done');

    if (mode === 'lazy') {
      // The page opens at the top: the first blocks are on screen and translated, later ones wait.
      await expect(job).toContainText('the rest as you read');
      const statuses = await panel.locator('.seg[data-id]:not([data-status=kept])').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.status));
      expect(statuses.slice(0, 5)).toEqual(['final', 'final', 'final', 'final', 'final']);
      expect(statuses.filter((s) => s !== 'final').length).toBeGreaterThan(0);
      await panel.getByTestId('translate-rest').click();
      await expect(job).not.toContainText('the rest as you read', { timeout: 90_000 });
    }
    await expectAllTranslated(panel);
    expect(await job.getAttribute('data-status')).toBe('done');
  });
}
