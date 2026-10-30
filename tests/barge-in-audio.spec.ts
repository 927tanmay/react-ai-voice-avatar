import path from 'node:path';
import { test, expect, devices } from '@playwright/test';

/**
 * Talking over the reply must silence it until the user has finished.
 *
 * Reported by someone integrating the package: the reply is ducked, its audio
 * context suspended, the moment a sound starts, but whatever scheduled the
 * next sentence resumed the context, so the avatar talked over the user as
 * soon as another sentence arrived. With an encoded voice, decoding it did the
 * same even after the turn was taken.
 *
 * Chrome's fake microphone loops tests/fixtures/ptt-question.wav: the question
 * from 0.4 s to 1.9 s, then 4.3 s of quiet. The first loop asks; the second
 * talks over the eight-second answer. The page is sandbox/e2e/adapters.html.
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

type Entry = { kind: string; ctx?: number; value?: string };
const probe = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__e2e);

/**
 * Resumes of the ducked context while the user had the floor: from the duck
 * to onInferenceStart, which marks their turn ending. Status is logged from a
 * React effect, a render late, so it cannot mark the end.
 */
function resumedOverUser(log: Entry[]) {
  const spoke = log.findIndex(e => e.kind === 'status' && e.value === 'speaking');
  const duck = log.findIndex((e, i) => i > spoke && e.kind === 'suspend');
  const ended = log.findIndex((e, i) => i > duck && e.kind === 'status' && e.value === 'turn-ended');
  return { duck, ended, resumes: log.slice(duck, ended).filter(e => e.kind === 'resume' && e.ctx === log[duck].ctx) };
}

for (const mode of ['duck', 'decoded']) {
  test(`a sentence arriving while the user talks over the reply stays silent (${mode})`, async ({ page }) => {
    await page.goto(`/e2e/adapters.html?reply=barge&barge=${mode}`);
    await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
    await page.evaluate(() => (window as any).__e2e.startListening());

    // The second loop talks over the answer, and the turn is theirs.
    await expect.poll(async () => (await probe(page)).userInterrupts, { timeout: 20_000 }).toBe(1);
    await expect.poll(async () => resumedOverUser((await probe(page)).audioLog).ended, { timeout: 15_000 }).toBeGreaterThan(0);

    const p = await probe(page);
    const { duck, resumes } = resumedOverUser(p.audioLog);
    expect(duck).toBeGreaterThan(0);
    // Before: resumed while they were still talking, as the second sentence came in.
    expect(resumes).toEqual([]);
    expect(p.played).not.toContain('The second sentence arrives while they are talking.');
  });
}
