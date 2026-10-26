// The selection button on every site (opt-in, decision S9): the option registers the selection script,
// whose button works on a page with no panel; never-translate sites get none; and the broad access does
// not let a navigation carry the panel to another origin. The extension copy here holds both broad
// patterns (fixtures.ts `broadAccess`), standing in for the user allowing access to all sites.
import type { Page } from '@playwright/test';
import { expect, test, type Extension } from './fixtures.ts';

test.use({ broadAccess: true });

const buttonBox = (page: Page) =>
  page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('translate-side-selection');
    if (!host || host.style.display !== 'block') return null;
    const r = host.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
const registered = (extension: Extension) => extension.worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
/** Selects the first paragraph with a triple click, once the page has stopped moving (a scroll hides the button). */
const selectParagraph = async (page: Page) => {
  await page.waitForTimeout(300);
  await page.locator('p').first().click({ clickCount: 3 });
  return (await page.evaluate(() => getSelection()?.toString() ?? '')).trim();
};

test('off by default; on, a page with no panel shows the button, and its click opens the panel on the selection, sending nothing else; off, it goes', async ({ extension, mock }) => {
  mock.answerWith((text) => `vi:${text}`);
  await extension.seed();
  // Off: nothing is registered, and a page with no panel has no button.
  expect(await registered(extension)).toEqual([]);
  let page = await extension.open('store/article.html');
  await selectParagraph(page);
  await page.waitForTimeout(400);
  expect(await buttonBox(page)).toBeNull();
  await page.close();

  const options = await extension.options();
  await options.getByTestId('selection-everywhere').check();
  await expect(options.getByTestId('sites-note')).toContainText('now shows on every site');
  await expect.poll(() => registered(extension)).toEqual(['selection-button']);

  page = await extension.open('store/article.html');
  await selectParagraph(page);
  await expect.poll(() => buttonBox(page)).not.toBeNull();
  // Turned off, a page already open loses the button at once.
  await options.getByTestId('selection-everywhere').uncheck();
  await expect(options.getByTestId('sites-note')).toContainText('chrome://extensions');
  await expect.poll(() => registered(extension)).toEqual([]);
  await page.bringToFront();
  await selectParagraph(page);
  await page.waitForTimeout(400);
  expect(await buttonBox(page)).toBeNull();

  await options.bringToFront();
  await options.getByTestId('selection-everywhere').check();
  await expect.poll(() => registered(extension)).toEqual(['selection-button']);
  await options.close();
  await page.reload();
  const text = await selectParagraph(page);
  await expect.poll(() => buttonBox(page)).not.toBeNull();
  const box = (await buttonBox(page)) as { x: number; y: number };
  await page.mouse.click(box.x, box.y);
  // The worker opened the panel and left the selection for it, as the context menu does.
  const tabId = await extension.worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id, page.url());
  await expect.poll(() => extension.worker.evaluate(async (id) => ((await chrome.storage.session.get(`snippet:${id}`))[`snippet:${id}`] as { text?: string } | undefined)?.text, tabId)).toBe(text);
  const panel = await extension.panel();
  await extension.worker.evaluate(async (id) => void (await chrome.tabs.update(id as number, { active: true })), tabId);
  await expect(panel.getByTestId('selection')).toContainText(`vi:${text.slice(0, 20)}`);
  // Only the selection went out, not the page (each panel open on the tab translates it once).
  await page.waitForTimeout(1000);
  const sent = mock.calls.filter((c) => c.kind === 'translate').flatMap((c) => c.segments);
  expect(sent.length).toBeGreaterThan(0);
  for (const segment of sent) expect(text).toContain(segment);
});

test('a never-translate site gets no button, and a navigation does not carry the panel to another origin', async ({ extension }) => {
  await extension.seed();
  await extension.worker.evaluate(() => Promise.all([chrome.storage.local.set({ selectionEverywhere: true }), chrome.storage.sync.set({ siteNever: ['localhost'] })]));
  await expect.poll(() => registered(extension)).toEqual(['selection-button']);
  const never = await extension.open('store/article.html', 'http://localhost:4173');
  await selectParagraph(never);
  await never.waitForTimeout(400);
  expect(await buttonBox(never)).toBeNull();

  // S9: with access to all sites, a tab read on one origin is not re-read on another after a link.
  await extension.worker.evaluate(() => chrome.storage.sync.set({ siteNever: [] }));
  const page = await extension.open('store/article.html');
  await extension.panel();
  await extension.translate(page);
  const tabId = await extension.worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id, page.url());
  await page.goto('http://localhost:4173/sites/goblog-pipelines.html');
  await expect.poll(() => extension.worker.evaluate(async (id) => ((await chrome.storage.session.get(`access:${id}`))[`access:${id}`] as { status?: string } | undefined)?.status, tabId)).toBe('lost');
});
