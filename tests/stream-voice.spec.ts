import { test, expect } from '@playwright/test';

/**
 * A host's voice streamed in chunks, played from the first one.
 *
 * onSynthesize could only return a sentence's audio whole, so nothing was
 * heard until a cloud voice had finished all of it, though every major voice
 * API streams. The page is sandbox/e2e/adapters.html.
 */
const probe = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__e2e);

async function reply(page: import('@playwright/test').Page, query: string) {
  await page.goto(`/e2e/adapters.html?${query}`);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
  await page.evaluate(() => (window as any).__e2e.sendText('Hello there'));
}

test('a streamed voice starts with its first chunk, and is captioned once', async ({ page }) => {
  await reply(page, 'voice=stream');
  // Speaking while the stream is still a second and a half from its end.
  await expect(page.locator('#status')).toHaveText('speaking', { timeout: 10_000 });
  expect((await probe(page)).streamsEnded).toBe(0);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 15_000 });
  const p = await probe(page);
  expect(p.streamsEnded).toBe(1);
  // Before: the stream was refused as an unknown format.
  expect(p.errors).toEqual([]);
  expect(p.played).toEqual(['This is the reply.']);
});

test('PCM bytes cut mid-sample play through pcmStream', async ({ page }) => {
  await reply(page, 'voice=stream-bytes');
  await expect.poll(async () => (await probe(page)).played, { timeout: 10_000 }).toEqual(['This is the reply.']);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 15_000 });
  expect((await probe(page)).errors).toEqual([]);
});

test('streamed MP3 is reported, pointing at pcmStream', async ({ page }) => {
  await reply(page, 'voice=stream-mp3');
  await expect.poll(async () => (await probe(page)).errors, { timeout: 10_000 })
    .toEqual([{ stage: 'speech-synthesis', severity: 'degraded', detail: 'onSynthesize' }]);
  expect((await probe(page)).errorMessages[0]).toContain('pcmStream');
  await expect(page.locator('#status')).toHaveText('idle');
});

test('interrupting a streamed voice aborts its signal and closes the stream', async ({ page }) => {
  await reply(page, 'voice=stream');
  await expect(page.locator('#status')).toHaveText('speaking', { timeout: 10_000 });
  await page.evaluate(() => (window as any).__e2e.interrupt());
  await expect.poll(async () => (await probe(page)).streamsClosed, { timeout: 10_000 }).toBe(1);
  const p = await probe(page);
  expect(p.synthAborted).toBe(1);
  // Closed before its last chunk, and nothing reported as a failure.
  expect(p.streamsEnded).toBe(0);
  expect(p.errors).toEqual([]);
  await expect(page.locator('#status')).toHaveText('idle');
});
