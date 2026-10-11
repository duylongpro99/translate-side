// User flows over the extension, the fixture pages and the mock provider: the first-run privacy
// notice, an SPA route change, a rate-limited provider and a malformed stream. Zero console errors
// apply here too, apart from what a flow provokes on purpose (fixtures.ts `allowedConsole`).
import { blockStatuses, expect, jobSettled, test } from './fixtures.ts';

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
  expect(await extension.worker.evaluate(async () => (await chrome.storage.local.get('privacyNotice')).privacyNotice)).toMatchObject({ version: 1 });
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
