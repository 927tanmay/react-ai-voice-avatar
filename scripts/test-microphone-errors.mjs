/**
 * Checks how a failure to start listening is classified: the microphone
 * itself, or the voice detector that listens to it.
 *
 * Run with: node --experimental-strip-types scripts/test-microphone-errors.mjs
 */
import { classifyMicrophoneError, classifyDetectorError, isMicrophoneError } from '../src/lib/microphoneErrors.ts';

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const dom = (name, message = 'x') => Object.assign(new Error(message), { name });

check('each getUserMedia failure gets its own detail', () => {
  const cases = {
    NotAllowedError: 'permission-denied', SecurityError: 'permission-denied',
    NotFoundError: 'no-microphone', OverconstrainedError: 'no-microphone',
    NotReadableError: 'microphone-busy', TypeError: 'microphone-unavailable',
  };
  for (const [name, detail] of Object.entries(cases)) {
    const got = classifyMicrophoneError(dom(name)).detail;
    if (got !== detail) return `${name} became ${got}, not ${detail}`;
  }
  return null;
});

check('only the browser\'s microphone errors count as the microphone', () => {
  if (!isMicrophoneError(dom('NotReadableError'))) return 'NotReadableError was not';
  if (isMicrophoneError(dom('AbortError', "Unable to load a worklet's module."))) return 'a worklet failure was';
  if (isMicrophoneError(new Error('no available backend found'))) return 'an onnxruntime failure was';
  return null;
});

check('the detector failing is never told as a permission problem', () => {
  for (const [message, phase, detail] of [
    ["Unable to load a worklet's module.", 'start', 'vad-worklet'],
    ['no available backend found. ERR: [wasm] RuntimeError: Aborted(both async and sync fetching of the wasm failed)', 'load', 'vad-wasm'],
    ["Can't create a session. failed to load model", 'load', 'vad-model'],
    ['Failed to fetch', 'load', 'vad-model'],
    ['something else', 'start', 'vad-start'],
  ]) {
    const got = classifyDetectorError(new Error(message), phase);
    if (got.detail !== detail) return `"${message}" became ${got.detail}, not ${detail}`;
    if (/permission/i.test(got.message)) return `"${message}" mentions permission`;
    if (!got.message.includes(message)) return `"${message}" lost the original message`;
  }
  return null;
});

let failures = 0;
for (const { name, fn } of checks) {
  const problem = fn();
  if (problem) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${problem}`);
    failures++;
  }
}
if (failures > 0) {
  console.error(`\n${failures} microphone-error check(s) failed.`);
  process.exit(1);
}
console.log(`All ${checks.length} microphone-error checks passed.`);
