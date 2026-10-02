import { test, expect } from '@playwright/test';

/**
 * react-ai-voice-avatar/model-cache, used the way a host's own model worker
 * uses it: imported inside a worker, a file kept and read back. The logic is
 * covered without a browser by scripts/test-model-cache.mjs; this is the part
 * only a browser can show, that the entry loads in a worker and OPFS works there.
 */
test('model cache: keeps a file from inside a worker and gives it back', async ({ page }) => {
  await page.goto('/e2e/model-cache.html');
  await expect(page.locator('#result')).not.toHaveText('running', { timeout: 15_000 });
  const result = JSON.parse(await page.locator('#result').textContent() ?? '{}');
  expect(result).toEqual({ supported: true, missBefore: true, size: 4 * 1024 * 1024, same: true, gone: true });
});
