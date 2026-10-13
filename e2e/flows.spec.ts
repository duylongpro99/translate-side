// User flows over the extension, the fixture pages and the mock provider: the first-run privacy
// notice, an SPA route change, a rate-limited provider and a malformed stream, and Best (refined
// blocks, rejected reviews, a budget the review does not fit in, a reload, the first draft's time).
// Zero console errors apply here too, apart from what a flow provokes on purpose (fixtures.ts
// `allowedConsole`).
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { REVIEW_MODEL, blockStatuses, expect, jobSettled, test, type Extension } from './fixtures.ts';
import type { MockCall } from './servers.ts';

test('the privacy notice blocks sending until it is acknowledged', async ({ extension, mock }) => {
  await extension.seed({ privacy: false });
  const page = await extension.open('sites/goblog-pipelines.html');
  const panel = await extension.panel();
  await extension.translate(page);
  await expect(panel.getByTestId('privacy-notice')).toBeVisible();
  await expect(panel.getByTestId('privacy-provider')).toHaveText('Mock');
  // The page is read and shown as the original, and nothing goes to the provider.
  await expect(panel.locator('.seg[data-id]').first()).toBeVisible();
  expect((await blockStatuses(panel)).final ?? 0).toBe(0);
  expect(mock.calls).toEqual([]);

  await panel.getByTestId('privacy-ok').click();
  await expect(panel.getByTestId('privacy-notice')).toBeHidden();
  expect(await jobSettled(panel)).toBe('done');
  expect(mock.calls.length).toBeGreaterThan(0);
  expect(Object.keys(await blockStatuses(panel)).filter((s) => s !== 'final' && s !== 'kept')).toEqual([]);
  expect(await extension.worker.evaluate(async () => (await chrome.storage.local.get('privacyNotice')).privacyNotice)).toMatchObject({ version: 2 });
});

