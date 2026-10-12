import path from 'node:path';
import { test, expect, devices } from '@playwright/test';

/**
 * A host's own adapters failing, and what the host is told.
 *
 * Reported by someone building on the package: when onTranscribe, onSubmit or
 * onSynthesize threw, the hook logged it and went back to listening, and
 * onError never heard of it. So an app could not say "couldn't reach the
 * server", or "didn't catch that" when nothing was recognised. And with
 * onTranscribe the user's words reached onTranscriptUpdate twice.
 *
 * Spoken turns use push-to-talk on Chrome's fake microphone, which plays
 * tests/fixtures/ptt-question.wav. The page is sandbox/e2e/adapters.html.
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

/** Hold the button long enough to catch the question wherever the loop is, then let go. */
async function speak(page: import('@playwright/test').Page, query: string) {
  await page.goto(`/e2e/adapters.html?listen=ptt${query}`);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
  await page.evaluate(() => (window as any).__e2e.startListening());
  await expect(page.locator('#status')).toHaveText('listening', { timeout: 30_000 });
  await page.waitForTimeout(7_000);
  await page.evaluate(() => (window as any).__e2e.stopListening());
}

test('a spoken turn reaches onTranscriptUpdate once', async ({ page }) => {
  await speak(page, '');
  await expect.poll(async () => (await probe(page)).submitted.length, { timeout: 15_000 }).toBe(1);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 15_000 });
  // Before: ['What is the capital of France?', 'What is the capital of France?']
  expect((await probe(page)).userTranscripts).toEqual(['What is the capital of France?']);
});

test('onTranscribe throwing reaches onError', async ({ page }) => {
  await speak(page, '&transcribe=fail');
  await expect.poll(async () => (await probe(page)).errors, { timeout: 15_000 })
    .toEqual([{ stage: 'speech-recognition', severity: 'degraded', detail: 'onTranscribe' }]);
  await expect(page.locator('#status')).toHaveText('idle');
});

test('nothing recognised reaches onError, so the app can say so', async ({ page }) => {
  await speak(page, '&transcribe=empty');
  await expect.poll(async () => (await probe(page)).errors, { timeout: 15_000 })
    .toEqual([{ stage: 'speech-recognition', severity: 'degraded', detail: 'no-speech' }]);
  expect((await probe(page)).submitted).toEqual([]);
});

test('onSubmit throwing reaches onError', async ({ page }) => {
  await page.goto('/e2e/adapters.html?reply=fail');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
  await page.evaluate(() => (window as any).__e2e.sendText('A question'));
  await expect.poll(async () => (await probe(page)).errors, { timeout: 15_000 })
    .toEqual([{ stage: 'language-model', severity: 'degraded', detail: 'onSubmit' }]);
  await expect(page.locator('#status')).toHaveText('idle');
});

test('onSynthesize throwing reaches onError', async ({ page }) => {
  await page.goto('/e2e/adapters.html?reply=stream-fail');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
  await page.evaluate(() => (window as any).__e2e.sendText('A question'));
  await expect.poll(async () => (await probe(page)).errors, { timeout: 15_000 })
    .toEqual([{ stage: 'speech-synthesis', severity: 'degraded', detail: 'onSynthesize' }]);
});
