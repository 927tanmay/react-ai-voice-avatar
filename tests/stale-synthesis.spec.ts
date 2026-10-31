import { test, expect } from '@playwright/test';

/**
 * A sentence of an abandoned reply that the host's voice answers late.
 *
 * Its result has to go nowhere: not played into the next turn, not reported
 * as a failure, and not taken as the voice failing on the reply that
 * replaced it. The page is sandbox/e2e/adapters.html.
 */
type Page = import('@playwright/test').Page;
const probe = (page: Page) => page.evaluate(() => (window as any).__e2e);
const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([fn, args]) => (window as any).__e2e[fn as string](...(args as unknown[])), [fn, args] as const);

async function open(page: Page, query: string) {
  await page.goto(`/e2e/adapters.html?${query}`);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
}

const REPLY_2 = [1, 2, 3].map(n => `Reply 2 sentence ${n} is long enough to be spoken.`);

/** Ask, stop the reply while its first sentence is with the voice, ask again. */
async function interruptThenAskAgain(page: Page) {
  await call(page, 'sendText', 'First question');
  await expect.poll(async () => (await probe(page)).synthesized.length).toBe(1);
  await call(page, 'interrupt');
  await call(page, 'sendText', 'Second question');
}

test('a sentence the voice answers after an interrupt is not heard in the next reply', async ({ page }) => {
  await open(page, 'reply=numbered&voice=late');
  await interruptThenAskAgain(page);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 20_000 });
  const p = await probe(page);
  expect(p.played).toEqual(REPLY_2);
  expect(p.errors).toEqual([]);
  // Only the first reply was abandoned.
  expect(p.aborted).toBe(1);
});

test('a sentence the voice fails on after an interrupt does not end the next reply', async ({ page }) => {
  await open(page, 'reply=numbered&voice=late-fail');
  await interruptThenAskAgain(page);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 20_000 });
  const p = await probe(page);
  expect(p.played).toEqual(REPLY_2);
  expect(p.errors).toEqual([]);
  expect(p.aborted).toBe(1);
});

test('a sentence still being decoded when interrupted is not heard in the next reply', async ({ page }) => {
  await open(page, 'reply=numbered&voice=wav&decode=slow');
  await interruptThenAskAgain(page);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 20_000 });
  const p = await probe(page);
  // Before: "Reply 1 sentence 1" finished decoding into the second reply.
  expect(p.played).toEqual(REPLY_2);
  expect(p.errors).toEqual([]);
});

test('speak() interrupted while decoding does not play into the next speak()', async ({ page }) => {
  await open(page, 'voice=wav&decode=slow');
  await call(page, 'speak', 'This first announcement is long enough to be spoken.');
  await expect.poll(async () => (await probe(page)).synthesized.length).toBe(1);
  await call(page, 'interrupt');
  await call(page, 'speak', 'This second announcement is long enough to be spoken.');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 20_000 });
  const p = await probe(page);
  expect(p.played).toEqual(['This second announcement is long enough to be spoken.']);
  expect(p.errors).toEqual([]);
});

test('a new question while speaking drops the old reply\'s sentences still waiting for the voice', async ({ page }) => {
  await open(page, 'reply=numbered&voice=slow');
  await call(page, 'sendText', 'First question');
  await expect(page.locator('#status')).toHaveText('speaking', { timeout: 10_000 });
  // The first sentence is playing, the second is with the voice and the third waits.
  await call(page, 'sendText', 'Second question');
  await expect.poll(async () => (await probe(page)).played.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(4);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 20_000 });
  const p = await probe(page);
  // Before: the third sentence of the first reply was spoken into the second.
  expect(p.synthesized.filter((t: string) => t.startsWith('Reply 1'))).toHaveLength(2);
  expect(p.played).toEqual([`Reply 1 sentence 1 is long enough to be spoken.`, ...REPLY_2]);
  expect(p.errors).toEqual([]);
});
