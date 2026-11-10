// The panel is per tab (decision S12): bound to the tab it was opened for by its `?tab=` query, it serves
// that tab only, keeps translating it while another tab is in front, and answers the toolbar/Alt+T close
// question for that tab only. Whether Chrome shows the panel on a tab cannot be driven from Playwright: the
// spike (spikes/s12) and the owner's manual check cover that.
import { blockStatuses, expect, jobSettled, test } from './fixtures.ts';

/** CLOSE_PANEL_MESSAGE in src/shared/panel.ts (that module's wxt types are outside the e2e project). */
const CLOSE_PANEL_MESSAGE = 'translate-side:close-panel';

test("a panel serves its own tab: another tab in front changes nothing, and its job finishes there", async ({ extension, mock }) => {
  await extension.seed();
  // Slow answers, so the job is still running when the reader moves to another tab.
  mock.delayAnswers(800);
  const a = await extension.open('sites/goblog-pipelines.html');
  const panel = await extension.panel(a);
  await extension.translate(a);
  const job = panel.getByTestId('job');
  await expect(job).toHaveAttribute('data-status', 'running');
  const title = await panel.locator('.seg[data-id]').first().textContent();

  // Another page comes to the front, and is read in its own right (as if its own panel had been opened).
  const b = await extension.open('store/article.html');
  await b.bringToFront();
  await extension.translate(b);

  // The panel still shows A, is not paused, and A's job finishes while B is in front.
  expect(await jobSettled(panel)).toBe('done');
  await expect(panel.locator('.seg[data-id]').first()).toContainText(title ?? 'missing');
  expect(Object.keys(await blockStatuses(panel)).filter((s) => s !== 'final' && s !== 'kept')).toEqual([]);
});

test("the close question for another tab is not this panel's; the one for its own tab is", async ({ extension }) => {
  await extension.seed();
  const a = await extension.open('sites/goblog-pipelines.html');
  const b = await extension.open('store/article.html');
  const panel = await extension.panel(a);
  await extension.translate(a);
  await expect(panel.locator('.seg[data-id]').first()).toBeVisible();
  const ask = (url: string) =>
    extension.worker.evaluate(
      async ([type, url]) => {
        const [tab] = await chrome.tabs.query({ url });
        // What the worker sends on a toolbar click or Alt+T on that tab (src/shared/panel.ts togglePanelAndInject).
        return chrome.runtime.sendMessage({ type, tabId: tab?.id, pressedAt: Date.now() }).catch(() => undefined);
      },
      [CLOSE_PANEL_MESSAGE, url] as const,
    );
  expect(await ask(b.url())).toBeUndefined();
  await expect(panel.locator('.seg[data-id]').first()).toBeVisible();
  const closed = panel.waitForEvent('close');
  expect(await ask(a.url())).toEqual({ closed: true });
  // The panel disabled its tab's panel, so it stays closed there until opened again, and closed itself (a page in
  // a tab here, which sidePanel.close cannot close).
  await closed;
  const options = await extension.worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return chrome.sidePanel.getOptions({ tabId: tab?.id });
  }, a.url());
  expect(options.enabled).toBe(false);
});
