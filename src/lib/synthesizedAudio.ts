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

/**
 * One piece of a streamed voice. Raw samples only: an encoded file cannot be
 * decoded a piece at a time.
 */
export type AudioChunk =
  | Float32Array
  | Int16Array
  | { audio: Float32Array | Int16Array; sampleRate: number };

/** What `onSynthesize` may resolve to: one result, or chunks as they arrive. */
export type SynthesisResult = SynthesizedAudio | AsyncIterable<AudioChunk>;

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

/** Whether `onSynthesize` returned chunks rather than one result. */
export function isAudioStream(result: unknown): result is AsyncIterable<AudioChunk> {
  return !!result && typeof (result as any)[Symbol.asyncIterator] === 'function';
}

/** One streamed chunk as playable samples. Encoded chunks are refused. */
export async function chunkToPlayable(chunk: AudioChunk): Promise<PlayableAudio> {
  return toPlayableAudio(chunk as SynthesizedAudio, async () => {
    throw new Error(
      'onSynthesize streamed encoded audio, which cannot be played a piece at a time. ' +
      'Ask your provider for raw PCM, and wrap a byte stream in pcmStream().',
    );
  });
}

export interface PcmStreamOptions {
  /** Samples per second, as your provider sends them. */
  sampleRate: number;
  /** 16-bit integers or 32-bit floats, little-endian. Defaults to 's16le'. */
  encoding?: 's16le' | 'f32le';
}

/**
 * Raw PCM bytes, from `fetch(...).body` say, as chunks `onSynthesize` can
 * stream. Network chunks split samples anywhere, so the bytes of a sample cut
 * in two are carried into the next chunk rather than lost or misread.
 */
export async function* pcmStream(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  { sampleRate, encoding = 's16le' }: PcmStreamOptions,
): AsyncGenerator<{ audio: Float32Array | Int16Array; sampleRate: number }> {
  if (!(typeof sampleRate === 'number' && Number.isFinite(sampleRate) && sampleRate > 0)) {
    throw new Error(`pcmStream needs a sampleRate, got ${String(sampleRate)}`);
  }
  const width = encoding === 'f32le' ? 4 : 2;
  const reader = 'getReader' in source ? source.getReader() : null;
  const iterator = reader ? null : (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  let carry = new Uint8Array(0);
  try {
    while (true) {
      const step = reader ? await reader.read() : await iterator!.next();
      if (step.done) break;
      const value = step.value as Uint8Array;
      let bytes = value;
      if (carry.length > 0) {
        bytes = new Uint8Array(carry.length + value.length);
        bytes.set(carry);
        bytes.set(value, carry.length);
      }
      const whole = bytes.length - (bytes.length % width);
      carry = bytes.slice(whole);
      if (whole === 0) continue;
      const view = new DataView(bytes.buffer, bytes.byteOffset, whole);
      const count = whole / width;
      if (encoding === 'f32le') {
        const audio = new Float32Array(count);
        for (let i = 0; i < count; i++) audio[i] = view.getFloat32(i * 4, true);
        yield { audio, sampleRate };
      } else {
        const audio = new Int16Array(count);
        for (let i = 0; i < count; i++) audio[i] = view.getInt16(i * 2, true);
        yield { audio, sampleRate };
      }
    }
  } finally {
    // Stopped early, by an interruption: let the source go too.
    try { reader?.cancel()?.catch?.(() => {}); } catch (e) { /* already closed */ }
    try { iterator?.return?.()?.catch?.(() => {}); } catch (e) { /* already finished */ }
  }
}

/**
 * One piece of a reply that is already speech. `text`, when the provider
 * sends a transcript, captions the audio it comes with, or the next audio if
 * it comes alone.
 */
export type SpeechChunk =
  | AudioChunk
  | { audio: Float32Array | Int16Array; sampleRate: number; text?: string }
  | { text: string };

/** A reply from `onSubmit` that is audio, not text. Made by `speechReply()`. */
export interface SpeechReply {
  readonly kind: 'speech-reply';
  readonly chunks: AsyncIterable<SpeechChunk> | ReadableStream<SpeechChunk>;
}

/**
 * Return this from `onSubmit` when your model answers in speech, such as a
 * speech-to-speech model relayed by your backend. Its audio plays as it
 * arrives and `onSynthesize` is not called for the reply. A wrapper, because
 * an async iterable on its own already means a stream of text.
 */
export function speechReply(chunks: AsyncIterable<SpeechChunk> | ReadableStream<SpeechChunk>): SpeechReply {
  return { kind: 'speech-reply', chunks };
}

export function isSpeechReply(value: unknown): value is SpeechReply {
  return !!value && typeof value === 'object' && (value as SpeechReply).kind === 'speech-reply';
}

/** A chunk's audio, if it has any, in a form `chunkToPlayable` takes. */
export function speechChunkAudio(chunk: SpeechChunk): AudioChunk | null {
  if (chunk instanceof Float32Array || chunk instanceof Int16Array) return chunk;
  if (chunk && typeof chunk === 'object' && 'audio' in chunk) {
    return { audio: chunk.audio, sampleRate: chunk.sampleRate };
  }
  return null;
}

/** A chunk's caption, if it has one. */
export function speechChunkText(chunk: SpeechChunk): string {
  const text = chunk && typeof chunk === 'object' && 'text' in chunk ? chunk.text : undefined;
  return typeof text === 'string' ? text.trim() : '';
}
