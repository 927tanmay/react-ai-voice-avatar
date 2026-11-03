/**
 * voiceQueue.ts
 *
 * How a voice worker works through the sentences it has been given.
 *
 * WHY THIS EXISTS
 *
 * A worker reads its messages between tasks, and on WASM a voice model's
 * generation never ends one: it settles through promises alone. The loop
 * that started each sentence as soon as the last was done therefore never
 * let `interrupt` in, so talking over the reply cleared the queue only after
 * every sentence in it had been generated, a few seconds each, and the next
 * reply waited behind them. WebGPU's callbacks are tasks, which is why it
 * only showed without a GPU.
 */

/** Resolves on the worker's next task, once the messages already waiting are read. */
export const nextTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * Take the items in `queue` one at a time, reading waiting messages before
 * each, so a message that empties the queue stops it there. Items added on
 * the way are taken too. Resolves false, leaving the rest queued, if `ready`
 * says the voice cannot take the next one yet.
 */
export async function drainQueue<T>(
  queue: T[],
  handle: (item: T) => unknown,
  ready: () => boolean = () => true,
): Promise<boolean> {
  while (queue.length > 0) {
    await nextTask();
    if (queue.length === 0) break;
    if (!ready()) return false;
    await handle(queue.shift()!);
  }
  return true;
}