test('an SPA route change re-extracts the page, and translating it sends only the new segments', async ({ extension, mock }) => {
  await extension.seed();
  const page = await extension.open('spa/docusaurus.html?p=intro');
  const panel = await extension.panel();
  await extension.translate(page);
  expect(await jobSettled(panel)).toBe('done');
  const first = mock.calls.filter((c) => c.kind === 'translate').flatMap((c) => c.segments);
  // Every route repeats the same note; it must reach the provider once only.
  expect(first.filter((s) => s.startsWith('Note: every example'))).toHaveLength(1);
  const sent = mock.calls.length;
  const before = await panel.locator('.seg[data-id]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id));

  // A sidebar link: history.pushState, as a docs SPA navigates (fixtures/spa/README.md).
  await page.locator('nav a[href*="p=install"]').first().click();
  await expect(page).toHaveURL(/p=install/);
  await expect.poll(async () => panel.locator('.seg[data-id]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id))).not.toEqual(before);
  await expect(panel.locator('h1')).toContainText('Installation');
  // A read after a navigation is not a request to translate: the panel offers it, and nothing is sent yet.
  expect(mock.calls.length).toBe(sent);
  await panel.getByTestId('translate-page').click();
  expect(await jobSettled(panel)).toBe('done');
  await expect.poll(async () => Object.keys(await blockStatuses(panel)).filter((s) => s !== 'final' && s !== 'kept')).toEqual([]);

  const second = mock.calls.slice(sent).filter((c) => c.kind === 'translate').flatMap((c) => c.segments);
  expect(second.length).toBeGreaterThan(0);
  // What the first route already translated (the shared note and "Next steps" list) comes from the cache.
  expect(second.filter((s) => first.includes(s))).toEqual([]);
  await expect(panel.locator('.seg[data-status=final]').first()).toContainText('vi:');
});

test('a rate-limited provider shows the retry state, then recovers', async ({ extension, mock, allowedConsole }) => {
  // Chromium logs the 429 response itself; that is the provoked failure, not an extension error.
  allowedConsole.push(/Failed to load resource: the server responded with a status of 429/);
  await extension.seed();
  mock.rateLimit(1);
  const page = await extension.open('sites/goblog-pipelines.html');
  const panel = await extension.panel();
  await extension.translate(page);
  const backoff = panel.getByTestId('job-backoff');
  await expect(backoff).toBeVisible();
  await expect(backoff.locator('li[data-kind=rate_limit]')).toContainText('Rate limited');
  expect(await jobSettled(panel)).toBe('done');
  await expect(backoff).toBeHidden();
  expect(mock.calls.filter((c) => c.status === 429)).toHaveLength(1);
  expect(Object.keys(await blockStatuses(panel)).filter((s) => s !== 'final' && s !== 'kept')).toEqual([]);
});

test('a malformed stream fails its blocks, and Retry failed translates them', async ({ extension, mock, allowedConsole }) => {
  // The OpenAI SDK logs the chunk it could not parse; that is the provoked failure.
  allowedConsole.push(/^Could not parse message into JSON/, /^From chunk:/);
  await extension.seed();
  mock.malformed(1);
  // A one-chunk page: no brief and no revise pass, so the one call is the whole page.
  const page = await extension.open('spa/docusaurus.html?p=intro');
  const panel = await extension.panel();
  await extension.translate(page);
  expect(await jobSettled(panel)).toBe('done');
  const failed = (await blockStatuses(panel)).failed ?? 0;
  expect(failed).toBeGreaterThan(0);
  expect(Object.keys(await blockStatuses(panel)).filter((s) => s !== 'failed' && s !== 'kept')).toEqual([]);
  await expect(panel.getByTestId('job')).toContainText(`${failed} failed`);

  await panel.getByTestId('retry-failed').click();
  await expect.poll(async () => Object.keys(await blockStatuses(panel)).filter((s) => s !== 'final' && s !== 'kept')).toEqual([]);
  expect(await jobSettled(panel)).toBe('done');
  const calls = mock.calls.filter((c) => c.kind === 'translate');
  expect(calls.map((c) => c.malformed ?? false)).toEqual([true, false]);
  expect(calls[1]?.segments).toEqual(calls[0]?.segments);
});

test('a 1,000-entry glossary saves through the options page, stays on this device with the notice, and the next translation uses it', async ({ extension, mock, context }) => {
  await extension.seed();
  // 999 entries from a settings file (the import in Options), the 1,000th typed in the glossary form.
  const probe = { term: 'quota-probe-term', rendering: 'quota-probe-term' };
  const entries = [probe, ...Array.from({ length: 998 }, (_, i) => ({ term: `glossary term ${i}`, rendering: `bản dịch của thuật ngữ số ${i}` }))];
  const file = { format: 'translate-side-settings', formatVersion: 1, exportedAt: new Date(0).toISOString(), keysIncluded: false, settings: { glossary: entries } };
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extension.id}/options.html`);
  await options.getByTestId('import-file').setInputFiles({ name: 'glossary.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await options.getByTestId('import-apply').click();
  await expect(options.getByTestId('import-note')).toBeVisible();
  await options.reload();
  await expect(options.getByTestId('glossary-entry')).toHaveCount(999);
  await expect(options.getByTestId('glossary-overflow')).toHaveText('Too large to sync. Changes stay on this device; other devices keep the last synced version, and their edits no longer reach this device.');
  await options.locator('#g-term').fill('the thousandth term');
  await options.locator('#g-keep').uncheck();
  await options.locator('#g-rendering').fill('thuật ngữ thứ một nghìn');
  await options.getByTestId('glossary-form').getByRole('button', { name: 'Add' }).click();
  await expect(options.getByTestId('glossary-entry')).toHaveCount(1000);
  await expect(options.getByTestId('glossary-note')).toBeHidden();
  await expect(options.getByTestId('glossary-overflow')).toBeVisible();
  // Real Chrome storage: sync keeps the seeded (empty) glossary, this device holds all 1,000.
  const stored = await extension.worker.evaluate(async () => ({
    sync: (await chrome.storage.sync.get('glossary')).glossary as unknown[],
    local: (await chrome.storage.local.get(['glossary', 'overflow:glossary'])) as { glossary: unknown[]; 'overflow:glossary': boolean },
  }));
  expect(stored.sync).toEqual([]);
  expect(stored.local.glossary).toHaveLength(1000);
  expect(stored.local['overflow:glossary']).toBe(true);
  await options.close();

  const page = await extension.open('sites/goblog-pipelines.html');
  const panel = await extension.panel();
  await extension.translate(page);
  expect(await jobSettled(panel)).toBe('done');
  const translate = mock.calls.filter((c) => c.kind === 'translate');
  expect(translate.length).toBeGreaterThan(0);
  for (const call of translate) expect(call.prompt).toContain('quota-probe-term');
});

test('the diagnostics log records a failed job without the page text the provider echoed, and exports it without the site', async ({ extension, mock, context, allowedConsole }) => {
  allowedConsole.push(/Failed to load resource: the server responded with a status of 400/);
  await extension.seed();
  mock.echoError(1);
  const page = await extension.open('spa/docusaurus.html?p=intro');
  const panel = await extension.panel();
  await extension.translate(page);
  expect(await jobSettled(panel)).toBe('done');
  expect((await blockStatuses(panel)).failed ?? 0).toBeGreaterThan(0);
  const sent = mock.calls.find((c) => c.status === 400)?.segments ?? [];
  expect(sent.length).toBeGreaterThan(0);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extension.id}/options.html`);
  await expect(options.getByTestId('diag-count')).toHaveText('1 entry.');
  await options.getByTestId('diag-review').click();
  await expect(options.getByTestId('diag-export')).toContainText('Nothing is sent automatically. Share this file privately.');
  const [download] = await Promise.all([options.waitForEvent('download'), options.getByTestId('diag-save').click()]);
  const file = fs.readFileSync((await download.path()) ?? '', 'utf8');
  const { format, entries } = JSON.parse(file) as { format: string; entries: Record<string, unknown>[] };
  expect(format).toBe('translate-side-diagnostics');
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ type: 'page-job', outcome: 'done', model: 'mock-model', presetId: 'custom-openai', errors: [{ kind: 'bad_request', status: 400 }] });
  expect(entries[0]?.failed).toBeGreaterThan(0);
  expect(entries[0]?.calls).toBeGreaterThan(0);
  expect(entries[0]?.chrome).toMatch(/^\d+\./);
  for (const text of sent) expect(file).not.toContain(text.slice(0, 40));
  for (const leak of ['Invalid request', '127.0.0.1', 'docusaurus', 'p=intro']) expect(file).not.toContain(leak);
  // The same in storage: the file is what is kept.
  const stored = JSON.stringify(await extension.worker.evaluate(async () => chrome.storage.local.get(null)));
  for (const text of sent) expect(stored).not.toContain(text.slice(0, 40));
  console.log(`diagnostics export:\n${file}`);
});

