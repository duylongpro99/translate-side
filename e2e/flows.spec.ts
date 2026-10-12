// User flows over the extension, the fixture pages and the mock provider: the first-run privacy
// notice, an SPA route change, a rate-limited provider and a malformed stream. Zero console errors
// apply here too, apart from what a flow provokes on purpose (fixtures.ts `allowedConsole`).
import fs from 'node:fs';
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
