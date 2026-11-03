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

/**
 * A transcript that arrives after a later turn has been answered.
 *
 * Each turn's transcript was submitted when it arrived, so a slow one for
 * something said earlier came in second, cancelled the reply to what was
 * said after it, and was answered in its place.
 */
async function listenUntilTurnTwo(page: Page, mode: string) {
  await page.goto(`/e2e/adapters.html?transcribe=${mode}`);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
  await page.evaluate(() => (window as any).__e2e.startListening());
  await expect.poll(async () => (await probe(page)).submitted, { timeout: 20_000 }).toContain('Turn 2');
  // A transcript under way still arrives after this, so the first one does too.
  await page.evaluate(() => (window as any).__e2e.stopListening());
  // Past the moment the first turn's transcript arrives.
  await page.waitForTimeout(8_500);
}

for (const mode of ['first-slow', 'stream-first-slow']) {
  test(`a slow transcript of an earlier turn is not answered over a later one (${mode})`, async ({ page }) => {
    await listenUntilTurnTwo(page, mode);
    const p = await probe(page);
    // Before: ['Turn 2', 'Turn 1'], the second reply cancelled by the first.
    expect(p.submitted).toEqual(['Turn 2']);
    expect(p.errors).toEqual([]);
    // Its request is stopped too, not left to run.
    expect(mode === 'first-slow' ? p.transcribeAborted : p.finishingAborted).toBe(1);
  });
}

test('a slow transcript of an earlier turn that fails does not end a later one', async ({ page }) => {
  await listenUntilTurnTwo(page, 'first-slow-fail');
  const p = await probe(page);
  // Before: reported as a failure, which ended the turn under way.
  expect(p.errors).toEqual([]);
  expect(p.submitted).toEqual(['Turn 2']);
});

test('a slow transcript of a spoken turn is not answered over a typed one', async ({ page }) => {
  await transcribing(page, 'first-slow');
  await page.evaluate(() => (window as any).__e2e.stopListening());
  await page.evaluate(() => (window as any).__e2e.sendText('A typed question'));
  await page.waitForTimeout(8_500);
  const p = await probe(page);
  // Before: ['A typed question', 'Turn 1'].
  expect(p.submitted).toEqual(['A typed question']);
  expect(p.transcribeAborted).toBe(1);
  expect(p.errors).toEqual([]);
});
