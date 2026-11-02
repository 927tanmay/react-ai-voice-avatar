import path from 'node:path';
import { test, expect, devices } from '@playwright/test';

/**
 * The host's requests stop when their answer is no longer wanted.
 *
 * A plain onTranscribe function had no signal, so a transcript asked for
 * before interrupt() still arrived and started a reply. And unmounting
 * aborted nothing: onSubmit and onSynthesize ran to the end, billed, after
 * the page had moved on.
 *
 * The microphone is Chrome's fake one, looping tests/fixtures/ptt-question.wav.
 * The page is sandbox/e2e/adapters.html.
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

type Page = import('@playwright/test').Page;
const probe = (page: Page) => page.evaluate(() => (window as any).__e2e);

/** Listen until a turn has gone to onTranscribe, which takes a second and a half. */
async function transcribing(page: Page, mode: string) {
  await page.goto(`/e2e/adapters.html?transcribe=${mode}`);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
  await page.evaluate(() => (window as any).__e2e.startListening());
  await expect.poll(async () => (await probe(page)).heard.length, { timeout: 15_000 }).toBe(1);
}

for (const mode of ['slow', 'slow-fetch']) {
  test(`interrupt() aborts onTranscribe, and its transcript starts no reply (${mode})`, async ({ page }) => {
    await transcribing(page, mode);
    await page.evaluate(() => (window as any).__e2e.interrupt());
    // Past the moment the transcript arrives.
    await page.waitForTimeout(2_500);
    const p = await probe(page);
    expect(p.transcribeAborted).toBe(1);
    // Before: the transcript arrived and was answered.
    expect(p.submitted).toEqual([]);
    // fetch rejecting on the abort is not a failure.
    expect(p.errors).toEqual([]);
    await expect(page.locator('#status')).toHaveText('idle');
  });
}

test('unmounting aborts onTranscribe, and its transcript is not answered', async ({ page }) => {
  await transcribing(page, 'slow');
  await page.evaluate(() => (window as any).__e2e.unmount());
  await page.waitForTimeout(2_500);
  const p = await probe(page);
  expect(p.transcribeAborted).toBe(1);
  expect(p.submitted).toEqual([]);
});

test('unmounting aborts the reply and the voice request under way', async ({ page }) => {
  // One sentence, then a long wait; the voice takes a second and a half.
  await page.goto('/e2e/adapters.html?reply=tool&voice=late');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
  await page.evaluate(() => (window as any).__e2e.sendText('A question'));
  await expect.poll(async () => (await probe(page)).synthesized.length, { timeout: 15_000 }).toBe(1);
  await page.evaluate(() => (window as any).__e2e.unmount());
  // Before: both 0, and the reply read on to its end.
  await expect.poll(async () => (await probe(page)).aborted, { timeout: 5_000 }).toBe(1);
  expect((await probe(page)).synthAborted).toBe(1);
  await page.waitForTimeout(2_000);
  expect((await probe(page)).played).toEqual([]);
});
