/**
 * streamingTranscription.ts
 *
 * Speech-to-text that hears the user while they speak.
 *
 * WHY THIS EXISTS
 *
 * `onTranscribe` gets the whole recording once the user has stopped, and the
 * detector only decides they have stopped after `redemptionMs` of silence,
 * 1.4 s by default. Streaming providers transcribe as the words arrive and
 * can say when the turn is over, often well before that. This is the shape a
 * host gives such a provider: audio in as it is captured, words so far out,
 * and the end of the turn when the provider calls it.
 */

/** What the hook gives your transcriber when the user starts to speak. */
export interface TranscriberContext {
  /**
   * Aborted when the session is abandoned: the sound was a cough rather than
   * speech, `interrupt()` or `stopListening()` was called, the component
   * unmounted, or, while its final text is still on its way, something said
   * or typed after it has already been answered. Close your connection when
   * it fires.
   */
  signal: AbortSignal;
  /** Samples per second of every frame pushed: always 16000, mono. */
  sampleRate: number;
  /** The words so far. Reaches `onUserPartial`. */
  partial(text: string): void;
  /**
   * The provider says the user has finished. The turn ends now, without
   * waiting for the silence timer, with this text as what they said, or the
   * text `finish()` resolves with when none is given.
   */
  endTurn(text?: string): void;
}

/** One utterance, from its first frame to its final text. */
export interface TranscriptionSession {
  /** 16 kHz mono frames, as the microphone produces them. */
  push(frame: Float32Array): void;
  /** No more audio is coming. Resolves with the final text. */
  finish(): Promise<string>;
}

/** A streaming transcriber, as made by `streamingTranscriber()`. */
export interface StreamingTranscriber {
  readonly kind: 'streaming-transcriber';
  readonly open: (context: TranscriberContext) => TranscriptionSession | Promise<TranscriptionSession>;
}

/**
 * Make `onTranscribe` stream. `open` is called when the user starts to speak,
 * and returns the session that hears them; it may be async, while a socket
 * connects say, and the audio waits for it.
 */
export function streamingTranscriber(
  open: (context: TranscriberContext) => TranscriptionSession | Promise<TranscriptionSession>,
): StreamingTranscriber {
  return { kind: 'streaming-transcriber', open };
}

export function isStreamingTranscriber(value: unknown): value is StreamingTranscriber {
  return !!value && typeof value === 'object' && (value as StreamingTranscriber).kind === 'streaming-transcriber';
}

/**
 * Open a session for the hook. Frames pushed before an async `open` resolves
 * are held and sent in order once it does. A host that throws, from `open` or
 * `push`, is not a crash here: the failure surfaces when `finish()` is
 * awaited, where the turn reports it.
 */
export function openTranscription(
  transcriber: StreamingTranscriber,
  context: TranscriberContext,
): TranscriptionSession {
  let session: TranscriptionSession | null = null;
  let failure: unknown = null;
  let waiting: Float32Array[] | null = [];

  const send = (frame: Float32Array) => {
    try {
      session!.push(frame);
    } catch (e) {
      failure ??= e;
    }
  };

  let opened: Promise<void>;
  try {
    const result = transcriber.open(context);
    if (result && typeof (result as Promise<TranscriptionSession>).then === 'function') {
      opened = (result as Promise<TranscriptionSession>).then(
        s => {
          session = s;
          const held = waiting ?? [];
          waiting = null;
          held.forEach(send);
        },
        e => {
          failure ??= e;
          waiting = null;
        },
      );
    } else {
      session = result as TranscriptionSession;
      waiting = null;
      opened = Promise.resolve();
    }
  } catch (e) {
    failure = e;
    waiting = null;
    opened = Promise.resolve();
  }

  return {
    push(frame) {
      if (failure || context.signal.aborted) return;
      if (waiting) waiting.push(frame);
      else if (session) send(frame);
    },
    async finish() {
      await opened;
      if (failure) throw failure;
      if (!session) throw new Error('onTranscribe opened no session');
      return session.finish();
    },
  };
}
