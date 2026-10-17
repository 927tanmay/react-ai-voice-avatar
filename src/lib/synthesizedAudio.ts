/**
 * synthesizedAudio.ts
 *
 * Turn whatever an `onSynthesize` adapter returns into samples Web Audio can
 * play, at the rate they were recorded at.
 *
 * WHY THIS EXISTS
 *
 * The adapter could only return a Float32Array, which was assumed to be
 * 24 kHz, or an encoded file. Most voice APIs, including the Indian ones,
 * return raw PCM at 16 or 22.05 kHz, usually as 16-bit integers. Played at
 * 24 kHz, a 16 kHz reply came out one and a half times too fast and a fifth
 * too high, and Int16 samples could not be played at all.
 */

/** Anything `onSynthesize` may return. */
export type SynthesizedAudio =
  /** Raw samples from -1 to 1, assumed to be 24 kHz. */
  | Float32Array
  /** Raw 16-bit samples, assumed to be 24 kHz. */
  | Int16Array
  /** An encoded file (MP3, WAV, Ogg…), decoded by the browser. */
  | ArrayBuffer
  | Uint8Array
  /** Raw samples, and the rate they were recorded at. */
  | { audio: Float32Array | Int16Array; sampleRate: number };

/** The rate assumed when an adapter returns bare samples without saying. */
export const DEFAULT_SYNTHESIS_SAMPLE_RATE = 24000;

export interface PlayableAudio {
  pcm: Float32Array;
  sampleRate: number;
}

/** 16-bit integer samples as floats from -1 to 1. */
export function int16ToFloat32(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / 32768;
  return out;
}

/**
 * Normalise an adapter's result. `decode` handles encoded files, which need
 * the browser's decoder; it is given a copy, so the caller's buffer survives.
 */
export async function toPlayableAudio(
  result: SynthesizedAudio,
  decode: (encoded: ArrayBuffer) => Promise<PlayableAudio>,
): Promise<PlayableAudio> {
  if (result instanceof Float32Array) return { pcm: result, sampleRate: DEFAULT_SYNTHESIS_SAMPLE_RATE };
  if (result instanceof Int16Array) return { pcm: int16ToFloat32(result), sampleRate: DEFAULT_SYNTHESIS_SAMPLE_RATE };
  if (result instanceof ArrayBuffer) return decode(result.slice(0));
  if (result instanceof Uint8Array) {
    return decode(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) as ArrayBuffer);
  }
  if (result && typeof result === 'object' && 'audio' in result) {
    const { audio, sampleRate } = result;
    if (!(typeof sampleRate === 'number' && Number.isFinite(sampleRate) && sampleRate > 0)) {
      throw new Error(`onSynthesize returned a sampleRate of ${String(sampleRate)}; it must be a positive number of samples per second`);
    }
    if (audio instanceof Float32Array) return { pcm: audio, sampleRate };
    if (audio instanceof Int16Array) return { pcm: int16ToFloat32(audio), sampleRate };
  }
  throw new Error(
    'onSynthesize must return a Float32Array, an Int16Array, an encoded file as an ArrayBuffer, ' +
    'or { audio, sampleRate }',
  );
}
