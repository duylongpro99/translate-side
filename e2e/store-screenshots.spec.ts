// The Chrome Web Store screenshots and promo tile (`pnpm run store:screenshots`, scripts/store-screenshots.mjs).
// Five 1280×800 screenshots and a 440×280 tile go to docs/store/assets/. They are made by the e2e harness
// against the mock provider and an article written for the purpose (fixtures/store/article.html), so no key,
// account or real page is in an image. The real side panel cannot be captured, so the panel and the page are
// two screenshots of the real UI placed side by side on one 1280×800 canvas.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { expect, jobSettled, test, type Extension } from './fixtures.ts';

test.skip(!process.env.STORE_SCREENSHOTS, 'run by scripts/store-screenshots.mjs');

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs/store/assets');
const PAGE_WIDTH = 860;
const PANEL_WIDTH = 420;

/** What the mock answers for the article's blocks: real Vietnamese, so the images show the product, not `vi:` prefixes. */
const VI: Record<string, string> = {
  "Keeping a small team's docs alive": 'Giữ cho tài liệu của một nhóm nhỏ luôn sống động',
  'A short guide for teams of five or fewer': 'Hướng dẫn ngắn cho các nhóm từ năm người trở xuống',
  'Most documentation does not fail because nobody wrote it. It fails because nobody noticed when it stopped being true. A page that was right in March is quietly wrong by June, and the people who trust it find out at the worst possible moment.':
    'Phần lớn tài liệu không hỏng vì không ai viết nó. Nó hỏng vì không ai nhận ra khi nó thôi đúng. Một trang đúng vào tháng Ba có thể đã lặng lẽ sai vào tháng Sáu, và những người tin vào nó chỉ biết điều đó vào lúc tệ nhất.',
  'Make the docs part of the change': 'Đưa tài liệu vào chính thay đổi',
  'The cheapest fix is to put the docs in the same repository as the code and review them in the same pull request. When a change alters behaviour, the reviewer asks one question: *which page does this make wrong?* If the answer is "none", the change ships. If not, the page is updated first.':
    'Cách rẻ nhất là đặt tài liệu trong cùng kho mã với mã nguồn và xem xét chúng trong cùng một pull request. Khi một thay đổi làm đổi hành vi, người xem xét chỉ hỏi một câu: *trang nào bị thay đổi này làm cho sai?* Nếu câu trả lời là "không trang nào", thay đổi được phát hành. Nếu không, trang đó được cập nhật trước.',
  'A doc that is not reviewed with the code will be reviewed by your users.': 'Tài liệu không được xem xét cùng với mã thì sẽ được chính người dùng của bạn xem xét.',
  'Give every page an owner': 'Giao mỗi trang cho một người phụ trách',
  'An owner is not the person who writes every word. It is the person who gets the message when the page is reported as wrong. Keep the list short and visible, and see the [link]owners handbook[/link] for a template.':
    'Người phụ trách không phải là người viết từng chữ. Đó là người nhận được tin nhắn khi trang bị báo là sai. Hãy giữ danh sách ngắn và dễ thấy, và xem [link]cẩm nang người phụ trách[/link] để lấy mẫu.',
  'Pick one owner per page, never a group.': 'Chọn một người phụ trách cho mỗi trang, đừng bao giờ chọn cả nhóm.',
  'Show the owner and the last review date at the top of the page.': 'Hiển thị người phụ trách và ngày xem xét gần nhất ở đầu trang.',
  'Rotate owners when someone changes teams.': 'Đổi người phụ trách khi ai đó chuyển nhóm.',
  'Check the examples, not just the prose': 'Kiểm tra cả ví dụ, không chỉ phần văn xuôi',
  "Examples rot fastest. Run them in your test suite, so a command that no longer works fails the build instead of a reader's afternoon.":
    'Ví dụ hỏng nhanh nhất. Hãy chạy chúng trong bộ kiểm thử, để một lệnh không còn chạy được làm hỏng bản dựng thay vì làm hỏng buổi chiều của người đọc.',
  'Teams that do this report fewer questions in chat and shorter onboarding. The habit costs about ten minutes a week.':
    'Các nhóm làm như vậy cho biết họ nhận ít câu hỏi hơn trong chat và việc làm quen nhanh hơn. Thói quen này tốn khoảng mười phút mỗi tuần.',
};

const GLOSSARY = [
  { term: 'pull request', rendering: 'pull request' },
  { term: 'onboarding', rendering: 'làm quen' },
  { term: 'repository', rendering: 'kho mã' },
];

async function prepare({ extension, mock }: { extension: Extension; mock: { answerWith(fn: (t: string) => string): void; delayAnswers(ms: number): void } }) {
  mock.answerWith((text) => VI[text] ?? `vi:${text}`);
  // The mock answers at once; a plausible duration is what the job bar should show (the model name and label say nothing of speed).
  mock.delayAnswers(1800);
  await extension.seed();
  // A friendlier connection name than the harness's "Mock"; the endpoint is still the mock on this computer.
  await extension.worker.evaluate(async (glossary) => {
    const got = await chrome.storage.sync.get('conn:mock');
    const prof = await chrome.storage.sync.get('profile:mock-model');
    await chrome.storage.sync.set({ siteNever: ['bank.example.com', '*.intranet.example.org'], 'conn:mock': { ...(got['conn:mock'] as object), label: 'My provider' }, glossary, 'profile:mock-model': { ...(prof['profile:mock-model'] as object), model: 'translate-1' } });
  }, GLOSSARY);
}

