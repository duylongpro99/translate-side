// User flows over the extension, the fixture pages and the mock provider: the first-run privacy
// notice, an SPA route change, a rate-limited provider and a malformed stream, and Best (refined
// blocks, rejected reviews, a budget the review does not fit in, a reload, the first draft's time),
// and inline edits (kept across a reload and a cleared cache, Retranslate page, a block's Retranslate).
// Zero console errors apply here too, apart from what a flow provokes on purpose (fixtures.ts
// `allowedConsole`).
import { PRIVACY_NOTICE_VERSION } from '../src/entrypoints/sidepanel/privacy.ts';
import fs from 'node:fs';
import path from 'node:path';
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
  expect(await extension.worker.evaluate(async () => (await chrome.storage.local.get('privacyNotice')).privacyNotice)).toMatchObject({ version: PRIVACY_NOTICE_VERSION });
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

test('the header: one row at 320 and 480 px, its overlays inside the panel, and the Translation popover above a failure notice', async ({ extension, mock, allowedConsole }) => {
  allowedConsole.push(/^Could not parse message into JSON/, /^From chunk:/);
  await extension.seed();
  mock.malformed(1);
  const page = await extension.open('spa/docusaurus.html?p=intro');
  const panel = await extension.panel();
  await extension.translate(page);
  expect(await jobSettled(panel)).toBe('done');
  // A failure is something to say: the job bar shows it, under the header.
  await expect(panel.getByTestId('job')).toContainText('failed');
  await expect(panel.getByTestId('retry-failed')).toBeVisible();
  for (const width of [320, 480]) {
    await panel.setViewportSize({ width, height: 700 });
    const row = await panel.locator('.panel__bar').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, height: el.getBoundingClientRect().height }));
    expect(row.scroll, `the row at ${width}px`).toBeLessThanOrEqual(row.client);
    expect(row.height, `one row at ${width}px`).toBeLessThan(48);
    for (const [trigger, overlay] of [
      ['translation-button', 'translation-popover'],
      ['reading-button', 'reading-popover'],
      ['more-button', 'more-menu'],
    ] as const) {
      await panel.getByTestId(trigger).click();
      const box = (await panel.getByTestId(overlay).boundingBox()) ?? { x: -1, width: 0 };
      expect(box.x, `${overlay} left edge at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${overlay} right edge at ${width}px`).toBeLessThanOrEqual(width);
      // A second press of the trigger closes it.
      await panel.getByTestId(trigger).click();
      await expect(panel.getByTestId(overlay)).toBeHidden();
    }
  }
  // The popover is drawn above the job bar: the point at the quality select's center is the select.
  await panel.getByTestId('translation-button').click();
  const hit = await panel.getByTestId('quality-mode').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el;
  });
  expect(hit).toBe(true);
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
    // The header's More button, and Settings as its menu item (the menu stays closed while the notice waits).
    await expect(panel.getByRole('button', { name: 'Thêm', exact: true })).toBeVisible();
    await expect(panel.getByTestId('menu-settings')).toHaveText('Cài đặt');
    expect(await extension.worker.evaluate(() => chrome.i18n.getUILanguage())).toMatch(/^vi/);
    expect(await extension.worker.evaluate(() => chrome.i18n.getMessage('actionTitle'))).toBe('Mở Translate Side');
  });
});

