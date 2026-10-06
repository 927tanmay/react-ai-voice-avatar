import { test, expect, type BrowserContext } from '@playwright/test';

/**
 * The in-browser language model answering, and the host's onSynthesize
 * speaking. Both are supported on their own; together they were silent.
 *
 * The worker handed each sentence to Kokoro, which is never started for a host
 * with its own voice, so the reply vanished and the status stayed on
 * 'thinking' for good. The stall watchdog never fired either: it only waits
 * between chunks of a reply, and no chunk ever arrived.
 *
 * The real worker and the real generation path run here, on a model small
 * enough for CI. The test serves a 4 MB randomly initialised Llama under a
 * made-up name: it asks for the 4-bit file the worker always loads, which that
 * repository does not have, so the full-precision one stands in, and it gains
 * the chat template it lacks. Its words are nonsense. What matters is that
 * they reach the host's voice.
 */
const MODEL = 'e2e/tiny-chat';
const SOURCE = 'onnx-internal-testing/tiny-random-LlamaForCausalLM-ONNX';
const CHAT_TEMPLATE =
  "{% for m in messages %}{{ m['role'] }}: {{ m['content'] }}\n{% endfor %}assistant:";

async function serveTinyModel(context: BrowserContext) {
  await context.route(new RegExp(`huggingface\\.co/${MODEL}/resolve/main/(.+)$`), async route => {
    const file = route.request().url().match(/resolve\/main\/(.+)$/)![1];
    const real = file.replace(/^onnx\/model_q4\.onnx$/, 'onnx/model.onnx');
    const response = await fetch(`https://huggingface.co/${SOURCE}/resolve/main/${real}`);
    if (!response.ok) return route.fulfill({ status: response.status });
    if (file === 'tokenizer_config.json') {
      return route.fulfill({ json: { ...(await response.json()), chat_template: CHAT_TEMPLATE } });
    }
    return route.fulfill({
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    });
  });
}

/**
 * Both engines. Kokoro is the default on desktop, where the sentences went to
 * a worker that was never started. MMS is the default on iPhone, where the
 * worker held every sentence back waiting for an MMS voice it never loads.
 */
for (const engine of ['kokoro', 'mms'] as const) {
  test(`in-browser model with onSynthesize (${engine}): the reply is spoken in the host voice`, async ({ page, context }) => {
    const errors: string[] = [];
    const stalls: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    // Idle reached by the stall watchdog is a rescue, not a reply that finished.
    page.on('console', m => { if (/No further audio arrived/.test(m.text())) stalls.push(m.text()); });
    await serveTinyModel(context);

    await page.goto(`/e2e/adapters.html?llm=${MODEL}${engine === 'mms' ? '&tts=mms' : ''}`);
    await expect(page.locator('#status')).toHaveText('idle', { timeout: 60_000 });

    await page.evaluate(() => (window as any).__e2e.sendText('Hello there'));

    // Before the fix: nothing synthesised, and 'thinking' for good.
    await expect.poll(() => page.evaluate(() => (window as any).__e2e.synthesized.length), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });

    const probe = await page.evaluate(() => (window as any).__e2e);
    expect(probe.submitted).toEqual([]); // The local model answered, not onSubmit.
    expect(probe.statuses).toEqual(expect.arrayContaining(['thinking', 'speaking']));
    expect(probe.inferenceEnded).toBe(1); // One turn, closed once.
    expect(probe.ttsEngine).toBe('custom');

    // And a second turn goes the same way.
    const first = probe.synthesized.length;
    await page.evaluate(() => (window as any).__e2e.sendText('And again'));
    await expect.poll(() => page.evaluate(() => (window as any).__e2e.synthesized.length), { timeout: 30_000 }).toBeGreaterThan(first);
    await expect(page.locator('#status')).toHaveText('idle', { timeout: 30_000 });
    expect(stalls).toEqual([]);
    expect(errors).toEqual([]);
  });
}