/**
 * Places two screenshots side by side on a 1280×800 canvas, as the page and the side panel sit in a window. The
 * canvas is drawn in a browser of its own: a new tab in the extension's window would become the active tab, and
 * the panel follows the active tab.
 */
async function compose(left: Buffer, right: Buffer, file: string) {
  const browser = await chromium.launch();
  try {
    const canvas = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const src = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
    await canvas.setContent(`<body style="margin:0;display:flex;background:#d9d6cd"><img src="${src(left)}" width="${PAGE_WIDTH}" height="800"><img src="${src(right)}" width="${PANEL_WIDTH}" height="800" style="box-shadow:-1px 0 0 #b9b5a8"></body>`);
    await canvas.waitForLoadState('load');
    await canvas.screenshot({ path: file });
  } finally {
    await browser.close();
  }
}

async function sized(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
}

/** Scrolls the settings page so the section with this heading starts at the top of the window. */
async function showSection(options: Page, heading: string) {
  await options.getByRole('heading', { name: heading, exact: true }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
}

const shot = (name: string) => path.join(OUT, name);

test.describe('English interface', () => {
  test('page with the panel, hover link, options and providers, glossary and site rules', async ({ extension, mock }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await prepare({ extension, mock });
    const page = await extension.open('store/article.html');
    const panel = await extension.panel();
    await sized(page, PAGE_WIDTH);
    await sized(panel, PANEL_WIDTH);
    await extension.translate(page);
    expect(await jobSettled(panel)).toBe('done');
    await expect(panel.locator('.seg[data-status=final]').first()).toContainText('Giữ cho tài liệu');

    // 1. The page with its translation beside it.
    await compose(await page.screenshot(), await panel.screenshot(), shot('01-page-and-panel.png'));

    const panelShot = await panel.screenshot();

    // 2. The hover link works both ways. Pointing at a block in the panel marks it on the page; pointing at it on the
    // page marks it in the panel. Both states belong to the same block, so the two halves are shot in turn.
    const block = panel.locator('.seg[data-id]').nth(4);
    // The panel is a background tab (fixtures.ts), where Playwright's own hover never sees a frame: send the pointer event.
    await block.dispatchEvent('mouseover');
    await expect.poll(async () => page.evaluate(() => document.getElementById('translate-side-link-style') !== null)).toBe(true);
    const pageMarked = await page.screenshot();
    await block.dispatchEvent('mouseout');
    await page.getByText('The cheapest fix is to put the docs').hover();
    await expect(panel.locator('.seg[data-linked]')).toHaveCount(1);
    await compose(pageMarked, await panel.screenshot(), shot('02-hover-link.png'));

    // 3 and 4. The settings page beside the panel: providers, then the glossary and the site rules. The panel is shot
    // first (opening the settings tab makes it the active tab, which the panel follows).
    const options = await extension.options();
    await sized(options, PAGE_WIDTH);
    await showSection(options, 'Providers');
    await compose(await options.screenshot(), panelShot, shot('03-options-providers.png'));
    await showSection(options, 'Personal glossary');
    await compose(await options.screenshot(), panelShot, shot('04-glossary-and-sites.png'));
  });
});

test.describe('Vietnamese interface', () => {
  test.use({ uiLang: 'vi' });
  test('the panel in Vietnamese', async ({ extension, mock }) => {
    await prepare({ extension, mock });
    const page = await extension.open('store/article.html');
    const panel = await extension.panel();
    await sized(page, PAGE_WIDTH);
    await sized(panel, PANEL_WIDTH);
    await extension.translate(page);
    expect(await jobSettled(panel)).toBe('done');
    await expect(panel.locator('.seg[data-status=final]').first()).toContainText('Giữ cho tài liệu');
    // The interface is in Vietnamese: the panel's own strings, not only the translation.
    await expect(panel.locator('html')).toHaveAttribute('lang', /^vi/);
    // The settings page in Vietnamese on the left (it takes the page's place), the panel on the right.
    // The panel is shot first: opening the settings tab makes it the active tab, which the panel follows.
    const panelShot = await panel.screenshot();
    const options = await extension.options();
    await sized(options, PAGE_WIDTH);
    await showSection(options, 'Nhà cung cấp');
    await compose(await options.screenshot(), panelShot, shot('05-vietnamese-interface.png'));
  });
});

test('the small promo tile', async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    const tile = await browser.newPage({ viewport: { width: 440, height: 280 } });
    await tile.goto(pathToFileURL(path.join(ROOT, 'scripts/store-tile.html')).href);
    await tile.waitForLoadState('load');
    await tile.screenshot({ path: shot('tile-440x280.png') });
  } finally {
    await browser.close();
  }
});

test('the store icon: the 128 px icon with its artwork at 96 px inside a 16 px transparent margin', async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const icon = fs.readFileSync(path.join(ROOT, 'public/icon/128.png')).toString('base64');
  const browser = await chromium.launch();
  try {
    const canvas = await browser.newPage({ viewport: { width: 128, height: 128 } });
    await canvas.setContent(`<body style="margin:0;background:transparent"><img src="data:image/png;base64,${icon}" width="96" height="96" style="position:absolute;left:16px;top:16px"></body>`);
    await canvas.waitForLoadState('load');
    await canvas.screenshot({ path: shot('store-icon-128.png'), omitBackground: true });
  } finally {
    await browser.close();
  }
});
