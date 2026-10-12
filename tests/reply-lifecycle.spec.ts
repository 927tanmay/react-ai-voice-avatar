import { test, expect } from '@playwright/test';

/**
 * A reply from onSubmit belongs to one turn.
 *
 * Two ways that went wrong, both reported by someone building on the package.
 * A model that said "Let me check" and then spent more than ten seconds on a
 * tool call was declared stalled: the hook went back to listening, and the
 * real answer arrived into an idle conversation. And a reply the user had
 * interrupted was read to the end anyway, its sentences queued under the next
 * turn's number, so they played into the next answer. The host had no way to
 * cancel the request either.
 *
 * The page is sandbox/e2e/adapters.html, with the host's voice a short tone.
 */
const probe = (page: any) => page.evaluate(() => (window as any).__e2e);

test('a stream that goes quiet for a tool call is not a stall', async ({ page }) => {
  const stalls: string[] = [];
  page.on('console', (m: any) => { if (/No further audio arrived/.test(m.text())) stalls.push(m.text()); });

  await page.goto('/e2e/adapters.html?reply=tool');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
  await page.evaluate(() => (window as any).__e2e.sendText('What is the capital of France?'));

  // The answer comes twelve seconds after the first sentence finished playing.
  await expect.poll(async () => (await probe(page)).played.join(' '), { timeout: 30_000 }).toContain('Paris');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 10_000 });

  const p = await probe(page);
  expect(p.played).toEqual([
    'Let me check that for you, one moment please.',
    'The answer is that Paris is the capital of France.',
  ]);
  // Before: the watchdog fired in the gap and ended the turn.
  expect(stalls).toEqual([]);
  expect(p.inferenceEnded).toBe(1);
});

test('an interrupted reply stops being read, and its signal is aborted', async ({ page }) => {
  await page.goto('/e2e/adapters.html?reply=slow');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });

  await page.evaluate(() => (window as any).__e2e.sendText('First question'));
  await expect.poll(async () => (await probe(page)).played.length, { timeout: 15_000 }).toBeGreaterThan(0);

  await page.evaluate(() => (window as any).__e2e.interrupt());
  // Before: onSubmit was given no signal at all.
  await expect.poll(async () => (await probe(page)).aborted).toBe(1);
  const mark = (await probe(page)).synthesized.length;

  // A new turn, long enough for several more sentences of the first reply to
  // have arrived if it were still being read.
  await page.evaluate(() => (window as any).__e2e.sendText('Second question'));
  await expect.poll(async () => (await probe(page)).played.join(' '), { timeout: 20_000 }).toContain('Reply 2 sentence 3');

  const p = await probe(page);
  const late = p.synthesized.slice(mark).filter((t: string) => t.startsWith('Reply 1'));
  // Before: the rest of reply 1 went on to the voice, and played into reply 2.
  expect(late).toEqual([]);
  expect(p.played.filter((t: string) => t.startsWith('Reply 1')).length).toBeLessThanOrEqual(2);
  expect(p.played.some((t: string) => t.startsWith('Reply 2'))).toBe(true);
});

test('a new question supersedes the reply still being read', async ({ page }) => {
  await page.goto('/e2e/adapters.html?reply=slow');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });

  await page.evaluate(() => (window as any).__e2e.sendText('First question'));
  await expect.poll(async () => (await probe(page)).played.length, { timeout: 15_000 }).toBeGreaterThan(0);

  // No interrupt: just ask again while the first reply is still streaming.
  await page.evaluate(() => (window as any).__e2e.sendText('Second question'));
  await expect.poll(async () => (await probe(page)).aborted).toBe(1);
  const mark = (await probe(page)).synthesized.length;
  await expect.poll(async () => (await probe(page)).played.join(' '), { timeout: 20_000 }).toContain('Reply 2 sentence 3');

  const p = await probe(page);
  expect(p.synthesized.slice(mark).filter((t: string) => t.startsWith('Reply 1'))).toEqual([]);
});
