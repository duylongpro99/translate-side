// Responsiveness and memory on the 100-screen fixture (e2e/budgets.json), measured from outside the
// extension over CDP (e2e/trace.ts): the page is read, its first screens translated, then "Translate the
// rest" translates every block. No task over the budget in the page's renderer (the content script reads
// and watches the page there) or in the panel's, and the JS heap of each tab within its budget afterwards.
// PERF_REPORT=1 prints every long task with the JS that ran in it.
import fs from 'node:fs';
import path from 'node:path';
import { blockStatuses, expect, jobSettled, test } from './fixtures.ts';
import { record } from './trace.ts';

interface Budgets {
  note: string;
  longTaskMs: { page: number; panel: number };
  heapBytes: { page: number; panel: number };
}

const budgets = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'budgets.json'), 'utf8')) as Budgets;

/** The outermost step of the extension's own work on the stack, else undefined (the innermost function). */
const STEPS = ['extractPage', 'composeDocument', 'runReadability', 'findMainContent', 'segment', 'keepIds', 'readSignature', 'indexTargets', 'watchViewport', 'patch', 'diff', 'render'];
function attribute(stack: string[]): string | undefined {
  for (const step of STEPS) if (stack.includes(step)) return step;
  return undefined;
}

for (const where of ['page', 'panel'] as const) {
  test(`a 100-screen page keeps the ${where} within its long-task and heap budgets`, async ({ extension, context }) => {
    await extension.seed();
    const page = await extension.open('long/long-100-screens.html');
    const panel = await extension.panel();
    const recording = await record(context, where === 'page' ? page : panel, attribute);
    await extension.translate(page);
    const job = panel.locator('[data-testid=job]');
    expect(await jobSettled(panel)).toBe('done');
    await expect(job).toContainText('the rest as you read');
    await panel.getByTestId('translate-rest').click();
    await expect(job).not.toContainText('the rest as you read', { timeout: 90_000 });
    await expect.poll(async () => Object.keys(await blockStatuses(panel)).filter((s) => s !== 'final' && s !== 'kept'), { timeout: 90_000 }).toEqual([]);
    const { tasks, heap } = await recording.stop();

    if (process.env.PERF_REPORT) {
      for (const t of tasks) console.log(`${where} ${t.ms.toFixed(1)} ms ${JSON.stringify(Object.fromEntries(Object.entries(t.js).sort((a, b) => b[1] - a[1]).slice(0, 8)))} ${JSON.stringify(t.render)}`);
      console.log(`${where} heap ${heap}`);
    }
    expect(Math.max(0, ...tasks.map((t) => t.ms)), `longest task in the ${where} renderer (ms)`).toBeLessThanOrEqual(budgets.longTaskMs[where]);
    expect(heap, `JS heap of the ${where} tab after a GC (bytes)`).toBeLessThanOrEqual(budgets.heapBytes[where]);
  });
}
