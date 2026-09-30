import { test, expect } from '@playwright/test';

/**
 * A host supplying onTranscribe, onSubmit and onSynthesize uses no local model,
 * so none may be downloaded. They used to be: every such app made each visitor
 * fetch Whisper and Kokoro, some 590 MB, and wait for both before its first
 * turn.
 *
 * The page is sandbox/e2e/adapters.html. A fresh browser context has nothing
 * stored, so any model the engine loads shows up here as a request.
 */
const MODEL_REQUEST = /huggingface\.co|hf\.co\/|\.onnx(\?|$)|ort-wasm|voices\/.*\.bin/;

test('cloud adapters: ready without downloading a model, and a turn completes', async ({ page }) => {
  const modelRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', r => { if (MODEL_REQUEST.test(r.url())) modelRequests.push(r.url()); });
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto('/e2e/adapters.html');

  // Ready means past 'loading'. With nothing to download this takes seconds;
  // before the fix it waited on the models, and in CI never arrived.
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });

  // A whole turn through the adapters: typed text, the host's reply, the
  // host's voice, and back to idle once it has played.
  await page.evaluate(() => (window as any).__e2e.sendText('Hello there'));
  await expect.poll(() => page.evaluate(() => (window as any).__e2e.synthesized.length), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 15_000 });

  const probe = await page.evaluate(() => (window as any).__e2e);
  expect(probe.submitted).toEqual(['Hello there']);
  expect(probe.synthesized.join(' ')).toContain('This is the reply.');
  expect(probe.statuses).toContain('speaking');
  // And the engine says whose voice that was.
  expect(probe.ttsEngine).toBe('custom');

  // Kokoro never started, so it must not be recorded as having crashed: two
  // such visits used to downgrade the browser to the MMS voice for good.
  expect(await page.evaluate(() => localStorage.getItem('rava:kokoro-init-crashed'))).toBeNull();

  expect(modelRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('cloud adapters: dropping them later loads the local models they stood in for', async ({ page }) => {
  const modelRequests: string[] = [];
  page.on('request', r => { if (MODEL_REQUEST.test(r.url())) modelRequests.push(r.url()); });

  await page.goto('/e2e/adapters.html');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
  expect(modelRequests).toEqual([]);

  // A host whose speech provider has gone away. Only the start of each
  // download is waited for; finishing them is the model cache's business.
  await page.evaluate(() => (window as any).__e2e.dropSpeechAdapters());
  await expect.poll(() => modelRequests.some(u => /whisper/i.test(u)), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => modelRequests.some(u => /kokoro/i.test(u)), { timeout: 30_000 }).toBe(true);
});

test('cloud adapters with preloadLocalSpeech: ready at once, local speech downloading behind', async ({ page }) => {
  const modelRequests: string[] = [];
  page.on('request', r => { if (MODEL_REQUEST.test(r.url())) modelRequests.push(r.url()); });

  await page.goto('/e2e/adapters.html?preload=1');

  // The adapters answer, so nothing waits for the download...
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });

  // ...which is under way all the same.
  await expect.poll(() => modelRequests.some(u => /whisper/i.test(u)), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => modelRequests.some(u => /kokoro/i.test(u)), { timeout: 30_000 }).toBe(true);

  // And a turn still goes through the adapters meanwhile.
  await page.evaluate(() => (window as any).__e2e.sendText('Hello there'));
  await expect.poll(() => page.evaluate(() => (window as any).__e2e.synthesized.length), { timeout: 15_000 }).toBeGreaterThan(0);
});
