import { test, expect } from '@playwright/test';

/**
 * A sentence the host's voice fails on, and onSynthesizeError.
 *
 * One failed sentence used to end the whole reply, so a passing rate limit
 * on the voice cut the answer off mid-way. By default the sentence is now
 * asked for once more, then skipped, and the rest is spoken. The page is
 * sandbox/e2e/adapters.html; ?reply=stream-fail streams three sentences and
 * the voice fails on the second every time.
 */
type Page = import('@playwright/test').Page;
const probe = (page: Page) => page.evaluate(() => (window as any).__e2e);
/** The second word of each sentence: 'first', 'second', 'third'. */
const which = (texts: string[]) => texts.map(t => t.split(' ')[1]);

async function reply(page: Page, query: string) {
  await page.goto(`/e2e/adapters.html?${query}`);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
  await page.evaluate(() => (window as any).__e2e.sendText('Hello there'));
  await expect.poll(async () => (await probe(page)).inferenceEnded, { timeout: 15_000 }).toBe(1);
  await expect(page.locator('#status')).toHaveText('idle');
  return probe(page);
}

const SKIPPED = [{ stage: 'speech-synthesis', severity: 'degraded', detail: 'onSynthesize' }];

test('by default a failed sentence is asked for once more, then skipped, and the rest is spoken', async ({ page }) => {
  const p = await reply(page, 'reply=stream-fail');
  expect(which(p.synthesized)).toEqual(['first', 'second', 'second', 'third']);
  // Before: the reply ended at the second sentence.
  expect(which(p.played)).toEqual(['first', 'third']);
  expect(p.errors).toEqual(SKIPPED);
  expect(p.errorMessages[0]).toContain('skipped');
  expect(which(p.unspoken)).toEqual(['second']);
  // The reply itself was not abandoned.
  expect(p.aborted).toBe(0);
});

test('a sentence that works when asked again is spoken, and nothing is reported', async ({ page }) => {
  const p = await reply(page, 'reply=stream-fail-once');
  expect(which(p.synthesized)).toEqual(['first', 'second', 'second', 'third']);
  expect(which(p.played)).toEqual(['first', 'second', 'third']);
  expect(p.errors).toEqual([]);
  expect(p.unspoken).toEqual([]);
});

test("'skip' skips without asking again", async ({ page }) => {
  const p = await reply(page, 'reply=stream-fail&synthError=skip');
  expect(which(p.synthesized)).toEqual(['first', 'second', 'third']);
  expect(which(p.played)).toEqual(['first', 'third']);
  expect(p.errors).toEqual(SKIPPED);
  expect(which(p.unspoken)).toEqual(['second']);
  expect(p.aborted).toBe(0);
});

test("'end-turn' ends the reply at the failed sentence and aborts onSubmit", async ({ page }) => {
  const p = await reply(page, 'reply=stream-fail&synthError=end-turn');
  // Long enough for the third sentence to have played, had it been asked for.
  await page.waitForTimeout(2_000);
  const after = await probe(page);
  expect(which(after.synthesized)).toEqual(['first', 'second']);
  expect(which(after.played)).toEqual(['first']);
  expect(after.errors).toEqual(SKIPPED);
  expect(which(after.unspoken)).toEqual(['second']);
  expect(p.aborted).toBe(1);
});

test('a policy function decides each failure, told which attempt it is', async ({ page }) => {
  const p = await reply(page, 'reply=stream-fail&synthError=fn');
  expect(p.policyCalls.map((c: { text: string; attempt: number }) => [which([c.text])[0], c.attempt]))
    .toEqual([['second', 1], ['second', 2], ['second', 3]]);
  expect(which(p.synthesized)).toEqual(['first', 'second', 'second', 'second', 'third']);
  expect(which(p.played)).toEqual(['first', 'third']);
  expect(which(p.unspoken)).toEqual(['second']);
});

test('a streamed sentence that fails after it began is not asked for again, and the turn settles', async ({ page }) => {
  await page.goto('/e2e/adapters.html?voice=stream-fail');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
  const asked = Date.now();
  await page.evaluate(() => (window as any).__e2e.sendText('Hello there'));
  await expect.poll(async () => (await probe(page)).inferenceEnded, { timeout: 15_000 }).toBe(1);
  // At once, not on the ten-second watchdog.
  expect(Date.now() - asked).toBeLessThan(5_000);
  await expect(page.locator('#status')).toHaveText('idle');
  const p = await probe(page);
  // Asking again would have repeated the half second already heard.
  expect(p.synthesized).toEqual(['This is the reply.']);
  expect(p.played).toEqual(['This is the reply.']);
  expect(p.errors).toEqual(SKIPPED);
  expect(p.unspoken).toEqual(['This is the reply.']);
});
