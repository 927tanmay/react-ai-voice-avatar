import { test, expect, type Browser } from '@playwright/test';

/**
 * Phones and low-memory devices get the smaller MMS voice from the first
 * visit. They used to get Kokoro, which loaded beside Whisper can get a phone's
 * tab killed, and only the crash guard's two failed starts moved them to MMS.
 * `lowMemoryMode` did nothing at all.
 *
 * The page is sandbox/e2e/voice-engine.html, which loads no model.
 */
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function engine(browser: Browser, query = '', { userAgent, deviceMemory }: { userAgent?: string; deviceMemory?: number } = {}) {
  const context = await browser.newContext(userAgent ? { userAgent } : {});
  if (deviceMemory !== undefined) {
    await context.addInitScript(m => {
      Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => m, configurable: true });
    }, deviceMemory);
  }
  const page = await context.newPage();
  await page.goto(`/e2e/voice-engine.html${query}`);
  const text = await page.locator('#engine').textContent();
  await context.close();
  return text;
}

test('an Android phone gets MMS from the first visit', async ({ browser }) => {
  expect(await engine(browser, '', { userAgent: ANDROID })).toBe('mms');
});

test('a browser reporting 4 GB of memory or less gets MMS', async ({ browser }) => {
  expect(await engine(browser, '', { deviceMemory: 4 })).toBe('mms');
  expect(await engine(browser, '', { deviceMemory: 2 })).toBe('mms');
});

test('a desktop, an 8 GB browser and an Android tablet keep Kokoro', async ({ browser }) => {
  expect(await engine(browser)).toBe('kokoro');
  expect(await engine(browser, '', { deviceMemory: 8 })).toBe('kokoro');
  expect(await engine(browser, '', { userAgent: ANDROID_TABLET, deviceMemory: 8 })).toBe('kokoro');
});

test('lowMemoryMode: true gives MMS anywhere, and false keeps Kokoro on a phone', async ({ browser }) => {
  expect(await engine(browser, '?lowMemory=1')).toBe('mms');
  expect(await engine(browser, '?lowMemory=0', { userAgent: ANDROID, deviceMemory: 2 })).toBe('kokoro');
});

test('an explicit ttsEngine wins over lowMemoryMode and the device', async ({ browser }) => {
  expect(await engine(browser, '?tts=kokoro&lowMemory=1', { userAgent: ANDROID })).toBe('kokoro');
});
