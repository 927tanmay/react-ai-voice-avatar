/**
 * Shared types with no 3D dependencies.
 *
 * These live outside the component tree so the headless entry point
 * (`react-ai-voice-avatar/headless`) never has to reference a module that
 * imports three.js, @react-three/fiber, or @react-three/drei.
 */

/** Runtime inference capabilities detected on the visitor's device. */
export interface AiVoiceAvatarCapabilities {
  /** True when the ONNX runtime selected the WebGPU backend rather than falling back to WASM. */
  webgpu: boolean;
  /** Reserved for future VRAM reporting; currently always null. */
  estimatedVram: number | null;
}

/**
 * Which part of the pipeline failed.
 *
 * Deliberately coarser than the engine's internal stage names. A host app acts
 * on "speech recognition is unavailable", not on which of three worker spawn
 * strategies gave up, and the internal names change as the engine does.
 */
export type AiVoiceAvatarErrorStage =
  /** Opening or reading the microphone. */
  | 'microphone'
  /** Turning speech into text. */
  | 'speech-recognition'
  /** Generating a reply. */
  | 'language-model'
  /** Turning text into audio. */
  | 'speech-synthesis'
  /** Playing audio out. */
  | 'audio-output'
  /** Starting or running a background worker. */
  | 'worker'
  /**
   * Keeping downloaded models for the next visit. Always `degraded`: the model
   * loaded and works, it will just be downloaded again next time.
   */
  | 'model-storage'
  /** A turn failed without one stage owning it. */
  | 'conversation';

/**
 * Something went wrong, reported to the host application.
 *
 * The severity matters more than the message. Most failures here are survivable
 * because the engine falls back: WebGPU to WASM, Kokoro to a smaller voice
 * model. Those are worth a quiet notice, not an error screen, and telling them
 * apart is the whole reason this exists rather than a bare string.
 */
export interface AiVoiceAvatarError {
  stage: AiVoiceAvatarErrorStage;
  /**
   * `degraded` — the avatar still works. It fell back to a worse path, or one
   * turn failed (your adapter threw, or nothing was recognised) and it is
   * listening again; the next turn may well succeed.
   * `fatal` — that capability is gone for this session.
   */
  severity: 'degraded' | 'fatal';
  /** Plain-language description, safe to show or log. */
  message: string;
  /**
   * The engine's own stage name, for bug reports. Unstable across versions,
   * except these four, which are safe to branch on: `onTranscribe`,
   * `onSubmit` and `onSynthesize` (your adapter threw), and `no-speech`
   * (someone was heard and nothing was recognised).
   */
  detail?: string;
}

/** What is known about the turn being handed to `onSubmit`, besides its text. */
export interface AiVoiceAvatarSubmitDetails {
  /**
   * How long the user spoke, in milliseconds: from the first word the voice
   * detector heard to the last, short pauses in between included. The padding
   * kept before speech and the silence waited out after it are not counted, so
   * this is the figure to divide words by for a speaking rate.
   *
   * Undefined for typed input from `sendText`, which was never spoken.
   */
  speechMs?: number;
  /**
   * Aborted when this reply is no longer wanted: the user talked over it,
   * `interrupt()` was called, or a new turn began. Pass it
   * to `fetch` so the request, and the work behind it, stops too. The hook
   * stops reading the reply either way.
   */
  signal: AbortSignal;
}
