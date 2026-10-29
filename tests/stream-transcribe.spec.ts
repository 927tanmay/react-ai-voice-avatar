import path from 'node:path';
import { test, expect, devices } from '@playwright/test';

/**
 * A streaming transcriber: it hears the user while they speak, sends the
 * words so far to onUserPartial, and can end the turn before the silence
 * timer does.
 *
 * Chrome's fake microphone plays tests/fixtures/ptt-question.wav on a loop:
 * the question from 0.4 s to 1.9 s, then 4.3 s of quiet. The page is
 * sandbox/e2e/adapters.html, whose stand-in provider is standInTranscriber.
 */
const FIXTURE = path.resolve(import.meta.dirname, 'fixtures/ptt-question.wav');
const QUESTION = 'What is the capital of France?';

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

async function listen(page: import('@playwright/test').Page, query: string) {
  await page.goto(`/e2e/adapters.html?${query}`);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
  await page.evaluate(() => (window as any).__e2e.startListening());
}

test('partials reach onUserPartial while the user speaks, and the final text is the turn', async ({ page }) => {
  await listen(page, 'transcribe=stream');
  await expect.poll(async () => (await probe(page)).submitted[0], { timeout: 20_000 }).toBe(QUESTION);
  // The second time round: the first can only have what was heard since the
  // microphone opened, 0.4 s at most, as the recording starts with it.
  await expect.poll(async () => (await probe(page)).openingSeconds.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => (window as any).__e2e.stopListening());
  const p = await probe(page);
  expect(p.partials).toContain('What is the');
  // The final text only: partials would flood a chat that appends each call.
  expect(p.userTranscripts[0]).toBe(QUESTION);
  expect(p.userTranscripts).not.toContain('What is the');
  // Never the whole-recording path.
  expect(p.heard).toEqual([]);
  expect(p.sessionsFinished).toBeGreaterThanOrEqual(1);
  // The audio from just before the first loud frame went first, so the first
  // word is not clipped: about preSpeechPadMs, 800 ms.
  expect(p.openingSeconds[1]).toBeGreaterThan(0.5);
});

test('the provider ending the turn does not wait for the silence timer', async ({ page }) => {
  // Five seconds of silence to end a turn, and the recording never pauses
  // that long, so only the provider can end this one.
  await listen(page, 'transcribe=stream-endturn&redemption=5000');
  await expect.poll(async () => (await probe(page)).submitted[0], { timeout: 12_000 }).toBe(QUESTION);
  await expect.poll(async () => (await probe(page)).played.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect((await probe(page)).errors).toEqual([]);
});

test('a sound too short to be speech abandons its session', async ({ page }) => {
  // The question lasts 1.5 s, short of three seconds, so it is a misfire.
  await listen(page, 'transcribe=stream&minspeech=3000');
  // Abandoned when it misfired, while it is still the only session: a new one
  // opening at the next loop would close it anyway, which proves nothing.
  await expect.poll(async () => {
    const p = await probe(page);
    return p.sessionsAborted >= 1 ? p.sessionsOpened : 'not yet';
  }, { timeout: 15_000 }).toBe(1);
  const p = await probe(page);
  expect(p.submitted).toEqual([]);
  expect(p.sessionsFinished).toBe(0);
  expect(p.statuses).not.toContain('thinking');
});

test('speaking on after the provider ended the turn interrupts the reply', async ({ page }) => {
  // The provider ends the turn 0.6 s into the question; the rest of it is the
  // user carrying on over a long reply.
  await listen(page, 'transcribe=stream-early&reply=long');
  await expect.poll(async () => (await probe(page)).submitted[0], { timeout: 15_000 }).toBe('What is');
  await expect.poll(async () => (await probe(page)).userInterrupts, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
});

test('push-to-talk streams from the press and finishes on release', async ({ page }) => {
  await listen(page, 'transcribe=stream&listen=ptt');
  await expect(page.locator('#status')).toHaveText('listening', { timeout: 30_000 });
  await page.waitForTimeout(7_000);
  await page.evaluate(() => (window as any).__e2e.stopListening());
  await expect.poll(async () => (await probe(page)).submitted, { timeout: 15_000 }).toEqual([QUESTION]);
  const p = await probe(page);
  expect(p.sessionsOpened).toBe(1);
  expect(p.sessionsFinished).toBe(1);
  expect(p.partials).toContain('What is the');
  expect(p.heard).toEqual([]);
});
