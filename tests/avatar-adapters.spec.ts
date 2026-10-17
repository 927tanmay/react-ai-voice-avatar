import { test, expect } from '@playwright/test';

/**
 * <AiVoiceAvatar> with onTranscribe, onSubmit and onSynthesize. The component
 * took the first and last and never passed them on, so it fetched Whisper and
 * Kokoro, some 590 MB, waited for them, and spoke in the local voice. Found
 * while writing the architecture guide; the hook alone was always fine.
 *
 * The page is sandbox/e2e/avatar-adapters.html.
 */
const MODEL_REQUEST = /huggingface\.co|hf\.co\/|\.onnx(\?|$)|voices\/.*\.bin/;

test('the 3D component uses the host’s hearing and voice, and downloads no model', async ({ page }) => {
  const modelRequests: string[] = [];
  page.on('request', r => { if (MODEL_REQUEST.test(r.url())) modelRequests.push(r.url()); });

  await page.goto('/e2e/avatar-adapters.html');
  // Before: still waiting on Kokoro, so never past 'loading' in a CI run.
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });

  await page.evaluate(() => (window as any).__e2e.sendText('Hello there'));
  await expect.poll(() => page.evaluate(() => (window as any).__e2e.synthesized), { timeout: 15_000 })
    .toEqual(['Paris is the capital of France.']);
  await expect(page.locator('#status')).toHaveText('idle', { timeout: 15_000 });

  expect(modelRequests).toEqual([]);
});
