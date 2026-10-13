import path from 'node:path';
import { test, expect, devices } from '@playwright/test';

/**
 * Stopping the input without stopping the avatar.
 *
 * Reported by someone building on the package: stopListening() marked the turn
 * interrupted and moved the status to idle, so the rest of a reply in flight
 * was dropped, and there was no way to mute the microphone during a reply
 * without cutting the avatar off.
 *
 * The microphone is Chrome's fake one, looping tests/fixtures/ptt-question.wav:
 * "What is the capital of France?" and four seconds of silence. The page is
 * sandbox/e2e/adapters.html, which records each turn it hears in `heard`.
 */
const FIXTURE = path.resolve(import.meta.dirname, 'fixtures/ptt-question.wav');

test.use({
  launchOptions: {
    args: [
      ...(devices['Desktop Chrome'].launchOptions?.args ?? []),
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${FIXTURE}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});

const probe = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__e2e);

test('stopListening during a reply lets the reply finish', async ({ page }) => {
  // Sentences a second and a half apart, so most of the reply is still to come.
  await page.goto('/e2e/adapters.html?reply=slow');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
  await page.evaluate(() => (window as any).__e2e.sendText('A question'));
  await expect.poll(async () => (await probe(page)).played.length, { timeout: 15_000 }).toBe(1);

  await page.evaluate(() => (window as any).__e2e.stopListening());

  // Before: nothing after the first sentence, and the status on idle.
  await expect.poll(async () => (await probe(page)).played.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
  await expect(page.locator('#status')).toHaveText('speaking');
  await page.evaluate(() => (window as any).__e2e.interrupt());
});

test('after stopListening, a reply that ends does not reopen the microphone', async ({ page }) => {
  await page.goto('/e2e/adapters.html');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
  await page.evaluate(async () => {
    await (window as any).__e2e.startListening();
    (window as any).__e2e.stopListening();
  });
  await expect(page.locator('#status')).toHaveText('idle');

  // A typed turn, and its reply, then long enough for the looping question to
  // be heard twice over if the detector were running again.
  await page.evaluate(() => (window as any).__e2e.sendText('A question'));
  await expect.poll(async () => (await probe(page)).inferenceEnded, { timeout: 15_000 }).toBe(1);
  await page.waitForTimeout(10_000);

  // Before: the detector was restarted when the reply ended, and heard it.
  expect((await probe(page)).heard).toEqual([]);
});

test('a muted microphone hears nothing, and unmuting needs no new start', async ({ page }) => {
  await page.goto('/e2e/adapters.html');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });

  // Muted before the microphone is opened, so it opens muted.
  await page.evaluate(async () => {
    (window as any).__e2e.setMicMuted(true);
    await (window as any).__e2e.startListening();
  });
  await expect(page.locator('#status')).toHaveText('listening', { timeout: 30_000 });
  expect((await probe(page)).isMicMuted).toBe(true);

  await page.waitForTimeout(10_000);
  expect((await probe(page)).heard).toEqual([]);

  await page.evaluate(() => (window as any).__e2e.setMicMuted(false));
  await expect.poll(async () => (await probe(page)).heard.length, { timeout: 20_000 }).toBeGreaterThan(0);
  expect((await probe(page)).isMicMuted).toBe(false);
});
