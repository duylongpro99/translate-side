// Before and after screenshots of the UI refresh (`pnpm run ui:screens -- before|after`, scripts/ui-screens.mjs):
// the panel with the translated store article, the top of the settings page and onboarding step 1, each at
// panel widths of 320 and 480 px, in every theme the extension has. Made against the mock provider, so no key,
// account or real page is in an image.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, jobSettled, test } from './fixtures.ts';
import { VI } from './store-article.ts';

const MODE = process.env.UI_SCREENS;
test.skip(MODE !== 'before' && MODE !== 'after', 'run by scripts/ui-screens.mjs');

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = process.env.UI_SCREENS_DIR ?? path.join(ROOT, 'plans/261018-0900-m8-ui-ux-refresh/screens', MODE ?? '');
const WIDTHS = [320, 480];
// The UI before the refresh follows the system theme only; paper exists from the refresh on.
const THEMES = MODE === 'after' ? (['light', 'dark', 'paper'] as const) : (['light', 'dark'] as const);

for (const theme of THEMES) {
  test(`panel, settings and onboarding in the ${theme} theme`, async ({ extension, mock }) => {
    fs.mkdirSync(OUT, { recursive: true });
    mock.answerWith((text) => VI[text] ?? `vi:${text}`);
    await extension.seed();
    await extension.worker.evaluate((t) => chrome.storage.sync.set({ reading: { theme: t } }), theme);
    const scheme = theme === 'dark' ? 'dark' : 'light';
    const look = async (p: Page, width: number) => {
      await p.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await p.setViewportSize({ width, height: 800 });
    };

    const page = await extension.open('store/article.html');
    const panel = await extension.panel();
    await look(panel, WIDTHS[0] as number);
    await extension.translate(page);
    expect(await jobSettled(panel)).toBe('done');
    await expect(panel.locator('.seg[data-status=final]').first()).toContainText('Giữ cho tài liệu');
    for (const width of WIDTHS) {
      await look(panel, width);
      await panel.evaluate(() => window.scrollTo(0, 0));
      await panel.screenshot({ path: path.join(OUT, `panel-${theme}-${width}.png`) });
    }

    // Opening the settings tab makes it the active tab, which the panel follows: the panel is shot first.
    const options = await extension.options();
    for (const width of WIDTHS) {
      await look(options, width);
      await options.screenshot({ path: path.join(OUT, `options-${theme}-${width}.png`) });
    }

    const onboarding = await options.context().newPage();
    await look(onboarding, WIDTHS[0] as number);
    await onboarding.goto(`chrome-extension://${extension.id}/onboarding.html`);
    await expect(onboarding.locator('h2').first()).toBeVisible();
    for (const width of WIDTHS) {
      await look(onboarding, width);
      await onboarding.screenshot({ path: path.join(OUT, `onboarding-${theme}-${width}.png`) });
    }
  });
}
