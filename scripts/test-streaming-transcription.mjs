/**
 * Checks openTranscription, which stands between the hook and a host's
 * streaming transcriber.
 *
 * Run with: node --experimental-strip-types scripts/test-streaming-transcription.mjs
 */
import { streamingTranscriber, isStreamingTranscriber, openTranscription } from '../src/lib/streamingTranscription.ts';

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const context = (controller = new AbortController()) => ({
  signal: controller.signal, sampleRate: 16000, partial() {}, endTurn() {},
});
const frame = n => new Float32Array([n]);

check('frames pushed while an async open connects arrive in order once it has', async () => {
  const got = [];
  let connect;
  const t = streamingTranscriber(() => new Promise(r => { connect = r; }));
  const s = openTranscription(t, context());
  s.push(frame(1));
  s.push(frame(2));
  connect({ push: f => got.push(f[0]), finish: async () => 'done' });
  await Promise.resolve();
  s.push(frame(3));
  if (await s.finish() !== 'done') return 'finish did not resolve with the text';
  return got.join() === '1,2,3' ? null : `got ${got.join()}`;
});

check('a synchronous open gets frames at once', async () => {
  const got = [];
  const s = openTranscription(streamingTranscriber(() => ({ push: f => got.push(f[0]), finish: async () => '' })), context());
  s.push(frame(7));
  return got.join() === '7' ? null : `got ${got.join()}`;
});

check('open throwing surfaces from finish, not from push', async () => {
  const s = openTranscription(streamingTranscriber(() => { throw new Error('no socket'); }), context());
  s.push(frame(1));
  try {
    await s.finish();
    return 'finish resolved';
  } catch (e) {
    return e.message === 'no socket' ? null : `wrong error: ${e.message}`;
  }
});

check('open rejecting surfaces from finish', async () => {
  const s = openTranscription(streamingTranscriber(async () => { throw new Error('refused'); }), context());
  s.push(frame(1));
  try {
    await s.finish();
    return 'finish resolved';
  } catch (e) {
    return e.message === 'refused' ? null : `wrong error: ${e.message}`;
  }
});

check('push throwing surfaces from finish, and stops later pushes', async () => {
  let calls = 0;
  const s = openTranscription(streamingTranscriber(() => ({
    push: () => { calls++; throw new Error('closed'); },
    finish: async () => 'never',
  })), context());
  s.push(frame(1));
  s.push(frame(2));
  if (calls !== 1) return `${calls} pushes reached a failed session`;
  try {
    await s.finish();
    return 'finish resolved';
  } catch (e) {
    return e.message === 'closed' ? null : `wrong error: ${e.message}`;
  }
});

check('nothing is pushed once the session is abandoned', async () => {
  const got = [];
  const controller = new AbortController();
  const s = openTranscription(streamingTranscriber(() => ({ push: f => got.push(f[0]), finish: async () => '' })), context(controller));
  s.push(frame(1));
  controller.abort();
  s.push(frame(2));
  return got.join() === '1' ? null : `got ${got.join()}`;
});

check('a streaming transcriber is told apart from a plain function', async () => {
  if (!isStreamingTranscriber(streamingTranscriber(() => ({ push() {}, finish: async () => '' })))) return 'not recognised';
  if (isStreamingTranscriber(async () => 'text')) return 'a plain function was taken for one';
  if (isStreamingTranscriber(undefined)) return 'undefined was taken for one';
  return null;
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
  console.error(`\n${failures} streaming-transcription check(s) failed.`);
  process.exit(1);
}
console.log(`All ${checks.length} streaming-transcription checks passed.`);
