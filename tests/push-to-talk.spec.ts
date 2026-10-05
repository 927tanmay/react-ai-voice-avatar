import path from 'node:path';
import { test, expect, devices } from '@playwright/test';

/**
 * Push-to-talk, with real speech through Chrome's fake microphone.
 *
 * It never submitted anything: the voice detector's handlers all returned
 * early in that mode and stopListening only paused it, so a held turn was
 * dropped and the status stayed on 'listening' for good.
 *
 * The fixture says "What is the capital of France?" between half a second and
 * four seconds of silence, and Chrome loops it. Four seconds is well past the
 * detector's 1.4 s redemption, so a hold that spans it would be split into two
 * turns if the detector's own segments were passed through.
 *
 * The page is sandbox/e2e/adapters.html, with every stage handed to the host,
 * so only the voice detector itself loads.
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

test('push-to-talk: a held turn is handed over on release, once', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto('/e2e/adapters.html?listen=ptt');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });

  await page.evaluate(() => (window as any).__e2e.startListening());
  await expect(page.locator('#status')).toHaveText('listening', { timeout: 30_000 });

  // Long enough to hold the whole sentence and the four-second pause after
  // it, wherever in the loop the hold began. Nothing may be handed over yet:
  // the button is still down.
  await page.waitForTimeout(9_000);
  expect((await probe(page)).heard).toEqual([]);
  await expect(page.locator('#status')).toHaveText('listening');

  await page.evaluate(() => (window as any).__e2e.stopListening());

  // One turn, through to the reply and back to idle.
  await expect.poll(async () => (await probe(page)).heard.length, { timeout: 15_000 }).toBe(1);
  await expect.poll(async () => (await probe(page)).synthesized.length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 15_000 });

  const p = await probe(page);
  expect(p.submitted).toEqual(['What is the capital of France?']);
  expect(p.statuses).toEqual(expect.arrayContaining(['listening', 'thinking', 'speaking']));
  // The loop repeats every 6.2 s, so a nine-second hold catches the sentence
  // once or twice depending on where in the loop it began, and that differs
  // between machines: once is about 3 s of audio after padding, twice about
  // 8.5 s. Either way it is one turn, and the speech measured sits inside the
  // audio sent. Exact trimming is checked in scripts/test-push-to-talk.mjs.
  expect(p.heard[0]).toBeGreaterThan(1);
  expect(p.heard[0]).toBeLessThan(10);
  expect(p.speechMs[0]).toBeGreaterThan(500);
  expect(p.speechMs[0]).toBeLessThanOrEqual(p.heard[0] * 1000);

  // Released means released: the microphone hears the loop again, and
  // nothing more is handed over.
  await page.waitForTimeout(8_000);
  expect((await probe(page)).heard.length).toBe(1);
  expect(errors).toEqual([]);
});

test('push-to-talk: pressing during a reply stops it and takes the floor', async ({ page }) => {
  await page.goto('/e2e/adapters.html?listen=ptt&reply=long');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });

  // Open the microphone first, and abandon that hold. The first press loads
  // the voice detector from a CDN, which under parallel load can outlast the
  // reply, leaving nothing to interrupt by the time the press lands.
  await page.evaluate(() => (window as any).__e2e.startListening());
  await expect(page.locator('#status')).toHaveText('listening', { timeout: 30_000 });
  await page.evaluate(() => (window as any).__e2e.interrupt());
  await expect(page.locator('#status')).toHaveText('idle');

  // An eight-second reply.
  await page.evaluate(() => (window as any).__e2e.sendText('Hello there'));
  await expect(page.locator('#status')).toHaveText('speaking', { timeout: 15_000 });

  // interrupt() above reports itself too, so count from here.
  const before = (await probe(page)).userInterrupts;
  await page.evaluate(() => (window as any).__e2e.startListening());
  await expect(page.locator('#status')).toHaveText('listening', { timeout: 15_000 });
  expect((await probe(page)).userInterrupts).toBe(before + 1);

  // interrupt() abandons a hold: nothing is handed over.
  await page.evaluate(() => (window as any).__e2e.interrupt());
  await expect(page.locator('#status')).toHaveText('idle');
  await page.waitForTimeout(2_000);
  expect((await probe(page)).heard).toEqual([]);
});
