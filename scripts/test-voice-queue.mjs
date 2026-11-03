/**
 * Checks that a voice worker's queue lets `interrupt` in between sentences.
 *
 * On WASM, generating a sentence settles through promises alone, so a loop
 * that went straight on to the next one never read the worker's messages:
 * talking over a reply cleared its queue only after the whole of it had been
 * generated. Here generation is simulated the same way, and the interrupt
 * arrives as a real message, on a MessageChannel.
 *
 * Run with: node --experimental-strip-types scripts/test-voice-queue.mjs
 */
import { drainQueue } from '../src/lib/voiceQueue.ts';

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

/** Work that settles through promises alone, as WASM generation does. */
async function generate() {
  for (let i = 0; i < 1000; i++) await Promise.resolve();
}

/** A message sent now, read whenever the receiver next takes a task. */
function message(onMessage) {
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => {
    onMessage();
    port1.close();
  };
  port2.postMessage('interrupt');
}

check('an interrupt sent during a sentence stops the ones after it', async () => {
  const queue = ['one', 'two', 'three', 'four'];
  const spoken = [];
  await drainQueue(queue, async item => {
    if (item === 'one') message(() => { queue.length = 0; });
    await generate();
    spoken.push(item);
  });
  // Before: all four, the interrupt read only once the queue was empty.
  const want = ['one'];
  return JSON.stringify(spoken) === JSON.stringify(want) ? null : `spoke ${JSON.stringify(spoken)}, want ${JSON.stringify(want)}`;
});

check('every item is taken, in order, when nothing interrupts', async () => {
  const queue = ['one', 'two', 'three'];
  const spoken = [];
  const done = await drainQueue(queue, async item => { await generate(); spoken.push(item); });
  return done && spoken.join() === 'one,two,three' && queue.length === 0 ? null : `spoke ${spoken}, done ${done}`;
});

check('items added while one is being spoken are taken too', async () => {
  const queue = ['one'];
  const spoken = [];
  await drainQueue(queue, async item => {
    if (item === 'one') queue.push('two');
    await generate();
    spoken.push(item);
  });
  return spoken.join() === 'one,two' ? null : `spoke ${spoken}`;
});

check('a voice not ready yet leaves the queue as it was', async () => {
  const queue = ['one', 'two'];
  const spoken = [];
  const done = await drainQueue(queue, item => { spoken.push(item); }, () => false);
  return !done && spoken.length === 0 && queue.join() === 'one,two' ? null : `spoke ${spoken}, left ${queue}, done ${done}`;
});

let failures = 0;
for (const { name, fn } of checks) {
  const problem = await fn();
  if (problem) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${problem}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} voice queue check(s) failed.`);
  process.exit(1);
}
console.log(`All ${checks.length} voice queue checks passed.`);
