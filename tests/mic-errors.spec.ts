import { test, expect } from '@playwright/test';

/**
 * The microphone failing, told apart from the voice detector failing.
 *
 * Reported by someone integrating the package: every failure was "Microphone
 * access denied", so a detector whose model or worklet would not load sent
 * users to check permissions they had already given. The microphone stayed
 * open after a detector failure, with the browser's recording light on, and a
 * detector that failed to start was not reported at all: the status said
 * listening and nothing was heard.
 *
 * The page is sandbox/e2e/adapters.html. Every getUserMedia stream is kept on
 * window.__streams, to check its tracks were stopped.
 */
const probe = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__e2e);
const start = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__e2e.startListening());

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.__streams = [];
    w.__failMic = null;
    // Playwright's routing does not see an audio worklet's module load, so
    // its failure is made here, with Chrome's own error.
    w.__failWorklet = false;
    const addModule = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = function (url: string | URL, options?: WorkletOptions) {
      if (w.__failWorklet) return Promise.reject(new DOMException("Unable to load a worklet's module.", 'AbortError'));
      return addModule.call(this, url, options);
    };
    const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (w.__failMic) throw new DOMException('refused by the test', w.__failMic);
      const stream = await native(constraints);
      w.__streams.push(stream);
      return stream;
    };
  });
});

async function open(page: import('@playwright/test').Page) {
  await page.goto('/e2e/adapters.html');
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
}
const liveTracks = (page: import('@playwright/test').Page) => page.evaluate(() =>
  (window as any).__streams.flatMap((s: MediaStream) => s.getTracks()).filter((t: MediaStreamTrack) => t.readyState === 'live').length);

test('a refused microphone is reported as permission-denied', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (window as any).__failMic = 'NotAllowedError'; });
  expect(await start(page)).toBe(false);
  const p = await probe(page);
  // Before: detail 'microphone', whatever the cause.
  expect(p.errors).toEqual([{ stage: 'microphone', severity: 'fatal', detail: 'permission-denied' }]);
  expect(p.isMicOpen).toBe(false);
});

for (const [what, pattern, detail] of [
  ['model', '**/silero_vad_*.onnx', 'vad-model'],
  ['WebAssembly', '**/*.wasm', 'vad-wasm'],
  ['audio worklet', null, 'vad-worklet'],
] as const) {
  test(`a detector ${what} that will not load is reported as ${detail}, and the microphone is closed`, async ({ page }) => {
    if (pattern) await page.route(pattern, route => route.fulfill({ status: 404, body: 'not here' }));
    await open(page);
    if (!pattern) await page.evaluate(() => { (window as any).__failWorklet = true; });
    // Before: the worklet failure resolved as if listening had started.
    expect(await start(page)).toBe(false);
    await expect.poll(async () => (await probe(page)).errors, { timeout: 15_000 })
      .toEqual([{ stage: 'speech-detection', severity: 'fatal', detail }]);
    // Before: the tracks were left open.
    await expect.poll(() => liveTracks(page), { timeout: 5_000 }).toBe(0);
    const p = await probe(page);
    expect(p.isMicOpen).toBe(false);
    expect(p.errorMessages[0]).toContain('voice detector');
    await expect(page.locator('#status')).not.toHaveText('listening');

    // And once whatever was wrong is fixed, the next attempt starts afresh.
    // Not for WebAssembly: onnxruntime keeps a failed start for the life of
    // the page, so that one takes a reload.
    if (detail === 'vad-wasm') return;
    if (pattern) await page.unroute(pattern);
    await page.evaluate(() => { (window as any).__failWorklet = false; });
    expect(await start(page)).toBe(true);
    await expect.poll(async () => (await probe(page)).isMicOpen).toBe(true);
    await expect(page.locator('#status')).toHaveText('listening');
  });
}

test('a microphone that will not reopen is reported, and startListening says so', async ({ page }) => {
  await open(page);
  expect(await start(page)).toBe(true);
  await expect.poll(async () => (await probe(page)).isMicOpen).toBe(true);
  await page.evaluate(() => (window as any).__e2e.stopListening());
  await expect.poll(async () => (await probe(page)).isMicOpen).toBe(false);

  // Taken by another app in between.
  await page.evaluate(() => { (window as any).__failMic = 'NotReadableError'; });
  expect(await start(page)).toBe(false);
  const p = await probe(page);
  // Before: swallowed, and the status said listening.
  expect(p.errors).toEqual([{ stage: 'microphone', severity: 'fatal', detail: 'microphone-busy' }]);
  expect(p.isMicOpen).toBe(false);
  await expect(page.locator('#status')).not.toHaveText('listening');
});
