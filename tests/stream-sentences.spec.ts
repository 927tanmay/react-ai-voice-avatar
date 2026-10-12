import { test, expect } from '@playwright/test';

/**
 * How a streamed onSubmit reply is cut into sentences for the voice.
 *
 * Four faults, reported by someone building on the package. The stream was cut
 * at the first full stop it held, decimals included, so "72.5 percent" was
 * spoken as "72." and "5 percent". Bytes were decoded a chunk at a time, so a
 * letter split across two chunks became U+FFFD. A Response was spoken as
 * "[object Response]". And a short sentence such as "Sure." was held until
 * more text came, which before a tool call meant silence.
 *
 * The page is sandbox/e2e/adapters.html. The host's voice records what it is
 * asked to say, and onSpeechStart what actually plays.
 */
const played = (page: any) => page.evaluate(() => (window as any).__e2e.played as string[]);

async function ask(page: any, mode: string) {
  await page.goto(`/e2e/adapters.html?reply=${mode}`);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
  await page.evaluate(() => (window as any).__e2e.sendText('A question'));
}

test('a decimal number is not cut at its decimal point', async ({ page }) => {
  await ask(page, 'decimal');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 15_000 });
  await expect.poll(() => played(page)).toEqual(['In maths your score went up to 72.5 percent this term, a good jump.']);
});

test('a ReadableStream of bytes is read, and keeps letters that are split across chunks', async ({ page }) => {
  await ask(page, 'bytes');
  await expect.poll(async () => (await played(page)).join(' '), { timeout: 15_000 })
    .toBe('नमस्ते, आज हम गणित के बारे में बात करेंगे।');
});

test('bytes from an async generator keep letters that are split across chunks', async ({ page }) => {
  await ask(page, 'bytes-iterator');
  await expect.poll(async () => (await played(page)).join(' '), { timeout: 15_000 })
    .toBe('नमस्ते, आज हम गणित के बारे में बात करेंगे।');
});

test('a Response is read as a stream, not spoken as an object', async ({ page }) => {
  await ask(page, 'response');
  await expect.poll(() => played(page), { timeout: 15_000 })
    .toEqual(['This is the reply from a Response object, spoken in full.']);
});

test('a short sentence before a pause is spoken during the pause', async ({ page }) => {
  await ask(page, 'short');
  // The answer arrives three seconds after "Sure.". It must not wait for it.
  await expect.poll(() => played(page), { timeout: 2_500 }).toEqual(['Sure.']);
  await expect.poll(() => played(page), { timeout: 15_000 })
    .toEqual(['Sure.', 'The capital of France is Paris, a lovely city.']);
});
