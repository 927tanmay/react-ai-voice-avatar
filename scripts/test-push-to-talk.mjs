/**
 * Checks what push-to-talk hands over when the button is released.
 *
 * The button decides when a turn ends, so a pause mid-hold must not split it,
 * and a hold with no speech in it must hand over nothing at all: transcription
 * given room noise invents a sentence, and the avatar would answer it.
 *
 * Run with: node --experimental-strip-types scripts/test-push-to-talk.mjs
 */
import { heldSpeech } from '../src/lib/pushToTalk.ts';

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

const MS = 96;
const options = { msPerFrame: MS, minSpeechMs: 500, preSpeechPadMs: 200 };

/** A hold from a pattern: '.' is a silent frame, 'S' a speech frame. */
function hold(pattern) {
  const frames = [];
  const speech = [];
  for (let i = 0; i < pattern.length; i++) {
    // Each frame is filled with its own index, so what was kept can be read back.
    frames.push(new Float32Array(1536).fill(i));
    speech.push(pattern[i] === 'S');
  }
  return { frames, speech };
}

/** Which frames made it into the audio, in order. */
const framesIn = audio => {
  const ids = [];
  for (let i = 0; i < audio.length; i += 1536) ids.push(audio[i]);
  return ids;
};

check('a hold with speech hands it over, padded either side', () => {
  const got = heldSpeech(hold('.....SSSSSSS.....'), options);
  if (!got) return 'expected speech, got null';
  // 200 ms of padding is 3 frames of 96 ms.
  const expected = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  if (JSON.stringify(framesIn(got.audio)) !== JSON.stringify(expected)) {
    return `kept frames ${JSON.stringify(framesIn(got.audio))}, expected ${JSON.stringify(expected)}`;
  }
  if (got.speechMs !== 7 * MS) return `speechMs ${got.speechMs}, expected ${7 * MS}`;
  return null;
});

check('a long pause mid-hold stays one turn, pause included', () => {
  // Thirty silent frames is nearly three seconds, double the detector's
  // default redemption. In continuous mode that would have been two turns.
  const got = heldSpeech(hold('SSSS' + '.'.repeat(30) + 'SSSS'), options);
  if (!got) return 'expected speech, got null';
  if (got.audio.length !== 38 * 1536) return `kept ${got.audio.length / 1536} frames, expected all 38`;
  if (got.speechMs !== 38 * MS) return `speechMs ${got.speechMs}, expected ${38 * MS}`;
  return null;
});

check('padding stops at the ends of the hold', () => {
  const got = heldSpeech(hold('SSSSSSS'), options);
  if (!got) return 'expected speech, got null';
  return got.audio.length === 7 * 1536 ? null : `kept ${got.audio.length / 1536} frames, expected 7`;
});

check('a silent hold hands over nothing', () =>
  heldSpeech(hold('..........'), options) === null ? null : 'expected null');

check('an empty hold, released at once, hands over nothing', () =>
  heldSpeech(hold(''), options) === null ? null : 'expected null');

check('less speech than minSpeechMs is noise, not a turn', () =>
  // Five frames is 480 ms, under the 500 ms minimum.
  heldSpeech(hold('..SSSSS..'), options) === null ? null : 'expected null');

check('minSpeechMs counts speech frames, not the span between them', () =>
  // Three short bursts spread over a second, 288 ms of speech in all.
  heldSpeech(hold('S....S....S'), options) === null ? null : 'expected null');

check('no frame length yet means nothing to hand over', () =>
  heldSpeech(hold('SSSSSSS'), { ...options, msPerFrame: 0 }) === null ? null : 'expected null');

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
  console.error(`\n${failures} push-to-talk check(s) failed.`);
  process.exit(1);
}
console.log(`All ${checks.length} push-to-talk checks passed.`);