test('Balanced sends exactly what it sent before Best existed (e2e/balanced-prompts.json)', async ({ extension, mock }) => {
  await extension.seed();
  const page = await extension.open('sites/goblog-pipelines.html');
  const panel = await extension.panel();
  await extension.translate(page);
  expect(await jobSettled(panel)).toBe('done');
  // Concurrent requests arrive in any order: compared sorted, each as the kind, status and every message sent.
  const calls = mock.calls.map((c) => ({ kind: c.kind, status: c.status, prompt: c.prompt })).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  const file = path.resolve(import.meta.dirname, 'balanced-prompts.json');
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8')) as { note: string; calls: unknown[] };
  if (process.env.UPDATE_BALANCED_PROMPTS) fs.writeFileSync(file, `${JSON.stringify({ ...snapshot, calls }, null, 1)}\n`);
  else expect(calls).toEqual(snapshot.calls);
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

  test('Review with is set in Options, the header switches Balanced to Best on that model, and back to Balanced with no call', async ({ extension, mock, context }) => {
    await extension.seed({ reviewWith: true });
    const stored = () => extension.worker.evaluate(async () => (await chrome.storage.sync.get('routing')).routing as { review?: string });
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extension.id}/options.html`);
    const review = options.locator('#route-review');
    await expect(review).toHaveValue('mock-review');
    await review.selectOption('');
    await expect.poll(async () => (await stored()).review).toBeUndefined();
    await review.selectOption('mock-review');
    await expect.poll(async () => (await stored()).review).toBe('mock-review');
    await options.close();

    const { panel } = await translated(extension);
    expect(mock.calls.filter((c) => c.kind === 'review')).toEqual([]);
    await expect(panel.getByTestId('quality-mode')).toHaveValue('balanced');
    await panel.waitForTimeout(500);

    // The quality select lives in the header's Translation popover.
    await panel.getByTestId('translation-button').click();
    await panel.getByTestId('quality-mode').selectOption('best');
    await expect.poll(() => mock.calls.filter((c) => c.kind === 'review').length).toBeGreaterThan(0);
    expect(await jobSettled(panel)).toBe('done');
    expect(new Set(mock.calls.filter((c) => c.kind === 'review').map((c) => c.model))).toEqual(new Set([REVIEW_MODEL]));
    await expect(refined(panel).first()).toBeVisible();
    await panel.waitForTimeout(500);

    const sent = mock.calls.length;
    await panel.getByTestId('quality-mode').selectOption('balanced');
    await expect.poll(async () => (await blockStatuses(panel)).final ?? 0).toBeGreaterThan(0);
    expect(await jobSettled(panel)).toBe('done');
    expect(await refined(panel).count()).toBe(0);
    expect(mock.calls.length).toBe(sent);
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

test.describe('Edits', () => {
  const PAGE = 'sites/goblog-pipelines.html';
  const EDIT = 'Bản dịch do tôi tự sửa';
  /** Every source the mock was sent since call `from`. */
  const sentSince = (calls: readonly MockCall[], from: number) => calls.slice(from).flatMap((c) => c.segments);

  /** Translates the page, edits its second paragraph with the keyboard, and returns the block and its source. */
  async function edited(extension: Extension) {
    const page = await extension.open(PAGE);
    const panel = await extension.panel();
    await extension.translate(page);
    expect(await jobSettled(panel)).toBe('done');
    const block = panel.locator('.seg--p[data-status=final]').nth(1);
    const id = (await block.getAttribute('data-id')) as string;
    await block.getByTestId('seg-edit').click();
    const area = block.getByTestId('seg-edit-text');
    await expect(area).toBeFocused();
    // The editor holds the shown text, light markers included; the mock's text is "vi:" + the source.
    const shown = await area.inputValue();
    expect(shown.startsWith('vi:')).toBe(true);
    await area.fill(EDIT);
    await area.press('Control+Enter');
    await expect(block).toHaveAttribute('data-edited', 'user');
    await expect(block.getByTestId('seg-edited')).toBeVisible();
    await expect(block).toContainText(EDIT);
    await expect(block).toBeFocused();
    return { page, panel, id, source: shown.slice('vi:'.length) };
  }

  test('an edit survives a reload and a cleared cache, and its block is never sent again', async ({ extension, mock }) => {
    await extension.seed();
    const first = await edited(extension);
    // "Clear cache" leaves the memory as it is.
    const options = await extension.options();
    await expect(options.getByTestId('memory-stats')).toHaveText('1 of 5,000 corrections.');
    await options.getByTestId('cache-clear').click();
    await expect(options.getByTestId('cache-stats')).toContainText('0 translated blocks');
    await options.reload();
    await expect(options.getByTestId('memory-stats')).toHaveText('1 of 5,000 corrections.');
    await options.close();
    await first.panel.close();
    await first.page.close();

    const sent = mock.calls.length;
    const page = await extension.open(PAGE);
    const panel = await extension.panel();
    await extension.translate(page);
    expect(await jobSettled(panel)).toBe('done');
    const block = panel.locator(`.seg[data-id="${first.id}"]`);
    await expect(block).toHaveAttribute('data-edited', 'user');
    await expect(block).toContainText(EDIT);
    // The cache was cleared, so the rest of the page went to the mock again; the edited block did not.
    const again = sentSince(mock.calls, sent);
    expect(again.length).toBeGreaterThan(0);
    expect(again).not.toContain(first.source);
  });

  test('Retranslate page keeps the edit; a block Retranslate asks first, and replaces it only when confirmed', async ({ extension, mock }) => {
    await extension.seed();
    const { panel, id, source } = await edited(extension);
    const block = panel.locator(`.seg[data-id="${id}"]`);

    let sent = mock.calls.length;
    await panel.getByTestId('page-retranslate').click();
    await expect.poll(() => mock.calls.length).toBeGreaterThan(sent);
    expect(await jobSettled(panel)).toBe('done');
    await expect(panel.getByTestId('job-edits-kept')).toHaveText('1 edited block kept');
    await expect(block).toContainText(EDIT);
    expect(sentSince(mock.calls, sent)).not.toContain(source);

    sent = mock.calls.length;
    await block.getByTestId('seg-retranslate').click();
    const confirm = block.getByTestId('seg-replace-confirm');
    await expect(confirm).toContainText('Replace your edit?');
    await expect(block.getByTestId('seg-replace-no')).toBeFocused();
    await block.getByTestId('seg-replace-no').click();
    await expect(confirm).toBeHidden();
    await expect(block).toHaveAttribute('data-edited', 'user');
    expect(mock.calls.length).toBe(sent);

    await block.getByTestId('seg-retranslate').click();
    await block.getByTestId('seg-replace-yes').click();
    await expect(block).not.toHaveAttribute('data-edited', /.*/);
    await expect(block).toContainText('vi:');
    expect(sentSince(mock.calls, sent)).toEqual([source]);
    const options = await extension.options();
    await expect(options.getByTestId('memory-stats')).toHaveText('0 of 5,000 corrections.');
  });
});

test.describe('Corrections as examples on later pages', () => {
  const CORRECTION = 'Bộ lập lịch giao từng tác vụ cho worker rảnh đầu tiên.';
  const LOCAL_ORIGIN = 'http://localhost:4173';
  const TEXT = { a: 'The scheduler hands every queued task', b: 'The scheduler hands each queued task' };

  /** Translates page A (on `origin`), corrects its second paragraph and closes everything, so page B starts a fresh run. */
  async function correctOnA(extension: Extension, origin?: string) {
    const page = await extension.open('memory/page-a.html', origin);
    const panel = await extension.panel();
    await extension.translate(page);
    expect(await jobSettled(panel)).toBe('done');
    // Found by its text first: the editor replaces the text, so it is addressed by id afterwards.
    const id = (await panel.locator('.seg--p[data-status=final]', { hasText: TEXT.a }).getAttribute('data-id')) as string;
    const block = panel.locator(`.seg[data-id="${id}"]`);
    await block.getByTestId('seg-edit').click();
    const area = block.getByTestId('seg-edit-text');
    await area.fill(CORRECTION);
    await area.press('Control+Enter');
    await expect(block).toHaveAttribute('data-edited', 'user');
    // The correction is saved before the next page starts: the options page counts it.
    const options = await extension.options();
    await expect(options.getByTestId('memory-stats')).toHaveText('1 of 5,000 corrections.');
    await options.close();
    await panel.close();
    await page.close();
  }

  /** Translates page B and returns the translate calls the mock saw for it. */
  async function translateB(extension: Extension, mock: { calls: MockCall[] }) {
    const from = mock.calls.length;
    const page = await extension.open('memory/page-b.html');
    const panel = await extension.panel();
    await extension.translate(page);
    expect(await jobSettled(panel)).toBe('done');
    const calls = mock.calls.slice(from).filter((c) => c.kind === 'translate');
    // The similar sentence itself was sent to the model: it is not the exact one the user corrected.
    expect(calls.flatMap((c) => c.segments).some((s) => s.startsWith(TEXT.b))).toBe(true);
    return { calls, panel };
  }

  const records = (extension: Extension) =>
    extension.worker.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).flatMap(([k, v]) => (k.startsWith('diag:') ? [v as { memory?: { hits: number; ids: string[] } }] : [])));

  test('a correction made on one page reaches the prompt for a similar sentence on another, and is logged by id', async ({ extension, mock }) => {
    await extension.seed();
    await correctOnA(extension);
    const { calls } = await translateB(extension, mock);

    const prompt = calls.map((c) => c.prompt).find((p) => p.includes(CORRECTION)) ?? '';
    expect(prompt, 'the correction is in the chunk of page B that holds the similar sentence').not.toBe('');
    // Inside the user message's context block, not the system block that is cached.
    const context = prompt.slice(prompt.indexOf('<context>'), prompt.indexOf('</context>'));
    expect(context).toContain(`<translation>${CORRECTION}</translation>`);

    // The record keeps a count and hashed ids, never the text.
    const logged = (await records(extension)).filter((r) => r.memory);
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.at(-1)?.memory?.hits).toBeGreaterThanOrEqual(1);
    expect(logged.at(-1)?.memory?.ids[0]).toMatch(/^m\./);
    expect(JSON.stringify(await records(extension))).not.toContain(CORRECTION);
  });

  test('a correction made under a local-only site rule never reaches a request on another route, even with the setting on', async ({ extension, mock }) => {
    await extension.seed();
    await extension.worker.evaluate(async () => {
      await chrome.storage.sync.set({ siteRules: [{ pattern: 'localhost', translate: 'mock-model', localOnly: true }] });
      await chrome.storage.local.set({ memoryAcrossSites: true });
    });
    await correctOnA(extension, LOCAL_ORIGIN);
    const { calls } = await translateB(extension, mock);
    expect(calls.map((c) => c.prompt).filter((p) => p.includes(CORRECTION))).toEqual([]);
    expect((await records(extension)).filter((r) => r.memory)).toEqual([]);
  });

  test('a correction from another site is sent only when the setting is on', async ({ extension, mock }) => {
    await extension.seed();
    await correctOnA(extension, LOCAL_ORIGIN);
    expect((await translateB(extension, mock)).calls.map((c) => c.prompt).filter((p) => p.includes(CORRECTION))).toEqual([]);

    // The first run cached page B: clear the cache so the similar sentence goes to the model again.
    const options = await extension.options();
    await options.getByTestId('cache-clear').click();
    await expect(options.getByTestId('cache-stats')).toContainText('0 translated blocks');
    await options.close();
    await extension.worker.evaluate(() => chrome.storage.local.set({ memoryAcrossSites: true }));
    const again = await translateB(extension, mock);
    expect(again.calls.map((c) => c.prompt).filter((p) => p.includes(CORRECTION)).length).toBeGreaterThan(0);
  });
});
