import { test, expect } from '@playwright/test';

/**
 * A reply from onSubmit that is already audio, from a speech-to-speech model
 * say, returned as speechReply(chunks). It plays as it arrives, captioned by
 * any transcript that comes with it, and the voice is never asked for.
 *
 * The page is sandbox/e2e/adapters.html.
 */
const probe = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__e2e);

async function ask(page: import('@playwright/test').Page, reply: string) {
  await page.goto(`/e2e/adapters.html?reply=${reply}`);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
  await page.evaluate(() => (window as any).__e2e.sendText('Hello there'));
}

test('a speech reply plays as it arrives, captioned, without onSynthesize', async ({ page }) => {
  await ask(page, 'speech');
  // Speaking while the reply is still a second and a half from its end.
  await expect(page.locator('#status')).toHaveText('speaking', { timeout: 10_000 });
  expect((await probe(page)).speechEnded).toBe(0);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 15_000 });
  const p = await probe(page);
  expect(p.speechEnded).toBe(1);
  // Before: the wrapper itself was sent to the voice, as "[object Object]".
  expect(p.synthesized).toEqual([]);
  expect(p.played).toEqual(['Hello from a speech model.', 'And a second sentence.']);
  expect(p.avatarTranscripts).toEqual(['Hello from a speech model.', 'And a second sentence.']);
  expect(p.inferenceEnded).toBe(1);
  expect(p.errors).toEqual([]);
});

test('a speech reply with no transcript plays, uncaptioned', async ({ page }) => {
  await ask(page, 'speech-silent');
  await expect(page.locator('#status')).toHaveText('speaking', { timeout: 10_000 });
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 15_000 });
  const p = await probe(page);
  expect(p.synthesized).toEqual([]);
  expect(p.played).toEqual([]);
  expect(p.avatarTranscripts).toEqual([]);
  expect(p.errors).toEqual([]);
});

test('a speech reply with nothing in it ends the turn quietly', async ({ page }) => {
  await ask(page, 'speech-empty');
  await expect.poll(async () => (await probe(page)).inferenceEnded, { timeout: 10_000 }).toBe(1);
  await expect(page.locator('#status')).toHaveText('idle');
  const p = await probe(page);
  expect(p.synthesized).toEqual([]);
  expect(p.statuses).not.toContain('speaking');
});

test('interrupting a speech reply aborts its signal and closes it', async ({ page }) => {
  await ask(page, 'speech');
  // Status turns to speaking when audio is scheduled; the caption a moment
  // later, when it starts.
  await expect.poll(async () => (await probe(page)).played, { timeout: 10_000 }).toEqual(['Hello from a speech model.']);
  await page.evaluate(() => (window as any).__e2e.interrupt());
  await expect.poll(async () => (await probe(page)).speechClosed, { timeout: 10_000 }).toBe(1);
  const p = await probe(page);
  expect(p.aborted).toBe(1);
  expect(p.speechEnded).toBe(0);
  expect(p.played).toEqual(['Hello from a speech model.']);
  expect(p.errors).toEqual([]);
  await expect(page.locator('#status')).toHaveText('idle');
});

test('a speech reply that arrives after an interrupt is closed unplayed', async ({ page }) => {
  await ask(page, 'speech-late');
  await expect.poll(async () => (await probe(page)).submitted.length).toBe(1);
  await page.evaluate(() => (window as any).__e2e.interrupt());
  // Before: 0. The stream was left open, as nothing knew it was in the wrapper.
  await expect.poll(async () => (await probe(page)).speechClosed, { timeout: 5_000 }).toBe(1);
  const p = await probe(page);
  expect(p.played).toEqual([]);
  expect(p.errors).toEqual([]);
});