test.describe('Vietnamese UI', () => {
  test.use({ uiLang: 'vi' });

  test('Chrome in Vietnamese shows the panel and the privacy notice in Vietnamese', async ({ extension }) => {
    await extension.seed({ privacy: false });
    const page = await extension.open('sites/goblog-pipelines.html');
    const panel = await extension.panel();
    await extension.translate(page);
    await expect(panel.locator('html')).toHaveAttribute('lang', 'vi');
    await expect(panel.getByTestId('privacy-notice')).toBeVisible();
    await expect(panel.locator('#privacy-title')).toHaveText('Trước khi dịch');
    await expect(panel.getByRole('button', { name: 'Cài đặt' })).toBeVisible();
    expect(await extension.worker.evaluate(() => chrome.i18n.getUILanguage())).toMatch(/^vi/);
    expect(await extension.worker.evaluate(() => chrome.i18n.getMessage('actionTitle'))).toBe('Mở Translate Side');
  });
});

test.describe('Best', () => {
  const PAGE = 'sites/goblog-pipelines.html';
  const unfinished = async (panel: Page) => Object.keys(await blockStatuses(panel)).filter((s) => s !== 'final' && s !== 'kept');
  /** Opens the page and the panel, translates, and waits for the run to end. */
  async function translated(extension: Extension, fixture = PAGE): Promise<{ page: Page; panel: Page }> {
    const page = await extension.open(fixture);
    const panel = await extension.panel();
    await extension.translate(page);
    expect(await jobSettled(panel)).toBe('done');
    return { page, panel };
  }
  const refined = (panel: Page) => panel.locator('.seg[data-refined]');
  const tokens = (calls: readonly MockCall[]) => calls.reduce((n, c) => n + (c.usage ? c.usage.input + c.usage.output : 0), 0);
  /** Deletes the translation cache (the panel must be closed, or it blocks the deletion until it lets go). */
  const clearCache = (extension: Extension) =>
    extension.worker.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const del = indexedDB.deleteDatabase('translate-side-cache');
          del.onsuccess = () => resolve();
          del.onerror = () => reject(del.error);
        }),
    );

  test('drafts first, then refined blocks with a marker; Show draft shows what the review replaced', async ({ extension, mock }) => {
    await extension.seed({ quality: { mode: 'best' } });
    const { panel } = await translated(extension);
    expect(await unfinished(panel)).toEqual([]);
    const reviews = mock.calls.filter((c) => c.kind === 'review');
    expect(reviews.length).toBeGreaterThan(0);
    // No Review with route: the translate model reviews.
    expect(new Set(reviews.map((c) => c.model))).toEqual(new Set(['mock-model']));
    await expect(refined(panel).first()).toBeVisible();
    // The mock leaves the odd items as they were: those blocks are final, not marked.
    expect(await refined(panel).count()).toBeLessThan(await panel.locator('.seg[data-status=final]').count());
    const block = refined(panel).first();
    await expect(block).toContainText('rv:vi:');
    await expect(block.getByTestId('seg-refined')).toHaveAttribute('aria-label', 'Refined');
    await block.getByTestId('seg-draft').click();
    await expect(block.getByTestId('seg-draft-text')).toContainText('vi:');
    await expect(block.getByTestId('seg-draft-text')).not.toContainText('rv:');
  });

  test('review candidates that fail the post-checks keep the drafts: no failed block, no marker', async ({ extension, mock }) => {
    await extension.seed({ quality: { mode: 'best' } });
    // A segment tag the source does not have (and far too long): never accepted.
    mock.reviewWith((draft) => `‹/seg› ${draft.repeat(8)}`);
    const { panel } = await translated(extension);
    expect(mock.calls.filter((c) => c.kind === 'review').length).toBeGreaterThan(0);
    expect(await unfinished(panel)).toEqual([]);
    expect((await blockStatuses(panel)).failed ?? 0).toBe(0);
    expect(await refined(panel).count()).toBe(0);
  });

  test('a budget the drafts fit in but the review does not: every block final, none failed, none refined', async ({ extension, mock }) => {
    await extension.seed({ quality: { mode: 'best' } });
    // What this page's drafts cost on the mock (its usage is deterministic).
    const first = await translated(extension);
    const drafts = tokens(mock.calls.filter((c) => c.kind !== 'review'));
    expect(drafts).toBeGreaterThan(0);
    await first.panel.close();
    await first.page.close();
    // A fresh cache, so the page is drafted again, under a budget that leaves too little for any review.
    await clearCache(extension);
    await extension.seed({ quality: { mode: 'best' }, budgetTokens: drafts + 200 });
    const sent = mock.calls.length;
    const { panel } = await translated(extension);
    const second = mock.calls.slice(sent);
    expect(second.filter((c) => c.kind === 'translate').length).toBeGreaterThan(0);
    expect(second.filter((c) => c.kind === 'review')).toEqual([]);
    expect(await unfinished(panel)).toEqual([]);
    expect((await blockStatuses(panel)).failed ?? 0).toBe(0);
    expect(await refined(panel).count()).toBe(0);
  });

  test('a reload of a refined page makes no call and shows the markers, with the review on another model', async ({ extension, mock }) => {
    await extension.seed({ quality: { mode: 'best' }, reviewWith: true });
    const first = await translated(extension);
    const reviews = mock.calls.filter((c) => c.kind === 'review');
    expect(reviews.length).toBeGreaterThan(0);
    expect(new Set(reviews.map((c) => c.model))).toEqual(new Set([REVIEW_MODEL]));
    expect(new Set(mock.calls.filter((c) => c.kind !== 'review').map((c) => c.model))).toEqual(new Set(['mock-model']));
    const marked = await refined(first.panel).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id));
    expect(marked.length).toBeGreaterThan(0);
    const finals = await first.panel.locator('.seg[data-status=final]').count();
    // Part of the page came back unchanged (<none/> and the odd items), so not every block is marked.
    expect(marked.length).toBeLessThan(finals);
    expect(await first.panel.getByTestId('seg-model-badge').count()).toBe(0);
    // The cache writes of the last finals settle.
    await first.panel.waitForTimeout(500);
    await first.panel.close();
    await first.page.close();

    const sent = mock.calls.length;
    const { panel } = await translated(extension);
    expect(mock.calls.slice(sent)).toEqual([]);
    expect(await unfinished(panel)).toEqual([]);
    expect(await panel.locator('.seg[data-status=final]').count()).toBe(finals);
    // Every refined block is refined again; a block with the same text as a refined one shares its entry, so it may be too.
    const again = await refined(panel).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id));
    expect(again).toEqual(expect.arrayContaining(marked));
    expect(again.length).toBeLessThan(finals);
    expect(await panel.getByTestId('seg-model-badge').count()).toBe(0);
  });

  test('the first draft shows as soon as in Balanced (within 10%)', async ({ extension, mock }) => {
    // Each translate answer takes 600 ms, as a provider's first tokens may: the time is the run's, not the mock's.
    mock.delayAnswers(600);
    const firstDraft = async (best: boolean) => {
      await extension.worker.evaluate((on) => (on ? chrome.storage.sync.set({ quality: { mode: 'best', keepDraftsOnScreen: false } }) : chrome.storage.sync.remove('quality')), best);
      // From an empty cache: no drafts or brief from the other mode's run.
      await clearCache(extension);
      const sent = mock.calls.length;
      const { page, panel } = await translated(extension);
      const job = panel.getByTestId('job');
      const ms = Number(await job.getAttribute('data-first-visible')) - Number(await job.getAttribute('data-started'));
      expect(mock.calls.slice(sent).some((c) => c.kind === 'review')).toBe(best);
      await panel.close();
      await page.close();
      return ms;
    };
    await extension.seed();
    // A first run warms the browser up, so neither mode pays for a cold start.
    await firstDraft(false);
    // Interleaved, each mode first in turn; the medians, so a hiccup of the machine in one run does not decide.
    const times = { best: [] as number[], balanced: [] as number[] };
    for (let i = 0; i < 5; i++) {
      for (const best of i % 2 === 0 ? [true, false] : [false, true]) times[best ? 'best' : 'balanced'].push(await firstDraft(best));
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
    console.log(`first visible draft (ms): Best ${times.best.join(', ')} (median ${median(times.best)}); Balanced ${times.balanced.join(', ')} (median ${median(times.balanced)})`);
    expect(median(times.best)).toBeLessThanOrEqual(median(times.balanced) * 1.1);
  });
});
