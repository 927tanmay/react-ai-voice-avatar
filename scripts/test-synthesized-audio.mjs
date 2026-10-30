/**
 * Checks how an onSynthesize result becomes playable audio.
 *
 * The rate matters as much as the samples: a 16 kHz reply played as 24 kHz is
 * one and a half times too fast and a fifth too high. Most voice APIs return
 * 16 or 22.05 kHz, often as 16-bit integers, which could not be played at all.
 *
 * Run with: node --experimental-strip-types scripts/test-synthesized-audio.mjs
 */
import { toPlayableAudio, int16ToFloat32, DEFAULT_SYNTHESIS_SAMPLE_RATE, pcmStream, isAudioStream, chunkToPlayable, speechReply, isSpeechReply, speechChunkAudio, speechChunkText } from '../src/lib/synthesizedAudio.ts';

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

// ─── Streamed voice ───

/** Bytes cut into pieces of these sizes, as a network might deliver them. */
async function* cut(bytes, sizes) {
  let at = 0;
  for (let i = 0; at < bytes.length; i++) {
    const n = sizes[i % sizes.length];
    yield bytes.slice(at, at + n);
    at += n;
  }
}
const collect = async stream => {
  const parts = [];
  for await (const chunk of stream) parts.push(chunk);
  return parts;
};
const joined = (parts, Type) => {
  const out = new Type(parts.reduce((n, p) => n + p.audio.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p.audio, at); at += p.audio.length; }
  return out;
};

check('pcmStream: 16-bit samples split mid-sample come out whole and in order', async () => {
  const samples = Int16Array.from({ length: 999 }, (_, i) => (i * 97) % 65536 - 32768);
  const bytes = new Uint8Array(samples.buffer);
  const parts = await collect(pcmStream(cut(bytes, [1, 3, 7, 2, 5]), { sampleRate: 22050 }));
  const out = joined(parts, Int16Array);
  if (out.length !== samples.length) return `${out.length} samples, not ${samples.length}`;
  for (let i = 0; i < samples.length; i++) if (out[i] !== samples[i]) return `sample ${i} is ${out[i]}, not ${samples[i]}`;
  if (parts.some(p => p.sampleRate !== 22050)) return 'a chunk lost its rate';
  return null;
});

check('pcmStream: 32-bit floats split mid-sample, from a ReadableStream', async () => {
  const samples = Float32Array.from({ length: 501 }, (_, i) => Math.sin(i / 7));
  const bytes = new Uint8Array(samples.buffer);
  const pieces = [];
  for await (const piece of cut(bytes, [3, 5, 6])) pieces.push(piece);
  const body = new ReadableStream({ start(c) { pieces.forEach(p => c.enqueue(p)); c.close(); } });
  const out = joined(await collect(pcmStream(body, { sampleRate: 24000, encoding: 'f32le' })), Float32Array);
  if (out.length !== samples.length) return `${out.length} samples, not ${samples.length}`;
  for (let i = 0; i < samples.length; i++) if (out[i] !== samples[i]) return `sample ${i} differs`;
  return null;
});

check('pcmStream: stopping early lets the source go', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(c) { c.enqueue(new Uint8Array(64)); },
    cancel() { cancelled = true; },
  });
  for await (const _ of pcmStream(body, { sampleRate: 24000 })) break;
  return cancelled ? null : 'the source was never cancelled';
});

check('pcmStream: a missing sampleRate is refused', async () => {
  try {
    await collect(pcmStream(cut(new Uint8Array(4), [4]), {}));
    return 'accepted';
  } catch (e) {
    return /sampleRate/.test(e.message) ? null : `unhelpful error: ${e.message}`;
  }
});

check('a stream is told apart from one result', async () => {
  if (!isAudioStream(pcmStream(cut(new Uint8Array(2), [2]), { sampleRate: 1 }))) return 'a generator was not a stream';
  if (isAudioStream(new Float32Array(4))) return 'a Float32Array was taken for a stream';
  if (isAudioStream({ audio: new Float32Array(4), sampleRate: 16000 })) return '{ audio, sampleRate } was taken for a stream';
  if (isAudioStream(new ArrayBuffer(4))) return 'an ArrayBuffer was taken for a stream';
  return null;
});

check('a streamed encoded chunk is refused, pointing at pcmStream', async () => {
  try {
    await chunkToPlayable(new Uint8Array([0xff, 0xfb, 0x90]));
    return 'accepted';
  } catch (e) {
    return /pcmStream/.test(e.message) ? null : `unhelpful error: ${e.message}`;
  }
});

// ─── Replies that are already speech ───

check('speechReply is told apart from a text stream', async () => {
  const chunks = (async function* () {})();
  if (!isSpeechReply(speechReply(chunks))) return 'a speech reply was not recognised';
  if (isSpeechReply(chunks)) return 'a bare async iterable, which means text, was taken for speech';
  if (isSpeechReply('hello')) return 'a string was taken for speech';
  return null;
});

check('a speech chunk gives its audio and its caption apart', async () => {
  const pcm = new Float32Array(4);
  const both = { audio: pcm, sampleRate: 16000, text: '  Hello.  ' };
  const audio = speechChunkAudio(both);
  if (!audio || audio.audio !== pcm || audio.sampleRate !== 16000) return 'audio lost from a captioned chunk';
  if ('text' in audio) return 'the caption was passed on as audio';
  if (speechChunkText(both) !== 'Hello.') return `caption "${speechChunkText(both)}"`;
  if (speechChunkAudio({ text: 'Only words' }) !== null) return 'a caption alone was given audio';
  if (speechChunkText({ text: 'Only words' }) !== 'Only words') return 'a caption alone lost its text';
  if (speechChunkAudio(pcm) !== pcm || speechChunkText(pcm) !== '') return 'bare samples mishandled';
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
  console.error(`\n${failures} synthesized-audio check(s) failed.`);
  process.exit(1);
}
console.log(`All ${checks.length} synthesized-audio checks passed.`);
