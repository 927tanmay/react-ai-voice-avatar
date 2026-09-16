/**
 * Checks what the voice detector can and cannot tell us, and when.
 *
 * This drives the real FrameProcessor out of @ricky0123/vad-web with made-up
 * speech probabilities, because the question it answers is not "does our code
 * work" but "what does the library actually promise". The engine's turn-taking
 * is built on one such promise — that a sound which sustains is a sound that
 * gets transcribed — and a promise read off a source file is worth less than
 * one exercised.
 *
 * It also pins the reason the engine no longer commits a turn on
 * `onSpeechStart`: that event is byte-for-byte identical for a cough and for a
 * sentence, so anything decided there is decided on no information.
 *
 * Run with: node scripts/test-speech-gate.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FrameProcessor } = require('@ricky0123/vad-web/dist/frame-processor.js');
const { Message } = require('@ricky0123/vad-web/dist/messages.js');

/** The detector settings the engine ships, from SPEECH_DETECTION_DEFAULTS. */
const SHIPPED = {
  positiveSpeechThreshold: 0.5,
  negativeSpeechThreshold: 0.35,
  redemptionMs: 1400,
  minSpeechMs: 500,
  preSpeechPadMs: 800,
  submitUserSpeechOnPause: false,
};

/** The legacy Silero model reads 1536 samples at 16kHz per frame. */
const MS_PER_FRAME = 1536 / 16;

/**
 * Feed a run of speech probabilities through the detector and collect what it
 * says. `probs` is one number per 96ms frame, as the model would score them.
 */
async function observe(probs, options = SHIPPED) {
  const events = [];
  const frame = new Float32Array(1536);
  const processor = new FrameProcessor(
    async () => ({ isSpeech: next, notSpeech: 1 - next }),
    () => {},
    options,
    MS_PER_FRAME,
  );
  let next = 0;
  processor.resume();

  for (const p of probs) {
    next = p;
    await processor.process(frame, ev => {
      // Frame-by-frame scoring is noise for our purposes; we want the verdicts.
      if (ev.msg !== Message.FrameProcessed) events.push(ev.msg);
    });
  }
  return events;
}

/** A sound of `frames` frames, followed by enough silence to end the turn. */
const sound = (frames, level = 0.9) => [
  ...Array(frames).fill(level),
  ...Array(25).fill(0.02),
];

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

// minSpeechFrames = floor(500 / 96) = 5, so 3 frames (288ms) is a cough and
// 12 frames (1.15s) is someone talking.
const COUGH = sound(3);
const SENTENCE = sound(12);

check('a cough and a sentence are indistinguishable at speech-start', async () => {
  const cough = await observe(COUGH);
  const sentence = await observe(SENTENCE);
  if (cough[0] !== Message.SpeechStart || sentence[0] !== Message.SpeechStart) {
    return `expected both to open with SpeechStart, got ${cough[0]} and ${sentence[0]}`;
  }
  return null;
});

check('a cough is withdrawn, never handed over as speech', async () => {
  const events = await observe(COUGH);
  if (events.includes(Message.SpeechEnd)) return 'a cough was handed over as speech';
  if (!events.includes(Message.VADMisfire)) return `expected a misfire, got ${events.join(', ')}`;
  return null;
});

check('a cough never reaches real-start, so no turn is taken', async () => {
  const events = await observe(COUGH);
  if (events.includes(Message.SpeechRealStart)) return 'a cough reached real-start';
  return null;
});

check('a sentence reaches real-start and is handed over', async () => {
  const events = await observe(SENTENCE);
  if (!events.includes(Message.SpeechRealStart)) return 'a sentence never reached real-start';
  if (!events.includes(Message.SpeechEnd)) return 'a sentence was not handed over';
  return null;
});

check('real-start always precedes the audio it promises', async () => {
  const events = await observe(SENTENCE);
  if (events.indexOf(Message.SpeechRealStart) > events.indexOf(Message.SpeechEnd)) {
    return 'real-start arrived after the audio';
  }
  return null;
});

/*
 * The invariant the engine's turn-taking is built on. Committing a turn at
 * real-start is only safe if every real-start is followed by audio to
 * transcribe — otherwise the avatar would stop, take the floor, and then be
 * handed nothing, leaving the user in silence waiting for a reply to a sentence
 * that was thrown away.
 */
check('real-start and a handover imply each other, at every length', async () => {
  for (let frames = 1; frames <= 20; frames++) {
    const events = await observe(sound(frames));
    const committed = events.includes(Message.SpeechRealStart);
    const delivered = events.includes(Message.SpeechEnd);
    if (committed !== delivered) {
      return `at ${frames} frame(s): real-start=${committed} but handover=${delivered}`;
    }
  }
  return null;
});

/*
 * The other side of the trade. Requiring a sound to sustain is what stops a
 * cough taking a turn, and it is also what can drop a one-word answer — "yes",
 * "haan", a read-back digit. This finds the boundary and states it in
 * milliseconds, so the cost of changing minSpeechMs is visible rather than
 * discovered by a user whose "yes" was ignored.
 */
check('the shortest utterance that takes a turn is about half a second', async () => {
  let shortest = null;
  for (let frames = 1; frames <= 20; frames++) {
    const events = await observe(sound(frames));
    if (events.includes(Message.SpeechEnd)) { shortest = frames; break; }
  }
  if (shortest === null) return 'no sound length took a turn at all';
  const ms = Math.round(shortest * MS_PER_FRAME);
  // 5 frames at 96ms. Anything shorter than this is discarded as noise, which
  // is the point, and is also why a clipped single-word answer is the first
  // thing to suspect if minSpeechMs is raised further.
  if (ms < 400 || ms > 560) return `expected the boundary near 480ms, measured ${ms}ms`;
  return null;
});

check('a quiet speaker below the threshold is never heard at all', async () => {
  // 0.45 sits under the shipped 0.5. Worth pinning: this is the cost of the
  // setting, and the reason `speechDetection` is exposed to host applications.
  const events = await observe(sound(12, 0.45));
  if (events.length !== 0) return `expected silence, got ${events.join(', ')}`;
  return null;
});

check('a pause for thought does not end the turn', async () => {
  // Redemption is floor(1400 / 96) = 14 frames, so a 10-frame pause (~1s) in
  // the middle of a sentence has to be survivable or people get cut off.
  const events = await observe([
    ...Array(12).fill(0.9),
    ...Array(10).fill(0.02),
    ...Array(12).fill(0.9),
    ...Array(25).fill(0.02),
  ]);
  const handovers = events.filter(e => e === Message.SpeechEnd).length;
  if (handovers !== 1) return `expected one turn, got ${handovers}`;
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
  console.error(`\n${failures} speech-gate check(s) failed.`);
  process.exit(1);
}
console.log(`All ${checks.length} speech-gate checks passed.`);
