/**
 * Checks how an onSynthesize result becomes playable audio.
 *
 * The rate matters as much as the samples: a 16 kHz reply played as 24 kHz is
 * one and a half times too fast and a fifth too high. Most voice APIs return
 * 16 or 22.05 kHz, often as 16-bit integers, which could not be played at all.
 *
 * Run with: node --experimental-strip-types scripts/test-synthesized-audio.mjs
 */
import { toPlayableAudio, int16ToFloat32, DEFAULT_SYNTHESIS_SAMPLE_RATE } from '../src/lib/synthesizedAudio.ts';

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

/** A decoder standing in for the browser's: records what it was given. */
const decoded = [];
const fakeDecode = async buffer => {
  decoded.push(buffer);
  return { pcm: new Float32Array(buffer.byteLength), sampleRate: 44100 };
};

check('a bare Float32Array is 24 kHz, as it always was', async () => {
  const pcm = new Float32Array(24000);
  const out = await toPlayableAudio(pcm, fakeDecode);
  if (out.pcm !== pcm) return 'the samples were copied or replaced';
  if (out.sampleRate !== DEFAULT_SYNTHESIS_SAMPLE_RATE || out.sampleRate !== 24000) return `rate ${out.sampleRate}`;
  return null;
});

check('{ audio, sampleRate } keeps its own rate', async () => {
  const out = await toPlayableAudio({ audio: new Float32Array(16000), sampleRate: 16000 }, fakeDecode);
  if (out.sampleRate !== 16000) return `rate ${out.sampleRate}`;
  if (out.pcm.length / out.sampleRate !== 1) return `lasts ${out.pcm.length / out.sampleRate} s, not 1 s`;
  return null;
});

check('Int16 samples become floats from -1 to 1, at their own rate', async () => {
  const audio = new Int16Array([0, 16384, -16384, 32767, -32768]);
  const out = await toPlayableAudio({ audio, sampleRate: 22050 }, fakeDecode);
  if (!(out.pcm instanceof Float32Array)) return 'not a Float32Array';
  if (out.sampleRate !== 22050) return `rate ${out.sampleRate}`;
  const want = [0, 0.5, -0.5, 32767 / 32768, -1];
  if (out.pcm.some((v, i) => Math.abs(v - want[i]) > 1e-6)) return `got ${Array.from(out.pcm)}`;
  return null;
});

check('a bare Int16Array is 24 kHz', async () => {
  const out = await toPlayableAudio(new Int16Array(10), fakeDecode);
  return out.sampleRate === 24000 && out.pcm instanceof Float32Array ? null : `rate ${out.sampleRate}`;
});

check('an encoded file is decoded, from a copy', async () => {
  decoded.length = 0;
  const file = new Uint8Array([1, 2, 3, 4]).buffer;
  const out = await toPlayableAudio(file, fakeDecode);
  if (decoded.length !== 1) return 'not decoded';
  if (decoded[0] === file) return 'the caller’s own buffer was handed to the decoder, which detaches it';
  if (out.sampleRate !== 44100) return `rate ${out.sampleRate}`;
  return null;
});

check('a Uint8Array of a file is decoded, only its own bytes', async () => {
  decoded.length = 0;
  const whole = new Uint8Array([9, 9, 1, 2, 3, 9]);
  await toPlayableAudio(whole.subarray(2, 5), fakeDecode);
  const got = Array.from(new Uint8Array(decoded[0]));
  return JSON.stringify(got) === '[1,2,3]' ? null : `decoded ${JSON.stringify(got)}`;
});

check('a missing or nonsense rate is refused with a reason', async () => {
  for (const sampleRate of [undefined, 0, -16000, NaN, '16000']) {
    try {
      await toPlayableAudio({ audio: new Float32Array(10), sampleRate }, fakeDecode);
      return `accepted sampleRate ${String(sampleRate)}`;
    } catch (e) {
      if (!/sampleRate/.test(e.message)) return `unhelpful message: ${e.message}`;
    }
  }
  return null;
});

check('anything else is refused, naming what is accepted', async () => {
  for (const bad of [null, 'audio', [0.1, 0.2], { samples: new Float32Array(1) }]) {
    try {
      await toPlayableAudio(bad, fakeDecode);
      return `accepted ${JSON.stringify(bad)}`;
    } catch (e) {
      if (!/sampleRate/.test(e.message)) return `unhelpful message: ${e.message}`;
    }
  }
  return null;
});

check('int16ToFloat32 is exact at the ends', () => {
  const out = int16ToFloat32(new Int16Array([-32768, 0]));
  return out[0] === -1 && out[1] === 0 ? null : `got ${Array.from(out)}`;
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
  console.error(`\n${failures} synthesized-audio check(s) failed.`);
  process.exit(1);
}
console.log(`All ${checks.length} synthesized-audio checks passed.`);
