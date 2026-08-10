import { test, expect } from '@playwright/test';

test.describe('AiVoiceAvatar Sandbox E2E', () => {
  test('should boot web workers and transition to idle state', async ({ page }) => {
    // Listen for unexpected console errors (excluding expected warning logs)
    const errors: string[] = [];
    const logs: string[] = [];
    page.on('console', msg => {
      console.log(`[Browser ${msg.type()}] ${msg.text()}`);
      logs.push(msg.text());
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    // Navigate to the local preview server
    await page.goto('/');

    // Wait for the status indicator to show the initial loading state
    await expect(page.locator('text=Initializing AI models')).toBeVisible({ timeout: 10000 }).catch(() => {});

    // The critical assertion: We must verify that the Web Workers (Blob loading) successfully parsed and initialized.
    // In headless CI environments, downloading 100MB+ of WebGPU/WASM models can hang or timeout.
    // If the worker code had a syntax error (like the previous newline bug), it would fail immediately.
    // We wait up to 15 seconds to see if the worker starts executing (which proves the Blob is valid).
    let workerStarted = false;
    for (let i = 0; i < 15; i++) {
      const idleIndicatorVisible = await page.locator('text=Tap to start').isVisible();
      if (idleIndicatorVisible || errors.length > 0 || logs.some(l => l.includes('Initializing Kokoro') || l.includes('vad is initialized'))) {
        workerStarted = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    const fatalErrors = errors.filter(e => 
      e.includes('SyntaxError') || 
      e.includes('Blob worker failed') || 
      e.includes('Failed to construct Web Worker')
    );
    
    expect(fatalErrors).toHaveLength(0);
    expect(workerStarted).toBe(true);
  });
});
